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

function computeSalary(basicSalary, allowances) {
  const gross = Math.round((basicSalary + allowances) * 100) / 100
  const taxableMonthly = gross * 0.9
  const annual = taxableMonthly * 12
  let annualTax
  if (annual <= 600000) annualTax = annual * 0.025
  else if (annual <= 1200000) annualTax = annual * 0.075
  else annualTax = annual * 0.125
  const monthlyTax = Math.round(annualTax / 12)
  const netSalary = Math.round(gross - monthlyTax)
  return { gross, salaryTax: monthlyTax, netSalary }
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

  const branches = await req('GET', '/branches', token)
  const khi =
    (branches.data || []).find((b) => b.code === 'KHI') ||
    (branches.data || [])[0]

  const employees = await req('GET', '/employees', token)
  out.employees = {
    status: employees.status,
    count: Array.isArray(employees.data) ? employees.data.length : 0,
  }

  const slabs = await req('GET', '/salary-tax-slabs', token)
  out.slabs = {
    status: slabs.status,
    count: Array.isArray(slabs.data) ? slabs.data.length : 0,
  }

  const expected = computeSalary(80000, 10000)
  const created = await req('POST', '/employees', token, {
    fullName: `Verify Emp ${Date.now()}`,
    branchId: khi?.id,
    designation: 'Tester',
    basicSalary: 80000,
    allowances: 10000,
  })
  out.createEmp = {
    status: created.status,
    id: created.data?.id,
    salaryTax: created.data?.salaryTax,
    taxOk: created.data?.salaryTax === expected.salaryTax,
    netOk: created.data?.netSalary === expected.netSalary,
    err: created.status >= 400 ? created.data : undefined,
  }

  const period = '2026-10'
  // Clean any prior verify run for Oct
  if (khi?.id) {
    await prisma.payrollRun.deleteMany({
      where: { branchId: khi.id, period, source: 'Internal' },
    })
  }

  const processed = await req('POST', '/payroll-runs/process', token, {
    period,
    branchId: khi?.id,
  })
  out.process = {
    status: processed.status,
    id: processed.data?.id,
    statusRun: processed.data?.status,
    lines: processed.data?.lines?.length,
    totalTax: processed.data?.totalTax,
    totalReimb: processed.data?.totalReimbursements,
    err: processed.status >= 400 ? processed.data : undefined,
  }

  // Tax reproducibility: sum of line taxes === totalTax
  const taxSum = (processed.data?.lines || []).reduce(
    (s, l) => s + Number(l.salaryTax),
    0,
  )
  out.taxRepro = {
    lineSum: taxSum,
    totalTax: processed.data?.totalTax,
    ok: taxSum === processed.data?.totalTax,
  }

  const dup = await req('POST', '/payroll-runs/process', token, {
    period,
    branchId: khi?.id,
  })
  out.dupBlocked = { status: dup.status, ok: dup.status === 409 }

  let paidOk = false
  if (processed.data?.id) {
    const paid = await req(
      'POST',
      `/payroll-runs/${processed.data.id}/pay`,
      token,
    )
    out.pay = {
      status: paid.status,
      runStatus: paid.data?.status,
      err: paid.status >= 400 ? paid.data : undefined,
    }
    paidOk = paid.data?.status === 'Paid'

    const je = await prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'Payroll',
          sourceId: processed.data.id,
        },
      },
      include: { lines: true },
    })
    const jeDebit = (je?.lines || []).reduce((s, l) => s + Number(l.debit), 0)
    const jeCredit = (je?.lines || []).reduce((s, l) => s + Number(l.credit), 0)
    out.gl = {
      found: Boolean(je),
      balanced: Math.abs(jeDebit - jeCredit) < 0.02,
      debit: Math.round(jeDebit * 100) / 100,
      credit: Math.round(jeCredit * 100) / 100,
    }
  }

  const reimb = await req('POST', '/reimbursements', token, {
    employeeId: created.data?.id,
    branchId: khi?.id,
    reimbursementType: 'Fuel',
    amount: 2500,
    reimbursementDate: '2026-11-02',
    description: 'Verify fuel',
  })
  out.reimb = {
    status: reimb.status,
    id: reimb.data?.id,
    err: reimb.status >= 400 ? reimb.data : undefined,
  }
  if (reimb.data?.id) {
    const appr = await req(
      'POST',
      `/reimbursements/${reimb.data.id}/approve`,
      token,
    )
    out.reimbApprove = { status: appr.status, statusVal: appr.data?.status }
  }

  const runs = await req('GET', '/payroll-runs?period=2026-10', token)
  out.listRuns = {
    status: runs.status,
    count: Array.isArray(runs.data) ? runs.data.length : 0,
  }

  // cleanup verify employee soft
  if (created.data?.id) {
    await req('DELETE', `/employees/${created.data.id}`, token)
  }

  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M10' &&
    out.employees?.status === 200 &&
    out.employees?.count > 0 &&
    out.slabs?.status === 200 &&
    out.slabs?.count >= 3 &&
    out.createEmp?.status === 201 &&
    out.createEmp?.taxOk &&
    out.process?.status === 201 &&
    out.process?.statusRun === 'Processed' &&
    out.taxRepro?.ok &&
    out.dupBlocked?.ok &&
    paidOk &&
    out.gl?.found &&
    out.gl?.balanced &&
    out.reimb?.status === 201 &&
    out.reimbApprove?.statusVal === 'Approved' &&
    out.listRuns?.status === 200

  if (!ok) {
    console.error('VERIFY M10 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M10 OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
