require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const base = 'http://127.0.0.1:3001/api/v1'
const prisma = new PrismaClient()

function round2(n) {
  return Math.round(n * 100) / 100
}

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

function monthBounds(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return {
    from: new Date(Date.UTC(y, m, 1)),
    to: new Date(Date.UTC(y, m + 1, 1)),
  }
}

async function expectedMetrics() {
  const month = monthBounds()
  const rev = await prisma.receivable.aggregate({
    where: { receiptDate: { gte: month.from, lt: month.to } },
    _sum: { amountPkrNet: true },
  })
  const exp = await prisma.expense.aggregate({
    where: {
      approvalStatus: 'Approved',
      expenseDate: { gte: month.from, lt: month.to },
    },
    _sum: { total: true },
  })
  const monthlyRevenue = round2(Number(rev._sum.amountPkrNet ?? 0))
  const monthlyExpenses = round2(Number(exp._sum.total ?? 0))

  const petty = await prisma.pettyCashEntry.groupBy({
    by: ['entryType'],
    _sum: { total: true },
  })
  let pettyIn = 0
  let pettyOut = 0
  for (const g of petty) {
    const sum = Number(g._sum.total ?? 0)
    if (g.entryType === 'in') pettyIn += sum
    else pettyOut += sum
  }

  const accounts = await prisma.bankAccount.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, openingBalance: true },
  })
  let bankBalance = 0
  for (const a of accounts) {
    const aggs = await prisma.bankTransaction.groupBy({
      by: ['txnType'],
      where: { bankAccountId: a.id },
      _sum: { amount: true },
    })
    let movement = 0
    for (const g of aggs) {
      const sum = Number(g._sum.amount ?? 0)
      if (g.txnType === 'deposit') movement += sum
      else movement -= sum
    }
    bankBalance += Number(a.openingBalance) + movement
  }

  return {
    monthlyRevenue,
    monthlyExpenses,
    netProfit: round2(monthlyRevenue - monthlyExpenses),
    pettyCashBalance: round2(pettyIn - pettyOut),
    bankBalance: round2(bankBalance),
  }
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

  const metrics = await req('GET', '/dashboard/metrics', token)
  out.metrics = {
    status: metrics.status,
    monthlyRevenue: metrics.data?.monthlyRevenue,
    monthlyExpenses: metrics.data?.monthlyExpenses,
    netProfit: metrics.data?.netProfit,
    bankBalance: metrics.data?.bankBalance,
    pettyCashBalance: metrics.data?.pettyCashBalance,
    err: metrics.status >= 400 ? metrics.data : undefined,
  }

  const expected = await expectedMetrics()
  out.match = {
    expected,
    ok:
      metrics.data?.monthlyRevenue === expected.monthlyRevenue &&
      metrics.data?.monthlyExpenses === expected.monthlyExpenses &&
      metrics.data?.netProfit === expected.netProfit &&
      metrics.data?.bankBalance === expected.bankBalance &&
      metrics.data?.pettyCashBalance === expected.pettyCashBalance,
  }

  const charts = {}
  for (const p of [
    '/dashboard/charts/commission-by-university',
    '/dashboard/charts/receivables-ageing',
    '/dashboard/charts/branch-profit',
    '/dashboard/charts/monthly-trend',
  ]) {
    const r = await req('GET', p, token)
    charts[p] = {
      status: r.status,
      count: Array.isArray(r.data) ? r.data.length : null,
    }
  }
  out.charts = charts

  const fatima = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: 'ChangeMe123!',
  })
  const cDash = await req(
    'GET',
    '/dashboard/counsellor',
    fatima.data?.accessToken,
  )
  out.counsellor = {
    status: cDash.status,
    total: cDash.data?.totalStudents,
    active: cDash.data?.activeStudents,
    err: cDash.status >= 400 ? cDash.data : undefined,
  }

  // Counsellor should only see own students
  const dbCount = await prisma.student.count({
    where: {
      deletedAt: null,
      counsellor: { email: 'fatima@saa.com' },
    },
  })
  out.counsellorMatch = {
    api: cDash.data?.totalStudents,
    db: dbCount,
    ok: cDash.data?.totalStudents === dbCount,
  }

  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M12' &&
    out.metrics?.status === 200 &&
    out.match?.ok &&
    Object.values(out.charts).every((c) => c.status === 200) &&
    out.counsellor?.status === 200 &&
    out.counsellorMatch?.ok

  if (!ok) {
    console.error('VERIFY M12 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M12 OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
