import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

function loadHttpsOptions() {
  const keyPath = process.env.HTTPS_KEY_PATH?.trim();
  const certPath = process.env.HTTPS_CERT_PATH?.trim();
  if (!keyPath || !certPath) return undefined;
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    throw new Error(
      `HTTPS_KEY_PATH / HTTPS_CERT_PATH set but file missing (${keyPath}, ${certPath})`,
    );
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https';
}

async function bootstrap() {
  const httpsOptions = loadHttpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    httpsOptions ? { httpsOptions } : undefined,
  );

  // Railway / reverse proxies — required for req.ip and X-Forwarded-For on audit LOGIN
  app.set('trust proxy', 1);

  // Behind a TLS terminator (nginx/Cloudflare), set FORCE_HTTPS=true so plain HTTP is rejected.
  // Native HTTPS listen (HTTPS_KEY_PATH/CERT) already serves only TLS.
  if (process.env.FORCE_HTTPS === 'true') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (isHttpsRequest(req)) return next();
      res.status(403).json({
        message: 'HTTPS required',
        error: 'Forbidden',
        statusCode: 403,
      });
    });
  }

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  const scheme = httpsOptions ? 'https' : 'http';
  // eslint-disable-next-line no-console
  console.log(`API listening on ${scheme}://localhost:${port}/api/v1`);
}
bootstrap();
