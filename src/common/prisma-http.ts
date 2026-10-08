import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Map common Prisma errors to HTTP exceptions so clients don't see opaque 500s. */
export function rethrowPrismaAsHttp(err: unknown): never {
  if (err instanceof HttpException) throw err;

  if (err instanceof Prisma.PrismaClientValidationError) {
    const msg = err.message.split('\n').filter(Boolean).pop() ?? err.message;
    throw new BadRequestException(
      msg.replace(/^Invalid `.*?` invocation:\s*/i, '').slice(0, 400) ||
        'Invalid database request',
    );
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
    throw new BadRequestException(
      `Database error ${err.code}: ${err.message.slice(0, 200)}`,
    );
  }

  throw err;
}
