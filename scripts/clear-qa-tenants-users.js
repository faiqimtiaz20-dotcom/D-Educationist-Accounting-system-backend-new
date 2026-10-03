const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const KEEP_TENANT_CODES = new Set(['DED']);
const KEEP_USER_EMAILS = new Set([
  'admin@saa.com',
  'ahmed@saa.com',
  'sara@saa.com',
  'bilal@saa.com',
  'fatima@saa.com',
  'usman@saa.com',
  'hina@saa.com',
  'zain@saa.com',
  'crm@platform.local',
]);

async function main() {
  console.log('Removing QA tenants and QA users...');

  const tenants = await prisma.tenant.findMany({
    select: { id: true, code: true },
  });
  const dropTenantIds = tenants
    .filter((t) => !KEEP_TENANT_CODES.has(t.code))
    .map((t) => t.id);

  // Users on drop tenants + qa.user.* on DED
  const qaUsers = await prisma.user.findMany({
    where: {
      OR: [
        { tenantId: { in: dropTenantIds } },
        { email: { startsWith: 'qa.user.' } },
        { email: { endsWith: '@example.local' } },
        { email: 'admin@demo.local' },
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
    // Null out FKs that may block delete (audit already truncated)
    await prisma.user.deleteMany({ where: { id: { in: qaUserIds } } });
    console.log(
      'Deleted users:',
      qaUsers.map((u) => u.email).join(', '),
    );
  }

  if (dropTenantIds.length) {
    await prisma.branch.deleteMany({ where: { tenantId: { in: dropTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: dropTenantIds } } });
    console.log(
      'Deleted tenants:',
      tenants
        .filter((t) => dropTenantIds.includes(t.id))
        .map((t) => t.code)
        .join(', '),
    );
  }

  // Soft-safety: remove any remaining users not in keep list
  const leftover = await prisma.user.findMany({
    where: {
      deletedAt: null,
      NOT: { email: { in: [...KEEP_USER_EMAILS] } },
    },
    select: { id: true, email: true },
  });
  if (leftover.length) {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: leftover.map((u) => u.id) } },
    });
    await prisma.userBranchAccess.deleteMany({
      where: { userId: { in: leftover.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: leftover.map((u) => u.id) } },
    });
    console.log(
      'Deleted leftover users:',
      leftover.map((u) => u.email).join(', '),
    );
  }

  const remainingTenants = await prisma.tenant.findMany({
    select: { code: true, name: true },
  });
  const remainingUsers = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { email: true },
    orderBy: { email: 'asc' },
  });
  console.log('Remaining tenants:', remainingTenants.map((t) => t.code).join(', '));
  console.log('Remaining users:', remainingUsers.map((u) => u.email).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
