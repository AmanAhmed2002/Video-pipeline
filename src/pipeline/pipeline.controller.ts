import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { GenerateDto } from './dto/generate.dto';
import { PipelineService } from './pipeline.service';
import { UsageService } from './usage/usage.service';

// multer ships no types; pull diskStorage at runtime to avoid a type dep.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { diskStorage } = require('multer');

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? 'uploads');

/** Minimal shape of a multer-saved file (we don't depend on @types/multer). */
interface UploadedVideo {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Disk storage that keeps uploads under UPLOAD_DIR with a uuid filename. */
const videoStorage = diskStorage({
  destination: (_req: unknown, _file: unknown, cb: (e: Error | null, dir: string) => void) => {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req: unknown, file: UploadedVideo, cb: (e: Error | null, name: string) => void) => {
    cb(null, `${uuidv4()}${extname(file.originalname) || '.mp4'}`);
  },
});

@Controller()
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Upload a screen recording to embed in a later /generate call.
   * Returns an `uploadId` to pass back as `demoUploadId`.
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoStorage,
      limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB
      fileFilter: (_req: unknown, file: UploadedVideo, cb: (e: Error | null, ok: boolean) => void) =>
        cb(null, /^video\//.test(file.mimetype)),
    }),
  )
  async upload(@UploadedFile() file?: UploadedVideo) {
    if (!file) {
      throw new BadRequestException(
        'Upload a video file in the "file" field (max 300 MB).',
      );
    }
    return {
      uploadId: basename(file.path),
      filename: file.originalname,
      size: file.size,
    };
  }

  /** Kick off a job; returns immediately with a jobId. */
  @Post('generate')
  @HttpCode(202)
  async generate(@Body() body: GenerateDto) {
    const jobId = await this.pipeline.startJob(body.prompt, body.demoUploadId);
    return { jobId, status: 'processing' };
  }

  /** Poll job status. */
  @Get('status/:jobId')
  status(@Param('jobId') jobId: string) {
    const job = this.pipeline.getStatus(jobId);
    if (!job) throw new NotFoundException(`Unknown jobId: ${jobId}`);
    return {
      jobId: job.jobId,
      status: job.status,
      step: job.step,
      ...(job.message ? { message: job.message } : {}),
    };
  }

  /** Token/character usage and cost for one job. */
  @Get('usage/:jobId')
  async usageFor(@Param('jobId') jobId: string) {
    const usage = await this.usage.get(jobId);
    if (!usage) throw new NotFoundException(`No usage recorded for: ${jobId}`);
    return usage;
  }

  /** Aggregate usage + cost across every recorded video, for the dashboard. */
  @Get('stats')
  async stats() {
    const [totals, recent] = await Promise.all([
      this.usage.totals(),
      this.usage.list(),
    ]);
    return { totals, recent: recent.slice(0, 20) };
  }

  /**
   * Serve the finished output.mp4. Defaults to a download; pass `?inline=1`
   * for inline playback (used by the dashboard's <video> preview).
   */
  @Get('output/:jobId')
  async output(
    @Param('jobId') jobId: string,
    @Query('inline') inline: string | undefined,
    @Res() res: Response,
  ) {
    const job = this.pipeline.getStatus(jobId);
    if (job?.status === 'error') {
      throw new NotFoundException(`Job failed: ${job.message ?? 'unknown error'}`);
    }
    const outPath = await this.pipeline.getOutputPath(jobId);
    if (!outPath) {
      const detail = job ? `status: ${job.status}, step: ${job.step}` : 'not found';
      throw new NotFoundException(`Output not ready (${detail}).`);
    }
    if (inline) {
      res.type('video/mp4');
      res.sendFile(outPath);
    } else {
      res.download(outPath, `${jobId}.mp4`);
    }
  }
}
