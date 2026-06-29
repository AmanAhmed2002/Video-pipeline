import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PipelineModule } from './pipeline/pipeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PipelineModule,
  ],
})
export class AppModule {}
