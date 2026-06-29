import { z } from 'zod';

/**
 * The structured script contract. Every downstream layer (TTS, animation,
 * assembly) consumes this shape, so it lives here as the single source of truth.
 */

export const MOODS = ['happy', 'concerned', 'excited', 'neutral'] as const;
export type Mood = (typeof MOODS)[number];

export const SceneSchema = z.object({
  /** Narration spoken in this scene (fed to TTS verbatim). */
  text: z.string().min(1),
  /**
   * Target duration in seconds. NOTE: this is a HINT from the script model.
   * Actual scene timing is driven by the measured TTS audio length, not this.
   */
  duration: z.number().positive(),
  mood: z.enum(MOODS),
  /** Free-form cue the renderer reads to decide what the stickman does. */
  animation_hints: z.string().min(1),
  /**
   * When true, this scene composites the uploaded screen recording into a
   * framed panel and the stickman presents it (intro→demo→outro structure).
   * Only meaningful when a demo clip was uploaded with the job.
   */
  show_demo: z.boolean().optional().default(false),
});

export const ScriptSchema = z.object({
  /** Short title shown on scene cards. */
  title: z.string().min(1),
  scenes: z.array(SceneSchema).min(3).max(8),
});

export type Scene = z.infer<typeof SceneSchema>;
export type Script = z.infer<typeof ScriptSchema>;

/**
 * A scene enriched with the REAL audio duration measured after TTS.
 * This is what the animation layer actually times against.
 */
export interface TimedScene extends Scene {
  /** Measured audio length of this scene in seconds. */
  audioDuration: number;
}
