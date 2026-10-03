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
  const out = {}
  const health = await req('GET', '/health')
  out.health = { status: health.status, milestone: health.data?.milestone }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  const token = login.data?.accessToken
  out.login = { status: login.status }

  const lists = {}
  for (const p of ['/invoices', '/other-invoices', '/receivables', '/students', '/bank-accounts']) {
    const r = await req('GET', p, token)
    lists[p] = { status: r.status, count: Array.isArray(r.data) ? r.data.length : null, err: r.status >= 400 ? r.data : undefined }
  }
  out.lists = lists

  const students = await req('GET', '/students', token)
  const branches = await req('GET', '/branches', token)
  const branch = (branches.data || []).find((b) => b.code === 'KHI') || (branches.data || []).find((b) => !b.isHeadOffice)
  const student = (students.data || []).find((s) => s.branchId === branch?.id) || (students.data || [])[0]
  const banks = await req('GET', '/bank-accounts', token)
  const bank =
    (banks.data || []).find((b) => b.currencyCode === (student?.currencyCode || 'GBP')) ||
    (banks.data || [])[0]

  const created = await req('POST', '/invoices', token, {
    branchId: student?.branchId || branch?.id,
    invoiceDate: '2026-09-20',
    currencyCode: student?.currencyCode || 'GBP',
    status: 'Draft',
    lines: [
      {
        studentId: student?.id,
        tuitionFee: Number(student?.tuitionFee) || 10000,
        scholarship: Number(student?.scholarship) || 0,
        commissionRate: Number(student?.expectedCommissionRate) || 15,
        bonus: 0,
      },
    ],
  })
  out.createDraft = {
    status: created.status,
    id: created.data?.id,
    invoiceNo: created.data?.invoiceNo,
    err: created.status >= 400 ? created.data : undefined,
  }

  if (created.data?.id) {
    const sent = await req('POST', `/invoices/${created.data.id}/send`, token)
    out.send = {
      status: sent.status,
      invStatus: sent.data?.status,
      err: sent.status >= 400 ? sent.data : undefined,
    }

    const prisma = new PrismaClient()
    const je = await prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: { sourceType: 'Invoice', sourceId: created.data.id },
      },
      include: { lines: true },
    })
    out.accrualJe = {
      exists: Boolean(je),
      entryNo: je?.entryNo,
      lines: je?.lines?.length,
      balanced:
        je &&
        Math.abs(
          je.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
        ) < 0.02,
    }

    const recv = await req('POST', '/receivables', token, {
      branchId: created.data.branchId,
      invoiceId: created.data.id,
      bankAccountId: bank?.id,
      currencyCode: created.data.currencyCode,
      amountReceived: 100,
      exchangeRate: 355,
      receiptDate: '2026-09-21',
      isPartial: true,
    })
    out.receivable = {
      status: recv.status,
      id: recv.data?.id,
      err: recv.status >= 400 ? recv.data : undefined,
    }

    if (recv.data?.id) {
      const rJe = await prisma.journalEntry.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'Receivable',
            sourceId: recv.data.id,
          },
        },
        include: { lines: true },
      })
      out.receiptJe = {
        exists: Boolean(rJe),
        lines: rJe?.lines?.length,
      }
      const inv = await prisma.invoice.findUnique({ where: { id: created.data.id } })
      out.invoiceAfterPay = inv?.status
    }

    // fiscal lock reject
    const locked = await req('POST', '/invoices', token, {
      branchId: branch?.id,
      invoiceDate: '2026-06-01',
      currencyCode: 'GBP',
      lines: [
        {
          studentId: student?.id,
          tuitionFee: 1000,
          scholarship: 0,
          commissionRate: 15,
          bonus: 0,
        },
      ],
    })
    out.fiscalLockReject = { status: locked.status, message: locked.data?.message }

    await prisma.$disconnect()
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
