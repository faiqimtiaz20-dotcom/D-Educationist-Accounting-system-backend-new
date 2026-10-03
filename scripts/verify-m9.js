require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const base = 'http://127.0.0.1:3001/api/v1'
const prisma = new PrismaClient()

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

function round2(n) {
  return Math.round(n * 100) / 100
}

async function expectedFromDb(period) {
  const [y, m] = period.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1))
  const to = new Date(Date.UTC(y, m, 1))

  const rem = await prisma.receivable.aggregate({
    where: { receiptDate: { gte: from, lt: to } },
    _sum: { whtAmountPkr: true },
  })

  const payments = await prisma.subAgentPayment.findMany({
    where: { paymentDate: { gte: from, lt: to } },
    include: {
      commission: { select: { whtPkr: true, payablePkrNet: true } },
    },
  })
  let whtPayable = 0
  for (const p of payments) {
    const net = Number(p.commission.payablePkrNet)
    const wht = Number(p.commission.whtPkr)
    if (net > 0 && wht > 0) {
      whtPayable = round2(whtPayable + (Number(p.amountPkr) / net) * wht)
    }
  }

  const expensesIt = await prisma.expense.aggregate({
    where: {
      expenseDate: { gte: from, lt: to },
      approvalStatus: 'Approved',
    },
    _sum: { incomeTax: true },
  })
  whtPayable = round2(whtPayable + Number(expensesIt._sum.incomeTax ?? 0))

  const expenses = await prisma.expense.aggregate({
    where: {
      expenseDate: { gte: from, lt: to },
      approvalStatus: 'Approved',
    },
    _sum: { gst: true, salesTax: true, srbSst: true },
  })
  const petty = await prisma.pettyCashEntry.aggregate({
    where: { entryDate: { gte: from, lt: to }, entryType: 'out' },
    _sum: { gst: true, salesTax: true, srbSst: true },
  })

  const gstInput = round2(
    Number(expenses._sum.gst ?? 0) +
      Number(expenses._sum.salesTax ?? 0) +
      Number(petty._sum.gst ?? 0) +
      Number(petty._sum.salesTax ?? 0),
  )
  const srbSst = round2(
    Number(expenses._sum.srbSst ?? 0) + Number(petty._sum.srbSst ?? 0),
  )

  const salary = await prisma.payrollLine.aggregate({
    where: {
      payrollRun: {
        period,
        status: { in: ['Processed', 'Paid'] },
      },
    },
    _sum: { salaryTax: true },
  })

  const manuals = await prisma.taxRecord.findMany({
    where: { period, sourceType: 'Manual' },
  })
  let gstOutput = 0
  let manWhtR = 0
  let manWhtP = 0
  let manGstIn = 0
  let manSrb = 0
  let manSal = 0
  for (const m of manuals) {
    const a = Number(m.amount)
    if (m.taxType === 'GstOutput') gstOutput = round2(gstOutput + a)
    if (m.taxType === 'WhtReceivable') manWhtR = round2(manWhtR + a)
    if (m.taxType === 'WhtPayable') manWhtP = round2(manWhtP + a)
    if (m.taxType === 'GstInput') manGstIn = round2(manGstIn + a)
    if (m.taxType === 'SrbSst') manSrb = round2(manSrb + a)
    if (m.taxType === 'SalaryTax') manSal = round2(manSal + a)
  }

  return {
    whtReceivable: round2(Number(rem._sum.whtAmountPkr ?? 0) + manWhtR),
    whtPayable: round2(whtPayable + manWhtP),
    gstInput: round2(gstInput + manGstIn),
    gstOutput,
    srbSst: round2(srbSst + manSrb),
    salaryTax: round2(Number(salary._sum.salaryTax ?? 0) + manSal),
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

  const period = '2026-09'
  const summary = await req('GET', `/tax/summary?period=${period}`, token)
  out.summary = {
    status: summary.status,
    period: summary.data?.period,
    whtReceivable: summary.data?.whtReceivable,
    whtPayable: summary.data?.whtPayable,
    gstInput: summary.data?.gstInput,
    gstOutput: summary.data?.gstOutput,
    srbSst: summary.data?.srbSst,
    salaryTax: summary.data?.salaryTax,
    records: summary.data?.records?.length,
    err: summary.status >= 400 ? summary.data : undefined,
  }

  const expected = await expectedFromDb(period)
  out.match = {
    expected,
    actual: {
      whtReceivable: summary.data?.whtReceivable,
      whtPayable: summary.data?.whtPayable,
      gstInput: summary.data?.gstInput,
      gstOutput: summary.data?.gstOutput,
      srbSst: summary.data?.srbSst,
      salaryTax: summary.data?.salaryTax,
    },
    ok:
      summary.data?.whtReceivable === expected.whtReceivable &&
      summary.data?.whtPayable === expected.whtPayable &&
      summary.data?.gstInput === expected.gstInput &&
      summary.data?.gstOutput === expected.gstOutput &&
      summary.data?.srbSst === expected.srbSst &&
      summary.data?.salaryTax === expected.salaryTax,
  }

  const badPeriod = await req('GET', '/tax/summary?period=2026-13', token)
  out.badPeriod = { status: badPeriod.status, ok: badPeriod.status >= 400 }

  const branches = await req('GET', '/branches', token)
  const branch =
    (branches.data || []).find((b) => b.code === 'KHI') ||
    (branches.data || [])[0]

  const created = await req('POST', '/tax/records', token, {
    taxType: 'GstOutput',
    period,
    branchId: branch?.id,
    amount: 100,
    note: 'Verify M9 adjustment',
  })
  out.create = {
    status: created.status,
    id: created.data?.id,
    err: created.status >= 400 ? created.data : undefined,
  }

  if (created.data?.id) {
    const after = await req('GET', `/tax/summary?period=${period}`, token)
    out.afterCreate = {
      gstOutput: after.data?.gstOutput,
      bumped: after.data?.gstOutput === round2(expected.gstOutput + 100),
    }

    const patched = await req(
      'PATCH',
      `/tax/records/${created.data.id}`,
      token,
      { amount: 150 },
    )
    out.patch = { status: patched.status }

    const afterPatch = await req('GET', `/tax/summary?period=${period}`, token)
    out.afterPatch = {
      gstOutput: afterPatch.data?.gstOutput,
      bumped: afterPatch.data?.gstOutput === round2(expected.gstOutput + 150),
    }

    const del = await req(
      'DELETE',
      `/tax/records/${created.data.id}`,
      token,
    )
    out.delete = { status: del.status, ok: del.status === 200 }

    const restored = await req('GET', `/tax/summary?period=${period}`, token)
    out.restored = {
      gstOutput: restored.data?.gstOutput,
      ok: restored.data?.gstOutput === expected.gstOutput,
    }
  }

  const records = await req('GET', `/tax/records?period=${period}`, token)
  out.recordsList = {
    status: records.status,
    count: Array.isArray(records.data) ? records.data.length : null,
  }

  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M9' &&
    out.summary?.status === 200 &&
    out.match?.ok &&
    out.badPeriod?.ok &&
    out.create?.status === 201 &&
    out.afterCreate?.bumped &&
    out.patch?.status === 200 &&
    out.afterPatch?.bumped &&
    out.delete?.ok &&
    out.restored?.ok &&
    out.recordsList?.status === 200 &&
    (out.summary?.whtReceivable ?? 0) > 0 &&
    (out.summary?.gstInput ?? 0) > 0 &&
    (out.summary?.salaryTax ?? 0) > 0

  if (!ok) {
    console.error('VERIFY M9 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M9 OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
