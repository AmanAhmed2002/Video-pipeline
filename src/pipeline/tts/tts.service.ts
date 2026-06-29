import { promises as fs } from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Script, TimedScene } from '../script/script.types';
import { ffmpeg, probeDuration } from '../util/ffmpeg.util';

export interface TtsResult {
  /** Path to the single concatenated voiceover.mp3. */
  voiceoverPath: string;
  /** Total measured audio length in seconds. */
  totalDuration: number;
  /** Each scene enriched with its REAL measured audio duration. */
  timedScenes: TimedScene[];
  /** Total characters of narration sent to TTS — the OpenAI billing unit. */
  characters: number;
}

/**
 * Step 2 of the pipeline: synthesize narration with OpenAI TTS.
 *
 * Critically, we render ONE mp3 per scene and probe each one's real length.
 * Those measured durations — not the script's estimated `duration` — drive the
 * animation timing downstream, which is what keeps audio and video in sync.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly voice: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Add it to your .env file.');
    }
    this.client = new OpenAI({ apiKey });
    this.model = this.config.get<string>('TTS_MODEL') ?? 'tts-1';
    this.voice = this.config.get<string>('TTS_VOICE') ?? 'nova';
  }

  async synthesize(script: Script, jobDir: string): Promise<TtsResult> {
    const sceneDir = path.join(jobDir, 'scene-audio');
    await fs.mkdir(sceneDir, { recursive: true });

    // 1. One TTS request per scene, then probe its real duration.
    const scenePaths: string[] = [];
    const timedScenes: TimedScene[] = [];
    let characters = 0;

    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      const scenePath = path.join(sceneDir, `scene-${i}.mp3`);
      characters += scene.text.length;
      this.logger.log(`TTS scene ${i + 1}/${script.scenes.length}`);

      try {
        const speech = await this.client.audio.speech.create({
          model: this.model,
          voice: this.voice as OpenAI.Audio.SpeechCreateParams['voice'],
          input: scene.text,
        });
        const buffer = Buffer.from(await speech.arrayBuffer());
        await fs.writeFile(scenePath, buffer);
      } catch (err) {
        throw new Error(
          `OpenAI TTS failed on scene ${i + 1}: ${(err as Error).message}`,
        );
      }

      const audioDuration = await probeDuration(scenePath);
      scenePaths.push(scenePath);
      timedScenes.push({ ...scene, audioDuration });
    }

    // 2. Concatenate the per-scene mp3s into one clean voiceover via ffmpeg
    //    concat demuxer (re-encoding to avoid broken-header artifacts).
    const voiceoverPath = path.join(jobDir, 'voiceover.mp3');
    await this.concatAudio(scenePaths, voiceoverPath);

    const totalDuration = await probeDuration(voiceoverPath);
    this.logger.log(
      `Voiceover assembled: ${totalDuration.toFixed(2)}s, ${characters} chars`,
    );

    return { voiceoverPath, totalDuration, timedScenes, characters };
  }

  private async concatAudio(inputs: string[], output: string): Promise<void> {
    // Build a concat-demuxer list file (safe for absolute paths).
    const listPath = path.join(path.dirname(output), 'concat-list.txt');
    const listBody = inputs
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.writeFile(listPath, listBody);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c:a', 'libmp3lame', '-q:a', '2'])
        .on('end', () => resolve())
        .on('error', (err: Error) =>
          reject(new Error(`Audio concat failed: ${err.message}`)),
        )
        .save(output);
    });
  }
}
