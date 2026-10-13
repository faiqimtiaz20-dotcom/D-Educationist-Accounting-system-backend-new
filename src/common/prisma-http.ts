import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

const log = new Logger('PrismaHttp');

/** Map common Prisma errors to HTTP exceptions. Never return query text or file paths. */
export function rethrowPrismaAsHttp(err: unknown): never {
  if (err instanceof HttpException) throw err;

  if (
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    log.error(err.message);
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    throw new BadRequestException('Invalid database request');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      throw new ConflictException('A record with this key already exists');
    }
    if (err.code === 'P2003') {
      throw new BadRequestException('Invalid reference (foreign key)');
    }
    if (err.code === 'P2025') {
      throw new BadRequestException('Record not found');
    }
    if (err.code === 'P2023') {
      throw new BadRequestException('Invalid identifier format');
    }
    if (err.code === 'P2028') {
      throw new BadRequestException(
        'The save took too long and was not recorded. Please try again.',
      );
    }
    throw new BadRequestException('Database request failed. Please try again.');
  }

  throw err;
}
