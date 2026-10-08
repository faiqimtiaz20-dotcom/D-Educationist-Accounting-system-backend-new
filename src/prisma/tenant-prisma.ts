import { PrismaClient } from '@prisma/client';
import { TenantContext } from '../common/tenant-context';
import { isTenantedPrismaModel } from '../common/tenanted-models';
import { NotFoundException } from '@nestjs/common';

const FILTER_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

function andWhere(existing: unknown, tenantId: string) {
  if (!existing || typeof existing !== 'object') {
    return { tenantId };
  }
  return { AND: [existing, { tenantId }] };
}

/**
 * update / delete / upsert require a *unique* where.
 *
 * Prisma accepts extended unique `{ id, tenantId }` for PK lookups.
 * It REJECTS:
 * - `{ AND: [{ id }, { tenantId }] }`
 * - compound unique + extra top-level fields, e.g.
 *   `{ tenantId_code: {…}, tenantId }` or `{ sourceType_sourceId: {…}, tenantId }`
 * Those validation failures surface as HTTP 500.
 */
function scopeUniqueWhere(existing: unknown, tenantId: string) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return { tenantId };
  }
  const w = existing as Record<string, unknown>;

  if ('AND' in w || 'OR' in w || 'NOT' in w) {
    const parts = Array.isArray(w.AND) ? w.AND : [];
    for (const part of parts) {
      if (
        part &&
        typeof part === 'object' &&
        !Array.isArray(part) &&
        'id' in part &&
        typeof (part as { id: unknown }).id === 'string'
      ) {
        return { id: (part as { id: string }).id, tenantId };
      }
    }
    // Unsafe fallback — prefer id extraction above
    return { AND: [existing, { tenantId }] };
  }

  const keys = Object.keys(w);

  // Already a tenant-scoped compound unique: tenantId_code, tenantId_key, …
  if (keys.some((k) => k.startsWith('tenantId_'))) {
    return w;
  }

  // Other compound uniques (sourceType_sourceId, bankAccountId_chequeNo, …)
  // — do not append tenantId (invalid WhereUniqueInput).
  if (keys.some((k) => k.includes('_'))) {
    return w;
  }

  // Unique on tenantId alone (e.g. TenantSmtpConfig)
  if (keys.length === 1 && keys[0] === 'tenantId') {
    return { tenantId };
  }

  if (w.tenantId !== undefined && w.tenantId !== tenantId) {
    return { ...w, tenantId };
  }
  if (w.tenantId === tenantId) {
    return w;
  }

  // Primary-key style — extend with tenantId for cross-tenant safety
  if ('id' in w) {
    return { id: w.id, tenantId };
  }

  // Globally unique fields (e.g. email) — leave unchanged
  return w;
}

function injectCreateData(data: Record<string, unknown>, tenantId: string) {
  if (data.tenantId === undefined || data.tenantId === null) {
    return { ...data, tenantId };
  }
  return data;
}

/**
 * Prisma client extension: when TenantContext has a tenantId, force it onto
 * business-model queries/writes so domain services cannot leak across tenants.
 */
export function createTenantExtendedPrisma() {
  const base = new PrismaClient();

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = TenantContext.getTenantId();
          if (!tenantId || !isTenantedPrismaModel(model)) {
            return query(args);
          }

          const a = { ...(args as Record<string, unknown>) };

          if (FILTER_OPS.has(operation)) {
            a.where = andWhere(a.where, tenantId);
            return query(a);
          }

          if (operation === 'create') {
            a.data = injectCreateData(
              (a.data as Record<string, unknown>) || {},
              tenantId,
            );
            return query(a);
          }

          if (operation === 'createMany') {
            const data = a.data;
            if (Array.isArray(data)) {
              a.data = data.map((row) =>
                injectCreateData(
                  (row as Record<string, unknown>) || {},
                  tenantId,
                ),
              );
            } else if (data && typeof data === 'object') {
              a.data = injectCreateData(
                data as Record<string, unknown>,
                tenantId,
              );
            }
            return query(a);
          }

          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const result = (await query(a)) as {
              tenantId?: string | null;
            } | null;
            if (
              result &&
              result.tenantId != null &&
              result.tenantId !== tenantId
            ) {
              if (operation === 'findUniqueOrThrow') {
                throw new NotFoundException(`${model} not found`);
              }
              return null;
            }
            return result;
          }

          if (operation === 'update' || operation === 'delete') {
            a.where = scopeUniqueWhere(a.where, tenantId);
            try {
              return await query(a);
            } catch (err) {
              const code =
                err && typeof err === 'object' && 'code' in err
                  ? String((err as { code?: string }).code)
                  : '';
              if (code === 'P2025') {
                throw new NotFoundException(`${model} not found`);
              }
              throw err;
            }
          }

          if (operation === 'upsert') {
            a.where = scopeUniqueWhere(a.where, tenantId);
            a.create = injectCreateData(
              (a.create as Record<string, unknown>) || {},
              tenantId,
            );
            return query(a);
          }

          return query(a);
        },
      },
    },
  });
}

export type TenantPrismaClient = ReturnType<typeof createTenantExtendedPrisma>;
