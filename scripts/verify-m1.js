require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const tables = await p.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY 1
  `)
  console.log('TABLE_COUNT', tables.length)
  for (const t of tables) console.log('TABLE', t.table_name)

  const trig = await p.$queryRawUnsafe(`
    SELECT tgname, c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND tgname LIKE '%journal%'
  `)
  console.log('TRIGGERS', JSON.stringify(trig, null, 2))

  const mig = await p.$queryRawUnsafe(`
    SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
    FROM _prisma_migrations
    ORDER BY finished_at
  `)
  console.log('MIGRATIONS', JSON.stringify(mig, null, 2))

  const counts = await p.$queryRawUnsafe(`
    SELECT 'users' AS t, COUNT(*)::int AS c FROM users
    UNION ALL SELECT 'branches', COUNT(*)::int FROM branches
    UNION ALL SELECT 'roles', COUNT(*)::int FROM roles
    UNION ALL SELECT 'invoices', COUNT(*)::int FROM invoices
    UNION ALL SELECT 'students', COUNT(*)::int FROM students
    UNION ALL SELECT 'gl_accounts', COUNT(*)::int FROM gl_accounts
  `)
  console.log('ROW_COUNTS', JSON.stringify(counts))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await p.$disconnect()
  })
