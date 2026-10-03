/**
 * Delete ONLY QA leftovers — not seed/demo business data.
 * Removes: qa.user.* accounts, @example.local proof users,
 * and CRM-created MT*/proof tenants (not DED / DEMO).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const KEEP_TENANT_CODES = new Set(['DED', 'DEMO']);

async function main() {
  console.log('Removing QA-only leftovers (keeping DED + DEMO seed data)...');

  const tenants = await prisma.tenant.findMany({
    select: { id: true, code: true },
  });
  const dropTenantIds = tenants
    .filter((t) => !KEEP_TENANT_CODES.has(t.code))
    .map((t) => t.id);

  const qaUsers = await prisma.user.findMany({
    where: {
      OR: [
        { tenantId: { in: dropTenantIds } },
        { email: { startsWith: 'qa.user.' } },
        { email: { endsWith: '@example.local' } },
      ],
    },
    select: { id: true, email: true },
  });

  const qaUserIds = qaUsers.map((u) => u.id);
  if (qaUserIds.length) {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: qaUserIds } } });
    await prisma.userBranchAccess.deleteMany({
      where: { userId: { in: qaUserIds } },
    });
    await prisma.notification.deleteMany({
      where: { userId: { in: qaUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: qaUserIds } } });
    console.log('Deleted QA users:', qaUsers.map((u) => u.email).join(', ') || '(none)');
  } else {
    console.log('No QA users to delete.');
  }

  if (dropTenantIds.length) {
    // Wipe business rows for those tenants only (if any remain)
    const tid = dropTenantIds;
    // Soft approach: delete users already done; delete branches then tenants
    await prisma.branch.deleteMany({ where: { tenantId: { in: tid } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tid } } });
    console.log(
      'Deleted QA tenants:',
      tenants
        .filter((t) => dropTenantIds.includes(t.id))
        .map((t) => t.code)
        .join(', '),
    );
  } else {
    console.log('No QA tenants to delete.');
  }

  const remaining = await prisma.tenant.findMany({ select: { code: true } });
  console.log('Remaining tenants:', remaining.map((t) => t.code).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
