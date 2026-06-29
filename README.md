# Video Pipeline

Prompt → 30–50s vertical MP4 with synced voiceover. Four server-side stages:

1. **Script** — Anthropic `claude-haiku-4-5` returns a scene-segmented narration script (tool-call JSON, zod-validated).
2. **TTS** — OpenAI `tts-1` (`nova`) renders one MP3 per scene; each is probed for its **real** duration and concatenated into `voiceover.mp3`.
3. **Animation** — a stickman explainer is drawn with **node-canvas** at 1080×1920/30fps and streamed as raw frames into FFmpeg → `animation.mp4`. No browser, no PNGs on disk.
4. **Assembly** — `fluent-ffmpeg` muxes video + audio into `output.mp4` (H.264 / AAC). If a screen recording was uploaded, it is composited (picture-in-picture) into the demo panel for the demo scene(s) before muxing.

Scene timing is driven by **measured audio length**, not the script's estimate, which keeps voice and visuals in sync.

## Prerequisites

System libraries (macOS / Homebrew):

```bash
npm run setup        # installs ffmpeg + node-canvas native libs
# or manually:
brew install ffmpeg pkg-config cairo pango libpng jpeg giflib librsvg
```

## Install & run

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY and OPENAI_API_KEY
npm install
npm run start:dev
```

## Dashboard

Open **http://localhost:3000/** in a browser. Type a topic, hit **Generate**
(or ⌘/Ctrl+Enter), watch the pipeline steps progress live, then preview and
download the video — no curl required. The dashboard also shows **per-video
token/character usage and cost**, plus a lifetime usage & spend total and a
clickable list of recent videos.

## App demos / screen recordings

You can embed a screen recording of your app (e.g. showing off a feature) into
the video. The recording plays **picture-in-picture** inside a framed panel
while the stickman presents it; the pipeline structures the script as
**intro → demo → outro** and narrates over the recording (the recording's own
audio is dropped). On the dashboard, click **📎 Attach app screen recording**,
then Generate. Via the API, upload first and pass the returned id:

```bash
# Upload a recording (landscape clips work best; max 300 MB)
curl -F 'file=@demo.mp4;type=video/mp4' localhost:3000/upload
# -> { "uploadId": "…", "filename": "demo.mp4", "size": 12345 }

# Generate with the demo embedded
curl -X POST localhost:3000/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"show off the AI assistant in my app","demoUploadId":"<uploadId>"}'
```

The pipeline picks which scene(s) feature the demo (or you let Claude decide);
the recording is scaled/cropped to the panel and looped or trimmed to match the
demo scene length.

## API

```bash
# 1. Start a job (optional demoUploadId embeds an uploaded recording)
curl -X POST localhost:3000/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"explain the benefits of drinking water"}'
# -> { "jobId": "…", "status": "processing" }

# 2. Poll status
curl localhost:3000/status/<jobId>
# -> { "jobId": "…", "status": "processing"|"done"|"error", "step": "…", "message"?: "…" }

# 3. Download the result (add ?inline=1 for in-browser playback)
curl -OJ localhost:3000/output/<jobId>

# 4. Usage + cost for one video
curl localhost:3000/usage/<jobId>
# -> { script:{inputTokens,outputTokens}, tts:{characters}, cost:{script,tts,total}, … }

# 5. Aggregate usage + cost across all videos
curl localhost:3000/stats

# 6. Upload a screen recording to embed (see "App demos" above)
curl -F 'file=@demo.mp4;type=video/mp4' localhost:3000/upload
```

Each job writes to `outputs/<jobId>/`: `script.json`, `scene-audio/`,
`voiceover.mp3`, `animation.mp4`, `output.mp4`, and `usage.json` (plus
`demo-fit.mp4` when a recording is embedded). Uploads live in `uploads/`.

## Cost tracking

Each video's cost is the sum of two billed resources:

- **Script** — Anthropic bills per **token** (input + output), read from the
  API's `usage` field.
- **TTS** — OpenAI bills per **character** of narration (there is no token
  concept for TTS); characters are counted from the script text.

Rates are configured in `.env` (USD per 1,000,000 units) and default to the
shipped models. Totals are rebuilt from each job's `usage.json`, so the
dashboard's lifetime spend survives a process restart.

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `OPENAI_API_KEY` | — | required |
| `PORT` | `3000` | |
| `OUTPUT_DIR` | `outputs` | |
| `UPLOAD_DIR` | `uploads` | where uploaded screen recordings are stored |
| `SCRIPT_MODEL` | `claude-haiku-4-5` | |
| `TTS_MODEL` / `TTS_VOICE` | `tts-1` / `nova` | |
| `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `VIDEO_FPS` | `1080` / `1920` / `30` | |
| `ANTHROPIC_INPUT_COST_PER_MTOK` | `1` | USD per 1M input tokens |
| `ANTHROPIC_OUTPUT_COST_PER_MTOK` | `5` | USD per 1M output tokens |
| `TTS_COST_PER_MCHAR` | `15` | USD per 1M TTS characters |

## Swapping the animator

Only `src/pipeline/animation/animation.service.ts` and `stickman.renderer.ts` know about node-canvas. Anything that produces an `animation.mp4` (e.g. Remotion) can replace them without touching the rest of the pipeline.

## Notes / limitations

- Jobs are tracked in memory (fire-and-forget); status is lost on restart. Add BullMQ/Redis for durability or concurrency control.
- One job saturates CPU during frame rendering; there is no concurrency cap.
