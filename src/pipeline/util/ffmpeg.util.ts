import ffmpeg from 'fluent-ffmpeg';

/**
 * Shared FFmpeg helpers. fluent-ffmpeg resolves `ffmpeg`/`ffprobe` from PATH by
 * default; FFMPEG_PATH / FFPROBE_PATH env vars override (useful in containers).
 */
if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

/** Returns the duration of a media file in seconds via ffprobe. */
export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));
      const duration = data?.format?.duration;
      if (typeof duration !== 'number' || Number.isNaN(duration)) {
        return reject(new Error(`Could not read duration for ${filePath}`));
      }
      resolve(duration);
    });
  });
}

export { ffmpeg };
