import { once } from 'events';
import * as path from 'path';
import { PassThrough } from 'stream';
import { createCanvas } from 'canvas';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TimedScene } from '../script/script.types';
import { ffmpeg } from '../util/ffmpeg.util';
import { StickmanRenderer } from './stickman.renderer';

/**
 * Step 3 of the pipeline: render the stickman animation to animation.mp4.
 *
 * Frames are generated one at a time on a single reused canvas and streamed as
 * raw BGRA straight into FFmpeg's stdin — so we never hold more than one frame
 * in memory and never touch disk for PNGs. Scene lengths come from the MEASURED
 * TTS audio durations, which is what keeps the visuals in sync with the voice.
 *
 * This file + stickman.renderer.ts are the only two that would change if we
 * swapped node-canvas for Remotion; everything downstream just sees a .mp4.
 */
@Injectable()
export class AnimationService {
  private readonly logger = new Logger(AnimationService.name);
  private readonly renderer = new StickmanRenderer();
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;

  constructor(private readonly config: ConfigService) {
    this.width = Number(this.config.get('VIDEO_WIDTH') ?? 1080);
    this.height = Number(this.config.get('VIDEO_HEIGHT') ?? 1920);
    this.fps = Number(this.config.get('VIDEO_FPS') ?? 30);
  }

  async render(
    title: string,
    timedScenes: TimedScene[],
    jobDir: string,
  ): Promise<string> {
    const outPath = path.join(jobDir, 'animation.mp4');
    const { width, height, fps } = this;

    // Frame budget per scene comes from real audio length.
    const sceneFrames = timedScenes.map((s) =>
      Math.max(1, Math.round(s.audioDuration * fps)),
    );
    const totalFrames = sceneFrames.reduce((a, b) => a + b, 0);
    this.logger.log(
      `Rendering ${totalFrames} frames (${(totalFrames / fps).toFixed(1)}s @ ${fps}fps, ${width}x${height})`,
    );

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Raw frames -> ffmpeg stdin.
    const frameStream = new PassThrough();
    const encoding = new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(frameStream)
        .inputOptions([
          '-f', 'rawvideo',
          '-pixel_format', 'bgra',
          '-video_size', `${width}x${height}`,
          '-framerate', `${fps}`,
        ])
        .outputOptions([
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
          '-movflags', '+faststart',
        ])
        .on('error', (err: Error) =>
          reject(new Error(`Animation encode failed: ${err.message}`)),
        )
        .on('end', () => resolve())
        .save(outPath);
    });

    try {
      let globalFrame = 0;
      for (let s = 0; s < timedScenes.length; s++) {
        const frames = sceneFrames[s];
        for (let i = 0; i < frames; i++) {
          const sceneProgress = frames <= 1 ? 1 : i / (frames - 1);
          this.renderer.render({
            ctx,
            width,
            height,
            title,
            scene: timedScenes[s],
            sceneIndex: s,
            totalScenes: timedScenes.length,
            sceneProgress,
            globalFrame,
            fps,
          });
          // node-canvas 'raw' is native-endian ARGB == BGRA bytes on LE hosts.
          const buf = canvas.toBuffer('raw');
          if (!frameStream.write(buf)) {
            await once(frameStream, 'drain'); // honour backpressure
          }
          globalFrame++;
        }
      }
    } finally {
      frameStream.end();
    }

    await encoding;
    this.logger.log(`Animation written: ${outPath}`);
    return outPath;
  }
}
