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

function round2(n) {
  return Math.round(n * 100) / 100
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
  for (const p of [
    '/sub-agent-commissions',
    '/sub-agent-payments',
    '/sub-agents',
    '/invoices',
    '/students',
    '/bank-accounts',
  ]) {
    const r = await req('GET', p, token)
    lists[p] = {
      status: r.status,
      count: Array.isArray(r.data) ? r.data.length : null,
      err: r.status >= 400 ? r.data : undefined,
    }
  }
  out.lists = lists

  const students = await req('GET', '/students', token)
  const branches = await req('GET', '/branches', token)
  const agents = await req('GET', '/sub-agents', token)
  const invoices = await req('GET', '/invoices', token)
  const banks = await req('GET', '/bank-accounts', token)

  const branch =
    (branches.data || []).find((b) => b.code === 'KHI') ||
    (branches.data || []).find((b) => !b.isHeadOffice)
  const student =
    (students.data || []).find((s) => s.branchId === branch?.id) ||
    (students.data || [])[0]
  const agent = (agents.data || [])[0]
  const invoice =
    (invoices.data || []).find(
      (i) => i.branchId === (student?.branchId || branch?.id),
    ) || (invoices.data || [])[0]
  const pkrBank =
    (banks.data || []).find((b) => b.currencyCode === 'PKR') ||
    (banks.data || [])[0]

  // Unique commission: pick student+invoice+agent combo, or create fresh invoice line student
  const createBody = {
    subAgentId: agent?.id,
    studentId: student?.id,
    invoiceId: invoice?.id,
    branchId: student?.branchId || branch?.id,
    grossFee: 10000,
    rateGiven: 25,
    exchangeRate: 355,
    followOnBonus: 500,
    currencyCode: student?.currencyCode || 'GBP',
    status: 'Pending',
  }

  const expectedGross = round2(
    createBody.grossFee * (createBody.rateGiven / 100) * createBody.exchangeRate +
      createBody.followOnBonus,
  )
  const expectedWht = round2(expectedGross * 0.01)
  const expectedNet = round2(expectedGross - expectedWht)

  let created = await req('POST', '/sub-agent-commissions', token, createBody)
  // If unique conflict, try a different agent
  if (created.status === 409 && (agents.data || []).length > 1) {
    createBody.subAgentId = agents.data[1].id
    created = await req('POST', '/sub-agent-commissions', token, createBody)
  }

  out.createCommission = {
    status: created.status,
    id: created.data?.id,
    payablePkrNet: created.data?.payablePkrNet,
    expectedNet,
    calcOk:
      created.data &&
      Math.abs(Number(created.data.payablePkrNet) - expectedNet) < 0.02,
    err: created.status >= 400 ? created.data : undefined,
  }

  if (created.data?.id) {
    const prisma = new PrismaClient()
    const ledgerBefore = await req(
      'GET',
      `/sub-agents/${createBody.subAgentId}/ledger`,
      token,
    )
    out.ledgerBefore = {
      status: ledgerBefore.status,
      outstanding: ledgerBefore.data?.outstanding,
      entries: ledgerBefore.data?.entries?.length,
    }

    const payAmount = round2(expectedNet * 0.4)
    const payment = await req('POST', '/sub-agent-payments', token, {
      commissionId: created.data.id,
      bankAccountId: pkrBank?.id,
      amountPkr: payAmount,
      paymentDate: '2026-09-25',
      chequeNo: `CHQ-V6-${Date.now().toString().slice(-6)}`,
      currencyCode: 'PKR',
    })
    out.payment = {
      status: payment.status,
      id: payment.data?.id,
      amount: payment.data?.amountPkr,
      err: payment.status >= 400 ? payment.data : undefined,
    }

    if (payment.data?.id) {
      const je = await prisma.journalEntry.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'SubAgentPayment',
            sourceId: payment.data.id,
          },
        },
        include: { lines: { include: { glAccount: true } } },
      })
      const codes = (je?.lines || []).map((l) => l.glAccount.code).sort()
      out.paymentJe = {
        exists: Boolean(je),
        entryNo: je?.entryNo,
        lines: je?.lines?.length,
        codes,
        balanced:
          je &&
          Math.abs(
            je.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
          ) < 0.02,
        has5100: codes.includes('5100'),
        has2200: codes.includes('2200'),
        has1120: codes.includes('1120'),
      }

      const comm = await req(
        'GET',
        `/sub-agent-commissions/${created.data.id}`,
        token,
      )
      out.commissionStatus = {
        status: comm.status,
        commissionStatus: comm.data?.status,
        partialOk: comm.data?.status === 'Partial',
      }

      const overpay = await req('POST', '/sub-agent-payments', token, {
        commissionId: created.data.id,
        bankAccountId: pkrBank?.id,
        amountPkr: expectedNet + 1000,
        paymentDate: '2026-09-26',
        chequeNo: 'CHQ-OVER',
      })
      out.overpayRejected = {
        status: overpay.status,
        ok: overpay.status >= 400,
      }

      const delPay = await req(
        'DELETE',
        `/sub-agent-payments/${payment.data.id}`,
        token,
      )
      out.deletePostedBlocked = {
        status: delPay.status,
        ok: delPay.status === 409,
      }

      const locked = await req('POST', '/sub-agent-payments', token, {
        commissionId: created.data.id,
        bankAccountId: pkrBank?.id,
        amountPkr: 1,
        paymentDate: '2020-01-01',
        chequeNo: 'CHQ-LOCK',
      })
      out.fiscalLock = {
        status: locked.status,
        ok: locked.status >= 400,
        err: locked.status >= 400 ? locked.data : undefined,
      }

      // Pay remaining → Paid
      const remaining = round2(expectedNet - payAmount)
      const pay2 = await req('POST', '/sub-agent-payments', token, {
        commissionId: created.data.id,
        bankAccountId: pkrBank?.id,
        amountPkr: remaining,
        paymentDate: '2026-09-27',
        chequeNo: `CHQ-V6F-${Date.now().toString().slice(-6)}`,
      })
      out.payRemaining = {
        status: pay2.status,
        err: pay2.status >= 400 ? pay2.data : undefined,
      }
      const comm2 = await req(
        'GET',
        `/sub-agent-commissions/${created.data.id}`,
        token,
      )
      out.paidStatus = {
        commissionStatus: comm2.data?.status,
        paidOk: comm2.data?.status === 'Paid',
      }

      const ledgerAfter = await req(
        'GET',
        `/sub-agents/${createBody.subAgentId}/ledger`,
        token,
      )
      out.ledgerAfter = {
        status: ledgerAfter.status,
        outstanding: ledgerAfter.data?.outstanding,
        totalPaid: ledgerAfter.data?.totalPaid,
      }
    }

    await prisma.$disconnect()
  }

  console.log(JSON.stringify(out, null, 2))
  const ok =
    out.health?.milestone === 'M6' &&
    out.createCommission?.calcOk &&
    out.payment?.status === 201 &&
    out.paymentJe?.exists &&
    out.paymentJe?.balanced &&
    out.paymentJe?.has5100 &&
    out.commissionStatus?.partialOk &&
    out.overpayRejected?.ok &&
    out.deletePostedBlocked?.ok &&
    out.paidStatus?.paidOk
  if (!ok) {
    console.error('VERIFY M6 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M6 OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
