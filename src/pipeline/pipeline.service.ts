import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { ScriptService } from './script/script.service';
import { TtsService } from './tts/tts.service';
import { AnimationService } from './animation/animation.service';
import { AssemblyService, DemoOverlay } from './assembly/assembly.service';
import { UsageService } from './usage/usage.service';
import { Scene, TimedScene } from './script/script.types';

export type JobState = 'processing' | 'done' | 'error';

export interface JobStatus {
  jobId: string;
  status: JobState;
  /** Current/most-recent pipeline step, for observability. */
  step: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Orchestrates the four pipeline steps and tracks job status in memory.
 *
 * Jobs run fire-and-forget: POST /generate returns a jobId immediately and the
 * work continues in the background. Status lives in a Map, so it does not
 * survive a process restart — acceptable for a local single-user tool. Swap
 * this for a real queue (BullMQ/Redis) if durability/concurrency is needed.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly jobs = new Map<string, JobStatus>();
  private readonly outputRoot: string;
  private readonly uploadRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly scriptService: ScriptService,
    private readonly ttsService: TtsService,
    private readonly animationService: AnimationService,
    private readonly assemblyService: AssemblyService,
    private readonly usageService: UsageService,
  ) {
    this.outputRoot = path.resolve(
      this.config.get<string>('OUTPUT_DIR') ?? 'outputs',
    );
    this.uploadRoot = path.resolve(
      this.config.get<string>('UPLOAD_DIR') ?? 'uploads',
    );
  }

  /**
   * Kicks off a new job and returns its id immediately. Pass `demoUploadId`
   * (from POST /upload) to embed a screen recording in the video.
   */
  async startJob(prompt: string, demoUploadId?: string): Promise<string> {
    const jobId = uuidv4();
    const now = new Date().toISOString();
    this.jobs.set(jobId, {
      jobId,
      status: 'processing',
      step: 'queued',
      createdAt: now,
      updatedAt: now,
    });

    // Fire-and-forget; errors are captured into job status, never thrown here.
    void this.run(jobId, prompt, demoUploadId);
    return jobId;
  }

  getStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Absolute path to a finished job's output.mp4, or null if it doesn't exist.
   * Checked against the filesystem (not in-memory status) so finished videos
   * remain downloadable after a process restart.
   */
  async getOutputPath(jobId: string): Promise<string | null> {
    const outPath = path.join(this.outputRoot, jobId, 'output.mp4');
    try {
      await fs.access(outPath);
      return outPath;
    } catch {
      return null;
    }
  }

  /**
   * Resolve an upload id to an on-disk clip path, or null if none was given.
   * Uses basename to prevent path traversal and verifies the file exists.
   */
  private async resolveDemoClip(
    demoUploadId?: string,
  ): Promise<string | null> {
    if (!demoUploadId) return null;
    const clipPath = path.join(this.uploadRoot, path.basename(demoUploadId));
    try {
      await fs.access(clipPath);
      return clipPath;
    } catch {
      throw new Error(`Uploaded demo clip not found: ${demoUploadId}`);
    }
  }

  /** Force the scene flags to match whether a clip is actually present. */
  private reconcileDemoScenes(scenes: Scene[], hasDemo: boolean): void {
    if (!hasDemo) {
      for (const s of scenes) s.show_demo = false;
      return;
    }
    if (!scenes.some((s) => s.show_demo)) {
      // Default to the middle scene as the demo if the model didn't pick one.
      scenes[Math.floor(scenes.length / 2)].show_demo = true;
    }
  }

  /**
   * Compute the [start, end] window (seconds) spanned by the demo scenes, from
   * the measured per-scene audio durations — the same timing the animation uses.
   */
  private demoWindow(
    timedScenes: TimedScene[],
    clipPath: string,
  ): DemoOverlay | undefined {
    let t = 0;
    let start = Infinity;
    let end = 0;
    for (const scene of timedScenes) {
      if (scene.show_demo) {
        start = Math.min(start, t);
        end = Math.max(end, t + scene.audioDuration);
      }
      t += scene.audioDuration;
    }
    if (!Number.isFinite(start) || end <= start) return undefined;
    return { clipPath, start, end };
  }

  private update(jobId: string, patch: Partial<JobStatus>): void {
    const current = this.jobs.get(jobId);
    if (!current) return;
    this.jobs.set(jobId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  private async run(
    jobId: string,
    prompt: string,
    demoUploadId?: string,
  ): Promise<void> {
    const jobDir = path.join(this.outputRoot, jobId);
    try {
      await fs.mkdir(jobDir, { recursive: true });

      // 0. Resolve the optional uploaded demo clip (basename guards traversal).
      const demoClipPath = await this.resolveDemoClip(demoUploadId);
      const hasDemo = demoClipPath !== null;

      // 1. Script generation.
      this.update(jobId, { step: 'script' });
      this.logger.log(`[${jobId}] Step 1: script generation`);
      const { script, usage: scriptUsage } = await this.scriptService.generate(
        prompt,
        { hasDemo },
      );
      // Guarantee the structure matches reality: if a clip was uploaded but the
      // model flagged no demo scene, designate the middle scene; if no clip,
      // clear any stray flags so nothing tries to overlay a missing video.
      this.reconcileDemoScenes(script.scenes, hasDemo);
      await fs.writeFile(
        path.join(jobDir, 'script.json'),
        JSON.stringify(script, null, 2),
      );

      // 2. Text-to-speech (also yields the measured per-scene durations).
      this.update(jobId, { step: 'tts' });
      this.logger.log(`[${jobId}] Step 2: text-to-speech`);
      const tts = await this.ttsService.synthesize(script, jobDir);

      // Record usage + cost (script tokens + TTS characters) for the dashboard.
      await this.usageService.record(
        jobId,
        { prompt, title: script.title },
        scriptUsage,
        {
          model: this.config.get<string>('TTS_MODEL') ?? 'tts-1',
          characters: tts.characters,
        },
      );

      // 3. Animation, timed to the measured audio.
      this.update(jobId, { step: 'animation' });
      this.logger.log(`[${jobId}] Step 3: animation`);
      const animationPath = await this.animationService.render(
        script.title,
        tts.timedScenes,
        jobDir,
      );

      // 4. Final assembly (compositing the demo clip if one was uploaded).
      this.update(jobId, { step: 'assembly' });
      this.logger.log(`[${jobId}] Step 4: assembly`);
      const demoOverlay =
        hasDemo && demoClipPath
          ? this.demoWindow(tts.timedScenes, demoClipPath)
          : undefined;
      await this.assemblyService.assemble(
        animationPath,
        tts.voiceoverPath,
        jobDir,
        demoOverlay,
      );

      this.update(jobId, {
        status: 'done',
        step: 'done',
        message: 'Video ready.',
      });
      this.logger.log(`[${jobId}] Done.`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`[${jobId}] Failed: ${message}`);
      this.update(jobId, { status: 'error', message });
    }
  }
}
