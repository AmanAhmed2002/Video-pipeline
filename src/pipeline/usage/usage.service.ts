import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CostBreakdown,
  JobUsage,
  ScriptUsage,
  TtsUsage,
  UsageTotals,
} from './usage.types';

/**
 * Prices the two billed resources and persists a usage record per job.
 *
 * Rates are configurable via .env because provider pricing changes; the
 * defaults below reflect the models this pipeline ships with. Anthropic bills
 * per million TOKENS (split input/output); OpenAI TTS bills per million
 * CHARACTERS.
 *
 * Records are written to each job's usage.json AND cached in memory. Aggregate
 * totals are rebuilt by scanning the output dir, so the dashboard's running
 * total survives a process restart even though job status does not.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly outputRoot: string;
  private readonly cache = new Map<string, JobUsage>();

  // USD per 1,000,000 units.
  private readonly anthropicInputPerMTok: number;
  private readonly anthropicOutputPerMTok: number;
  private readonly ttsPerMChar: number;

  constructor(private readonly config: ConfigService) {
    this.outputRoot = path.resolve(
      this.config.get<string>('OUTPUT_DIR') ?? 'outputs',
    );
    // Defaults: claude-haiku-4-5 ($1 in / $5 out per MTok) and tts-1 ($15/MChar).
    this.anthropicInputPerMTok = this.num('ANTHROPIC_INPUT_COST_PER_MTOK', 1);
    this.anthropicOutputPerMTok = this.num('ANTHROPIC_OUTPUT_COST_PER_MTOK', 5);
    this.ttsPerMChar = this.num('TTS_COST_PER_MCHAR', 15);
  }

  private num(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /** Compute the cost breakdown from raw usage counts. */
  price(script: ScriptUsage, tts: TtsUsage): CostBreakdown {
    const scriptCost =
      (script.inputTokens / 1_000_000) * this.anthropicInputPerMTok +
      (script.outputTokens / 1_000_000) * this.anthropicOutputPerMTok;
    const ttsCost = (tts.characters / 1_000_000) * this.ttsPerMChar;
    return {
      script: round6(scriptCost),
      tts: round6(ttsCost),
      total: round6(scriptCost + ttsCost),
    };
  }

  /** Build, persist (usage.json) and cache the usage record for a job. */
  async record(
    jobId: string,
    meta: { prompt: string; title: string },
    script: ScriptUsage,
    tts: TtsUsage,
  ): Promise<JobUsage> {
    const usage: JobUsage = {
      jobId,
      prompt: meta.prompt,
      title: meta.title,
      script,
      tts,
      cost: this.price(script, tts),
      createdAt: new Date().toISOString(),
    };
    this.cache.set(jobId, usage);
    try {
      await fs.writeFile(
        path.join(this.outputRoot, jobId, 'usage.json'),
        JSON.stringify(usage, null, 2),
      );
    } catch (err) {
      // Persistence is best-effort; the in-memory cache still serves the API.
      this.logger.warn(
        `Could not write usage.json for ${jobId}: ${(err as Error).message}`,
      );
    }
    this.logger.log(
      `[${jobId}] usage: ${script.inputTokens}+${script.outputTokens} tok, ` +
        `${tts.characters} chars → $${usage.cost.total.toFixed(4)}`,
    );
    return usage;
  }

  /** One job's usage, from cache or falling back to its usage.json on disk. */
  async get(jobId: string): Promise<JobUsage | null> {
    const cached = this.cache.get(jobId);
    if (cached) return cached;
    try {
      const raw = await fs.readFile(
        path.join(this.outputRoot, jobId, 'usage.json'),
        'utf8',
      );
      const parsed = JSON.parse(raw) as JobUsage;
      this.cache.set(jobId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /** Every recorded job, newest first (scans the output dir on disk). */
  async list(): Promise<JobUsage[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.outputRoot);
    } catch {
      return [];
    }
    const records = await Promise.all(entries.map((id) => this.get(id)));
    return records
      .filter((r): r is JobUsage => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Sum usage and cost across every recorded job. */
  async totals(): Promise<UsageTotals> {
    const all = await this.list();
    const acc: UsageTotals = {
      videos: all.length,
      inputTokens: 0,
      outputTokens: 0,
      ttsCharacters: 0,
      cost: { script: 0, tts: 0, total: 0 },
    };
    for (const u of all) {
      acc.inputTokens += u.script.inputTokens;
      acc.outputTokens += u.script.outputTokens;
      acc.ttsCharacters += u.tts.characters;
      acc.cost.script += u.cost.script;
      acc.cost.tts += u.cost.tts;
      acc.cost.total += u.cost.total;
    }
    acc.cost.script = round6(acc.cost.script);
    acc.cost.tts = round6(acc.cost.tts);
    acc.cost.total = round6(acc.cost.total);
    return acc;
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
