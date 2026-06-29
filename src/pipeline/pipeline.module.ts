import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { ScriptService } from './script/script.service';
import { TtsService } from './tts/tts.service';
import { AnimationService } from './animation/animation.service';
import { AssemblyService } from './assembly/assembly.service';
import { UsageService } from './usage/usage.service';

@Module({
  controllers: [PipelineController],
  providers: [
    PipelineService,
    ScriptService,
    TtsService,
    AnimationService,
    AssemblyService,
    UsageService,
  ],
})
export class PipelineModule {}
