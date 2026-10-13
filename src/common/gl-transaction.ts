import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const log = new Logger('GlTransaction');

/** Railway's hop to Postgres blows Prisma's 5s default on GL posts. */
export const GL_TX_OPTIONS = {
  maxWait: 15_000,
  timeout: 30_000,
} as const;

/**
 * Run a GL-posting transaction with a longer budget and one retry when
 * Prisma closes the transaction (P2028). A P2028 means the transaction
 * rolled back, so the retry cannot double-post.
 */
export async function runGlTransaction<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const attempts = 2;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await prisma.$transaction(fn, GL_TX_OPTIONS);
    } catch (err) {
      last = err;
      const timedOut =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2028';
      if (!timedOut || attempt === attempts) throw err;
      log.warn(`GL transaction timed out (attempt ${attempt}); retrying`);
    }
  }
  throw last;
}
