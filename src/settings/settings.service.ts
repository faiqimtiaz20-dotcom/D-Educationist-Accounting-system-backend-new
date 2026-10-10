import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUserPayload } from '../common/decorators';
import { ROLE_CODES } from '../common/rbac';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join, normalize } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { currentTenantId } from '../common/tenant-scope';
import { UpdateSettingsDto } from './dto/settings.dto';
import {
  DEFAULT_INVOICE_BRANDING,
  INVOICE_BRANDING_KEYS,
  type InvoiceBranding,
} from './invoice-branding';

const KEYS = {
  whtRatePercent: 'wht_rate_percent',
  enabledCurrencies: 'enabled_currencies',
  fiscalPeriodLockedUntil: 'fiscal_period_locked_until',
  orgName: 'org_name',
  ...INVOICE_BRANDING_KEYS,
} as const;

const LOGO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

@Injectable()
export class SettingsService {
  private readonly uploadRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.uploadRoot =
      this.config.get<string>('UPLOAD_DIR') || join(process.cwd(), 'uploads');
  }

  private async getValue<T>(key: string, fallback: T): Promise<T> {
    const tenantId = currentTenantId();
    const row = await this.prisma.systemSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!row) return fallback;
    return row.value as T;
  }

  async getInvoiceBranding(): Promise<InvoiceBranding> {
    const [
      logoPath,
      address,
      phone,
      email,
      website,
      footer,
      documentTitle,
      accentColor,
      emailSubject,
      emailBody,
      companyLegalName,
      bankName,
      bankBranch,
      bankCity,
      accountTitle,
      accountNo,
      swiftCode,
      iban,
    ] = await Promise.all([
      this.getValue<string | null>(KEYS.logoPath, null),
      this.getValue<string>(KEYS.address, DEFAULT_INVOICE_BRANDING.address),
      this.getValue<string>(KEYS.phone, DEFAULT_INVOICE_BRANDING.phone),
      this.getValue<string>(KEYS.email, DEFAULT_INVOICE_BRANDING.email),
      this.getValue<string>(KEYS.website, DEFAULT_INVOICE_BRANDING.website),
      this.getValue<string>(KEYS.footer, DEFAULT_INVOICE_BRANDING.footer),
      this.getValue<string>(
        KEYS.documentTitle,
        DEFAULT_INVOICE_BRANDING.documentTitle,
      ),
      this.getValue<string>(
        KEYS.accentColor,
        DEFAULT_INVOICE_BRANDING.accentColor,
      ),
      this.getValue<string>(
        KEYS.emailSubject,
        DEFAULT_INVOICE_BRANDING.emailSubject,
      ),
      this.getValue<string>(KEYS.emailBody, DEFAULT_INVOICE_BRANDING.emailBody),
      this.getValue<string>(
        KEYS.companyLegalName,
        DEFAULT_INVOICE_BRANDING.companyLegalName,
      ),
      this.getValue<string>(KEYS.bankName, DEFAULT_INVOICE_BRANDING.bankName),
      this.getValue<string>(
        KEYS.bankBranch,
        DEFAULT_INVOICE_BRANDING.bankBranch,
      ),
      this.getValue<string>(KEYS.bankCity, DEFAULT_INVOICE_BRANDING.bankCity),
      this.getValue<string>(
        KEYS.accountTitle,
        DEFAULT_INVOICE_BRANDING.accountTitle,
      ),
      this.getValue<string>(KEYS.accountNo, DEFAULT_INVOICE_BRANDING.accountNo),
      this.getValue<string>(KEYS.swiftCode, DEFAULT_INVOICE_BRANDING.swiftCode),
      this.getValue<string>(KEYS.iban, DEFAULT_INVOICE_BRANDING.iban),
    ]);

    const abs = logoPath ? this.resolveUploadPath(logoPath) : null;
    return {
      logoPath,
      hasLogo: Boolean(abs && existsSync(abs)),
      address: address ?? '',
      phone: phone ?? '',
      email: email ?? '',
      website: website ?? '',
      footer: footer ?? DEFAULT_INVOICE_BRANDING.footer,
      documentTitle: documentTitle || DEFAULT_INVOICE_BRANDING.documentTitle,
      accentColor: accentColor || DEFAULT_INVOICE_BRANDING.accentColor,
      emailSubject: emailSubject || DEFAULT_INVOICE_BRANDING.emailSubject,
      emailBody: emailBody || DEFAULT_INVOICE_BRANDING.emailBody,
      companyLegalName: companyLegalName ?? '',
      bankName: bankName ?? '',
      bankBranch: bankBranch ?? '',
      bankCity: bankCity ?? '',
      accountTitle: accountTitle ?? '',
      accountNo: accountNo ?? '',
      swiftCode: swiftCode ?? '',
      iban: iban ?? '',
    };
  }

  /** Absolute path under UPLOAD_DIR; rejects traversal. */
  resolveUploadPath(relative: string) {
    const normalized = normalize(relative).replace(/^(\.\.[/\\])+/, '');
    const abs = join(this.uploadRoot, normalized);
    const root = normalize(this.uploadRoot);
    if (!normalize(abs).startsWith(root)) {
      throw new BadRequestException('Invalid upload path');
    }
    return abs;
  }

  async readLogoBuffer(): Promise<{
    buffer: Buffer;
    mimeType: string;
    dataUrl: string;
  } | null> {
    const branding = await this.getInvoiceBranding();
    if (!branding.logoPath || !branding.hasLogo) return null;
    const abs = this.resolveUploadPath(branding.logoPath);
    const { readFileSync } = await import('fs');
    const buffer = readFileSync(abs);
    const ext = extname(abs).toLowerCase();
    const mimeType = LOGO_MIME[ext] || 'application/octet-stream';
    return {
      buffer,
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
  }

  async getAll() {
    const [
      whtRatePercent,
      enabledCurrencies,
      fiscalPeriodLockedUntil,
      orgName,
      currencies,
      invoiceBranding,
    ] = await Promise.all([
      this.getValue<number>(KEYS.whtRatePercent, 1),
      this.getValue<string[]>(KEYS.enabledCurrencies, [
        'PKR',
        'GBP',
        'USD',
        'CAD',
        'AUD',
        'EUR',
      ]),
      this.getValue<string | null>(KEYS.fiscalPeriodLockedUntil, null),
      this.getValue<string>(KEYS.orgName, "D' Educationist"),
      this.prisma.currency.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.getInvoiceBranding(),
    ]);

    return {
      whtRatePercent,
      enabledCurrencies,
      fiscalPeriodLockedUntil,
      orgName,
      currencies,
      invoiceBranding,
    };
  }

  async update(dto: UpdateSettingsDto, actor: AuthUserPayload) {
    if (actor.roleCode === ROLE_CODES.COUNSELLOR) {
      throw new ForbiddenException('Counsellors cannot change tenant settings');
    }
    const actorId = actor.id;
    const tenantId = currentTenantId();
    const before = await this.getAll();
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    const upsert = (key: string, value: Prisma.InputJsonValue) =>
      this.prisma.systemSetting.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: {
          tenantId,
          key,
          value,
          updatedBy: actorId,
        },
        update: { value, updatedBy: actorId },
      });

    if (dto.whtRatePercent !== undefined) {
      ops.push(upsert(KEYS.whtRatePercent, dto.whtRatePercent));
    }
    if (dto.enabledCurrencies !== undefined) {
      ops.push(upsert(KEYS.enabledCurrencies, dto.enabledCurrencies));
      ops.push(
        this.prisma.currency.updateMany({
          data: { isEnabled: false },
        }),
      );
      for (const code of dto.enabledCurrencies) {
        ops.push(
          this.prisma.currency.updateMany({
            where: { code },
            data: { isEnabled: true },
          }),
        );
      }
    }
    if (dto.fiscalPeriodLockedUntil !== undefined) {
      const fiscalValue =
        dto.fiscalPeriodLockedUntil === null
          ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue)
          : dto.fiscalPeriodLockedUntil;
      ops.push(upsert(KEYS.fiscalPeriodLockedUntil, fiscalValue));
    }
    if (dto.orgName !== undefined) {
      ops.push(upsert(KEYS.orgName, dto.orgName));
    }

    const brandMap: Array<[keyof UpdateSettingsDto, string]> = [
      ['invoiceAddress', KEYS.address],
      ['invoicePhone', KEYS.phone],
      ['invoiceEmail', KEYS.email],
      ['invoiceWebsite', KEYS.website],
      ['invoiceFooter', KEYS.footer],
      ['invoiceDocumentTitle', KEYS.documentTitle],
      ['invoiceAccentColor', KEYS.accentColor],
      ['invoiceEmailSubject', KEYS.emailSubject],
      ['invoiceEmailBody', KEYS.emailBody],
      ['invoiceCompanyLegalName', KEYS.companyLegalName],
      ['invoiceBankName', KEYS.bankName],
      ['invoiceBankBranch', KEYS.bankBranch],
      ['invoiceBankCity', KEYS.bankCity],
      ['invoiceAccountTitle', KEYS.accountTitle],
      ['invoiceAccountNo', KEYS.accountNo],
      ['invoiceSwiftCode', KEYS.swiftCode],
      ['invoiceIban', KEYS.iban],
    ];
    for (const [field, key] of brandMap) {
      const val = dto[field];
      if (val !== undefined) {
        ops.push(upsert(key, val as Prisma.InputJsonValue));
      }
    }

    if (ops.length) {
      await this.prisma.$transaction(ops);
    }

    const after = await this.getAll();
    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'SystemSetting',
      beforeData: before as unknown as Prisma.InputJsonValue,
      afterData: after as unknown as Prisma.InputJsonValue,
    });
    return after;
  }

  async uploadInvoiceLogo(file: Express.Multer.File, actorId: string) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Logo file is required');
    }
    const ext = extname(file.originalname || '').toLowerCase();
    if (!LOGO_MIME[ext]) {
      throw new BadRequestException(
        'Logo must be PNG, JPG, WEBP, or GIF',
      );
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('Logo must be under 2 MB');
    }

    const tenantId = currentTenantId();
    const existing = await this.getInvoiceBranding();
    if (existing.logoPath) {
      const oldAbs = this.resolveUploadPath(existing.logoPath);
      if (existsSync(oldAbs)) {
        try {
          unlinkSync(oldAbs);
        } catch {
          /* ignore */
        }
      }
    }

    const dirRel = join(tenantId, 'branding');
    const dirAbs = join(this.uploadRoot, dirRel);
    if (!existsSync(dirAbs)) mkdirSync(dirAbs, { recursive: true });
    const filename = `logo-${randomUUID()}${ext}`;
    const rel = join(dirRel, filename).replace(/\\/g, '/');
    writeFileSync(join(this.uploadRoot, rel), file.buffer);

    await this.prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId, key: KEYS.logoPath } },
      create: {
        tenantId,
        key: KEYS.logoPath,
        value: rel,
        updatedBy: actorId,
      },
      update: { value: rel, updatedBy: actorId },
    });

    await this.audit.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'Settings',
      entityType: 'InvoiceLogo',
      afterData: { logoPath: rel },
    });

    return this.getAll();
  }

  async removeInvoiceLogo(actorId: string) {
    const tenantId = currentTenantId();
    const existing = await this.getInvoiceBranding();
    if (existing.logoPath) {
      const abs = this.resolveUploadPath(existing.logoPath);
      if (existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch {
          /* ignore */
        }
      }
    }
    await this.prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId, key: KEYS.logoPath } },
      create: {
        tenantId,
        key: KEYS.logoPath,
        value: Prisma.JsonNull as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
      update: {
        value: Prisma.JsonNull as unknown as Prisma.InputJsonValue,
        updatedBy: actorId,
      },
    });
    await this.audit.log({
      userId: actorId,
      action: 'DELETE',
      module: 'Settings',
      entityType: 'InvoiceLogo',
    });
    return this.getAll();
  }

  async streamInvoiceLogo() {
    const branding = await this.getInvoiceBranding();
    if (!branding.logoPath || !branding.hasLogo) {
      throw new NotFoundException('No invoice logo uploaded');
    }
    const abs = this.resolveUploadPath(branding.logoPath);
    const ext = extname(abs).toLowerCase();
    return {
      stream: createReadStream(abs),
      mimeType: LOGO_MIME[ext] || 'application/octet-stream',
    };
  }
}
