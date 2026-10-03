const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

async function main() {
  const cols = await p.$queryRawUnsafe(`
    SELECT table_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name
  `);
  console.log(JSON.stringify(cols, null, 2));
  console.log('count', cols.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
