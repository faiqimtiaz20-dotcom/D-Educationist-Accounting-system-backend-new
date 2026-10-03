require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const base = 'http://127.0.0.1:3001/api/v1'

async function req(method, path, token, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

async function main() {
  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  const token = login.data.accessToken
  const prisma = new PrismaClient()

  const branches = await req('GET', '/branches', token)
  const branch = branches.data.find((b) => b.code === 'KHI')

  const oi = await req('POST', '/other-invoices', token, {
    branchId: branch.id,
    invoiceDate: '2026-09-22',
    billTo: 'Test Client',
    category: 'Marketing',
    currencyCode: 'PKR',
    status: 'Draft',
    lines: [{ description: 'Ad campaign', quantity: 1, unitPrice: 50000 }],
  })
  const oiSend = await req('PATCH', `/other-invoices/${oi.data.id}`, token, {
    status: 'Sent',
  })
  const oiJe = await prisma.journalEntry.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: 'OtherInvoice',
        sourceId: oi.data.id,
      },
    },
    include: { lines: true },
  })

  const invs = await req('GET', '/invoices', token)
  const inv = invs.data.find(
    (i) => i.status === 'Sent' || i.status === 'PartiallyReceived',
  )
  const banks = await req('GET', '/bank-accounts', token)
  const bank =
    banks.data.find((b) => b.currencyCode === inv.currencyCode) || banks.data[0]

  const bulk = await req('POST', '/receivables', token, {
    branchId: inv.branchId,
    bankAccountId: bank.id,
    currencyCode: inv.currencyCode,
    amountReceived: 50,
    exchangeRate: Number(inv.exchangeRate) || 355,
    receiptDate: '2026-09-22',
    isBulkRemittance: true,
  })
  const bulkJe = await prisma.journalEntry.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: 'Receivable',
        sourceId: bulk.data.id,
      },
    },
  })
  const alloc = await req('POST', `/receivables/${bulk.data.id}/allocate`, token, {
    allocations: [{ invoiceId: inv.id, allocatedAmount: 50 }],
  })
  const child = await prisma.receivable.findFirst({
    where: {
      isBulkRemittance: false,
      notes: { contains: bulk.data.receiptNo },
    },
  })
  const childJe = child
    ? await prisma.journalEntry.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'Receivable',
            sourceId: child.id,
          },
        },
      })
    : null

  const dups = await prisma.$queryRawUnsafe(`
    SELECT source_type, source_id, COUNT(*)::int AS c
    FROM journal_entries
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    GROUP BY source_type, source_id
    HAVING COUNT(*) > 1
  `)

  // double-send should not create second JE
  const resent = await req('POST', `/invoices/${inv.id}/send`, token)
  const invJeCount = await prisma.journalEntry.count({
    where: { sourceType: 'Invoice', sourceId: inv.id },
  })

  await prisma.$disconnect()

  console.log(
    JSON.stringify(
      {
        otherInvoice: {
          create: oi.status,
          send: oiSend.status,
          status: oiSend.data?.status,
          jeExists: Boolean(oiJe),
          jeLines: oiJe?.lines?.length ?? 0,
        },
        bulk: {
          create: bulk.status,
          noJeOnBulkParent: !bulkJe,
          allocate: alloc.status,
          allocStatus: alloc.data?.allocationStatus,
          childReceipt: Boolean(child),
          childJe: Boolean(childJe),
        },
        doublePostGuard: {
          resendStatus: resent.status,
          invoiceJeCount: invJeCount,
          duplicateSourcePairs: dups.length,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
