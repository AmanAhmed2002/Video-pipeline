import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Script, ScriptSchema } from './script.types';
import { ScriptUsage } from '../usage/usage.types';

/** A generated script plus the token usage the API reported producing it. */
export interface ScriptResult {
  script: Script;
  usage: ScriptUsage;
}

/**
 * Step 1 of the pipeline: turn a raw user prompt into a validated, timed,
 * scene-segmented narration script using the Anthropic API.
 *
 * We use Claude's tool-calling to force a structured JSON response rather than
 * parsing free-form prose, then validate the result with zod so a malformed
 * response fails loudly with a clear message instead of poisoning later steps.
 */
@Injectable()
export class ScriptService {
  private readonly logger = new Logger(ScriptService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
    }
    this.client = new Anthropic({ apiKey });
    this.model = this.config.get<string>('SCRIPT_MODEL') ?? 'claude-haiku-4-5';
  }

  /** The tool schema we force Claude to call, mirroring ScriptSchema. */
  private readonly scriptTool: Anthropic.Tool = {
    name: 'emit_script',
    description:
      'Emit the final stickman explainer-video script as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short punchy video title.' },
        scenes: {
          type: 'array',
          minItems: 4,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Narration spoken aloud in this scene.',
              },
              duration: {
                type: 'number',
                description: 'Estimated spoken duration in seconds (6-10).',
              },
              mood: {
                type: 'string',
                enum: ['happy', 'concerned', 'excited', 'neutral'],
              },
              animation_hints: {
                type: 'string',
                description:
                  'Concrete visual cue for the stickman renderer. Mention a ' +
                  'gesture (wave, point, cheer, walk) AND, where it fits, one ' +
                  'or two on-screen props by name. Recognised props: water/' +
                  'glass, pill/vitamin, apple/food, heart, chart/graph, money/' +
                  'coin, lightbulb/idea, clock/time, phone, book, sun, plant/' +
                  'tree, star, speech bubble, up arrow, checkmark, fire/energy, ' +
                  'globe/world, gear/settings, rocket, moon/sleep, warning, ' +
                  'trophy, music note. E.g. "stickman points at a rising chart ' +
                  'and a lightbulb, excited".',
              },
              show_demo: {
                type: 'boolean',
                description:
                  'Set true ONLY on the scene(s) that present the uploaded app ' +
                  'screen recording. In those scenes the recording fills a panel ' +
                  'above the stickman, so the narration should walk through what ' +
                  'the viewer is seeing on screen. Leave false/omit otherwise.',
              },
            },
            required: ['text', 'duration', 'mood', 'animation_hints'],
          },
        },
      },
      required: ['title', 'scenes'],
    },
  };

  async generate(
    prompt: string,
    opts: { hasDemo?: boolean } = {},
  ): Promise<ScriptResult> {
    this.logger.log(
      `Generating script for prompt: "${prompt}"${opts.hasDemo ? ' (with demo clip)' : ''}`,
    );

    let system =
      'You are a scriptwriter for short-form (TikTok/Reels) stickman explainer ' +
      'videos. Produce 4-6 scenes totalling 30-50 seconds of narration. Each ' +
      "scene's narration must be concise and conversational. Always call the " +
      'emit_script tool with the result; do not reply with prose.';

    if (opts.hasDemo) {
      system +=
        ' A screen recording of the user\'s app IS available to embed. Structure ' +
        'the video as: a stickman INTRO that hooks the viewer, then 1-2 DEMO ' +
        'scenes that show the app (set show_demo=true on exactly those scenes; ' +
        'their narration should describe what is happening on screen), then a ' +
        'stickman OUTRO/call-to-action. Mark show_demo=true ONLY on the demo ' +
        'scenes; intro and outro must have show_demo=false.';
    } else {
      system +=
        ' No screen recording is available, so every scene must have ' +
        'show_demo=false.';
    }

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system,
        tools: [this.scriptTool],
        tool_choice: { type: 'tool', name: 'emit_script' },
        messages: [
          {
            role: 'user',
            content: `Write the stickman explainer video script for: "${prompt}"`,
          },
        ],
      });
    } catch (err) {
      throw new Error(
        `Anthropic API call failed: ${(err as Error).message}`,
      );
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error(
        'Claude did not return a tool_use block; cannot parse script.',
      );
    }

    const parsed = ScriptSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(
        `Script failed schema validation: ${parsed.error.message}`,
      );
    }

    this.logger.log(
      `Script generated: "${parsed.data.title}" (${parsed.data.scenes.length} scenes)`,
    );
    return {
      script: parsed.data,
      usage: {
        model: this.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
