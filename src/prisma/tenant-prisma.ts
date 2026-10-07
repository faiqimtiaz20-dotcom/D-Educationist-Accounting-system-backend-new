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
 * update/delete require a *unique* where. Prisma accepts extended unique
 * (`{ id, tenantId }`) but rejects `{ AND: [{ id }, { tenantId }] }` → 500.
 */
function scopeUniqueWhere(existing: unknown, tenantId: string) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return { tenantId };
  }
  const w = existing as Record<string, unknown>;
  if ('AND' in w || 'OR' in w || 'NOT' in w) {
    return { AND: [existing, { tenantId }] };
  }
  if (w.tenantId !== undefined && w.tenantId !== tenantId) {
    // Force correct tenant — never allow cross-tenant unique match
    return { ...w, tenantId };
  }
  return { ...w, tenantId };
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
            // Merge tenantId onto unique where (valid Prisma extended unique).
            // Do NOT wrap as AND — that is not UserWhereUniqueInput and 500s.
            // Do NOT pre-read via base client (breaks interactive $transaction).
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
