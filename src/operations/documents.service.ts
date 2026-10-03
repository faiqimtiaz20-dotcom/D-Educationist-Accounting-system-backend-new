import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, Prisma } from '@prisma/client';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUserPayload } from '../common/decorators';

function formatSize(bytes: number | bigint | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

@Injectable()
export class DocumentsService {
  private readonly uploadRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.uploadRoot =
      this.config.get<string>('UPLOAD_DIR') ||
      join(process.cwd(), 'uploads');
    if (!existsSync(this.uploadRoot)) {
      mkdirSync(this.uploadRoot, { recursive: true });
    }
  }

  /** Resolve on-disk path; reject traversal outside upload root. */
  private resolveStoragePath(storageKey: string): string {
    const normalized = normalize(storageKey).replace(/^([/\\])+/, '');
    if (normalized.includes('..')) {
      throw new BadRequestException('Invalid storage key');
    }
    const abs = join(this.uploadRoot, normalized);
    const root = normalize(this.uploadRoot);
    if (!normalize(abs).startsWith(root + sep) && normalize(abs) !== root) {
      throw new BadRequestException('Invalid storage path');
    }
    return abs;
  }

  private map(row: Prisma.DocumentGetPayload<{
    include: { uploadedBy: { select: { id: true; fullName: true } } };
  }>) {
    return {
      id: row.id,
      name: row.name,
      type: row.docType,
      linkedType: row.linkedType,
      linkedId: row.linkedId,
      uploadDate: row.uploadDate.toISOString().slice(0, 10),
      size: formatSize(row.sizeBytes),
      sizeBytes: row.sizeBytes != null ? Number(row.sizeBytes) : null,
      mimeType: row.mimeType,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedBy?.fullName ?? null,
      storageKey: row.storageKey,
      tenantId: row.tenantId,
    };
  }

  list(opts: { linkedType?: string; linkedId?: string; docType?: DocumentType } = {}) {
    return this.prisma.document
      .findMany({
        where: {
          ...(opts.linkedType ? { linkedType: opts.linkedType } : {}),
          ...(opts.linkedId ? { linkedId: opts.linkedId } : {}),
          ...(opts.docType ? { docType: opts.docType } : {}),
        },
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { uploadDate: 'desc' },
      })
      .then((rows) => rows.map((r) => this.map(r)));
  }

  async get(id: string) {
    const row = await this.prisma.document.findUnique({
      where: { id },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
    if (!row) throw new NotFoundException('Document not found');
    return this.map(row);
  }

  async upload(
    file: Express.Multer.File | undefined,
    meta: {
      name?: string;
      docType: DocumentType;
      linkedType: string;
      linkedId: string;
    },
    user: AuthUserPayload,
  ) {
    if (!file?.buffer && !file?.path) {
      throw new BadRequestException('File is required');
    }
    if (!meta.linkedType?.trim() || !meta.linkedId) {
      throw new BadRequestException('linkedType and linkedId are required');
    }
    if (!user.tenantId) {
      throw new BadRequestException(
        'Documents require a tenant context (CRM Admin cannot upload)',
      );
    }

    const id = randomUUID();
    const safeName = (meta.name || file.originalname || 'document')
      .replace(/[^\w.\- ()]+/g, '_')
      .slice(0, 180);
    const ext = (file.originalname.includes('.')
      ? file.originalname.slice(file.originalname.lastIndexOf('.'))
      : ''
    ).slice(0, 20);
    // MT8: uploads/{tenantId}/{uuid}{ext}
    const storageKey = `${user.tenantId}/${id}${ext || ''}`;
    const absPath = this.resolveStoragePath(storageKey);
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (file.buffer) {
      writeFileSync(absPath, file.buffer);
    } else if (file.path) {
      const { copyFileSync } = await import('fs');
      copyFileSync(file.path, absPath);
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
    }

    const row = await this.prisma.document.create({
      data: {
        id,
        tenantId: user.tenantId,
        name: safeName,
        docType: meta.docType,
        linkedType: meta.linkedType.trim(),
        linkedId: meta.linkedId,
        storageKey,
        mimeType: file.mimetype || null,
        sizeBytes: BigInt(file.size ?? 0),
        uploadedById: user.id,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });

    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      module: 'Documents',
      entityType: 'Document',
      entityId: row.id,
      afterData: {
        name: row.name,
        docType: row.docType,
        linkedType: row.linkedType,
        linkedId: row.linkedId,
        storageKey: row.storageKey,
      },
    });

    return this.map(row);
  }

  async downloadStream(id: string) {
    const row = await this.prisma.document.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Document not found');
    const absPath = this.resolveStoragePath(row.storageKey);
    if (!existsSync(absPath)) {
      throw new NotFoundException('File missing on disk');
    }
    return {
      stream: createReadStream(absPath),
      mimeType: row.mimeType || 'application/octet-stream',
      name: row.name,
      sizeBytes: row.sizeBytes != null ? Number(row.sizeBytes) : undefined,
    };
  }

  async remove(id: string, user: AuthUserPayload) {
    const row = await this.prisma.document.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Document not found');
    const absPath = this.resolveStoragePath(row.storageKey);
    await this.prisma.document.delete({ where: { id } });
    if (existsSync(absPath)) {
      try {
        unlinkSync(absPath);
      } catch {
        /* ignore disk errors after DB delete */
      }
    }
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      module: 'Documents',
      entityType: 'Document',
      entityId: id,
      beforeData: { name: row.name, storageKey: row.storageKey },
    });
    return { ok: true };
  }
}
