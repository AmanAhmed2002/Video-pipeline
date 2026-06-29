/**
 * Usage & cost accounting for a single video job.
 *
 * Two billed resources go into one video:
 *   1. Anthropic script generation — billed per input/output TOKEN.
 *   2. OpenAI TTS — billed per input CHARACTER (there is no token concept for
 *      TTS; characters are the real unit OpenAI charges on).
 *
 * We record the raw counts and the money each resource cost so the dashboard
 * can show both "what happened" and "what it cost".
 */

export interface ScriptUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TtsUsage {
  model: string;
  /** Characters of narration sent to TTS — the real OpenAI billing unit. */
  characters: number;
}

export interface CostBreakdown {
  /** USD spent on the Anthropic script call. */
  script: number;
  /** USD spent on OpenAI TTS. */
  tts: number;
  /** USD total for the whole video. */
  total: number;
}

/** The full usage + cost record persisted as usage.json in each job dir. */
export interface JobUsage {
  jobId: string;
  /** The user's original prompt (for the dashboard's recent list). */
  prompt: string;
  /** The generated video title. */
  title: string;
  script: ScriptUsage;
  tts: TtsUsage;
  cost: CostBreakdown;
  createdAt: string;
}

/** Aggregate view across every recorded job, for the dashboard header. */
export interface UsageTotals {
  videos: number;
  inputTokens: number;
  outputTokens: number;
  ttsCharacters: number;
  cost: CostBreakdown;
}
