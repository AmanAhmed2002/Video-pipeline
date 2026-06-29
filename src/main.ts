import 'reflect-metadata';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Serve the dashboard (public/index.html) at the root. Resolved from cwd so
  // it works under both `nest start` (dist) and `node dist/main.js`.
  app.useStaticAssets(path.join(process.cwd(), 'public'));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  const log = new Logger('Bootstrap');
  log.log(`Video pipeline listening on http://localhost:${port}`);
  log.log(`Dashboard: http://localhost:${port}/`);
}

bootstrap();
