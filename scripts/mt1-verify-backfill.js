const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();
const tid = 'a0000000-0000-4000-8000-000000000001';

async function main() {
  const tenants = await p.tenant.findMany();
  console.log('tenants', JSON.stringify(tenants, null, 2));
  console.log('counts', {
    branches: await p.branch.count({ where: { tenantId: tid } }),
    users: await p.user.count({ where: { tenantId: tid } }),
    usersNull: await p.user.count({ where: { tenantId: null } }),
    students: await p.student.count({ where: { tenantId: tid } }),
    invoices: await p.invoice.count({ where: { tenantId: tid } }),
    gl: await p.glAccount.count({ where: { tenantId: tid } }),
    settings: await p.systemSetting.count({ where: { tenantId: tid } }),
    audit: await p.auditLog.count({ where: { tenantId: tid } }),
    auditNull: await p.auditLog.count({ where: { tenantId: null } }),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
