const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, code: true, name: true, status: true },
    orderBy: { code: 'asc' },
  });
  console.log('tenants:', JSON.stringify(tenants, null, 2));
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { email: true, fullName: true, tenantId: true, role: { select: { code: true } } },
    orderBy: { email: 'asc' },
  });
  console.log(
    'users:',
    users.map((u) => `${u.email} | ${u.role.code} | tenant=${u.tenantId}`).join('\n'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
