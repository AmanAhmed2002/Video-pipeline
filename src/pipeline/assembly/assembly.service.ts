import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ffmpeg } from '../util/ffmpeg.util';
import { demoPanelRect } from '../util/demo.util';

/** A screen recording to composite into the demo panel, with its time window. */
export interface DemoOverlay {
  /** Path to the uploaded recording. */
  clipPath: string;
  /** Start time (s) of the demo window in the final timeline. */
  start: number;
  /** End time (s) of the demo window. */
  end: number;
}

/**
 * Step 4 of the pipeline: produce the final output.mp4.
 *
 * Two modes:
 *  - No demo: mux animation.mp4 (video) + voiceover.mp3 (audio); the video is
 *    already H.264 so it's stream-copied (fast, lossless).
 *  - With demo: composite an uploaded screen recording into the demo panel
 *    (picture-in-picture) for its scene window, then mux with the voiceover.
 *    The recording's own audio is dropped — narration plays throughout.
 *
 * Animation length is derived from measured audio, so the tracks are ~equal;
 * `-shortest` guards against sub-frame rounding leaving a dangling tail.
 */
@Injectable()
export class AssemblyService {
  private readonly logger = new Logger(AssemblyService.name);
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;

  constructor(private readonly config: ConfigService) {
    this.width = Number(this.config.get('VIDEO_WIDTH') ?? 1080);
    this.height = Number(this.config.get('VIDEO_HEIGHT') ?? 1920);
    this.fps = Number(this.config.get('VIDEO_FPS') ?? 30);
  }

  async assemble(
    animationPath: string,
    voiceoverPath: string,
    jobDir: string,
    demo?: DemoOverlay,
  ): Promise<string> {
    const outPath = path.join(jobDir, 'output.mp4');

    if (demo) {
      await this.assembleWithDemo(animationPath, voiceoverPath, jobDir, demo, outPath);
    } else {
      await this.muxCopy(animationPath, voiceoverPath, outPath);
    }

    this.logger.log(`Final video written: ${outPath}`);
    return outPath;
  }

  /** Plain mux: stream-copy the animation video, encode AAC audio. */
  private muxCopy(
    animationPath: string,
    voiceoverPath: string,
    outPath: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(animationPath)
        .input(voiceoverPath)
        .outputOptions([
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
        ])
        .on('error', (err: Error) =>
          reject(new Error(`Final assembly failed: ${err.message}`)),
        )
        .on('end', () => resolve())
        .save(outPath);
    });
  }

  /**
   * Composite the recording into the demo panel, then mux with voiceover.
   * Step 1 fits the (possibly looped/trimmed, possibly differently-shaped)
   * recording to the exact panel size and demo-window duration. Step 2 overlays
   * that fitted clip onto the animation at the panel position, gated to the
   * demo window, and re-encodes (overlay precludes stream-copy).
   */
  private async assembleWithDemo(
    animationPath: string,
    voiceoverPath: string,
    jobDir: string,
    demo: DemoOverlay,
    outPath: string,
  ): Promise<void> {
    const panel = demoPanelRect(this.width, this.height);
    const duration = Math.max(0.1, demo.end - demo.start);
    const fitPath = path.join(jobDir, 'demo-fit.mp4');

    // Step 1: scale-to-cover + crop to the panel, loop to fill the window,
    // trim to its exact length, drop audio.
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(demo.clipPath)
        .inputOptions(['-stream_loop', '-1']) // loop if the clip is shorter
        .outputOptions([
          '-an',
          '-t', duration.toFixed(3),
          '-vf',
          `scale=${panel.w}:${panel.h}:force_original_aspect_ratio=increase,` +
            `crop=${panel.w}:${panel.h},fps=${this.fps}`,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
        ])
        .on('error', (err: Error) =>
          reject(new Error(`Demo clip fit failed: ${err.message}`)),
        )
        .on('end', () => resolve())
        .save(fitPath);
    });

    // Step 2: overlay the fitted clip onto the animation at the panel position,
    // shifted to start at the demo window and only shown during it.
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(animationPath) // 0: full stickman animation
        .input(fitPath) // 1: fitted recording
        .input(voiceoverPath) // 2: narration
        .complexFilter([
          `[1:v]setpts=PTS-STARTPTS+${demo.start.toFixed(3)}/TB[demo]`,
          `[0:v][demo]overlay=${panel.x}:${panel.y}:` +
            `enable='between(t,${demo.start.toFixed(3)},${demo.end.toFixed(3)})'[v]`,
        ])
        .outputOptions([
          '-map', '[v]',
          '-map', '2:a:0',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
        ])
        .on('error', (err: Error) =>
          reject(new Error(`Demo composite failed: ${err.message}`)),
        )
        .on('end', () => resolve())
        .save(outPath);
    });
  }
}
