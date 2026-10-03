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
  for (const p of [
    '/petty-cash',
    '/expenses',
    '/bank-accounts-balances',
    '/bank-transactions',
    '/cheques',
    '/contra-entries',
    '/expense-categories',
    '/petty-cash-categories',
  ]) {
    const r = await req('GET', p, token)
    lists[p] = {
      status: r.status,
      count: Array.isArray(r.data) ? r.data.length : null,
      err: r.status >= 400 ? r.data : undefined,
    }
  }
  out.lists = lists

  const branches = await req('GET', '/branches', token)
  const branch =
    (branches.data || []).find((b) => b.code === 'KHI') ||
    (branches.data || [])[0]
  const pettyCats = await req('GET', '/petty-cash-categories', token)
  const expCats = await req('GET', '/expense-categories', token)
  const banks = await req('GET', '/bank-accounts-balances', token)
  const vendors = await req('GET', '/vendors', token)

  const stationery =
    (pettyCats.data || []).find((c) => c.name === 'Stationery') ||
    (pettyCats.data || [])[0]
  const marketing =
    (expCats.data || []).find((c) => c.name === 'Marketing') ||
    (expCats.data || [])[0]
  const pkrBank =
    (banks.data || []).find((b) => b.currencyCode === 'PKR') ||
    (banks.data || [])[0]
  const vendor = (vendors.data || [])[0]

  const prisma = new PrismaClient()

  // Petty cash out → GL
  const pc = await req('POST', '/petty-cash', token, {
    branchId: branch?.id,
    entryDate: '2026-09-24',
    categoryId: stationery?.id,
    description: `Verify M7 petty ${Date.now()}`,
    entryType: 'out',
    principal: 900,
    gst: 100,
  })
  out.pettyCash = {
    status: pc.status,
    id: pc.data?.id,
    total: pc.data?.total,
    err: pc.status >= 400 ? pc.data : undefined,
  }
  if (pc.data?.id) {
    const je = await prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: { sourceType: 'PettyCash', sourceId: pc.data.id },
      },
      include: { lines: { include: { glAccount: true } } },
    })
    const codes = (je?.lines || []).map((l) => l.glAccount.code).sort()
    out.pettyJe = {
      exists: Boolean(je),
      balanced:
        je &&
        Math.abs(
          je.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
        ) < 0.02,
      codes,
      has1110: codes.includes('1110'),
      has5200: codes.includes('5200'),
    }
  }

  // Expense create → approve → GL
  const ex = await req('POST', '/expenses', token, {
    branchId: branch?.id,
    vendorId: vendor?.id,
    vendorName: vendor?.name || 'Test Vendor',
    categoryId: marketing?.id,
    expenseDate: '2026-09-24',
    principal: 10000,
    gst: 1700,
    paymentMode: 'Bank',
    bankAccountId: pkrBank?.id,
  })
  out.expenseCreate = {
    status: ex.status,
    id: ex.data?.id,
    approval: ex.data?.approvalStatus,
    err: ex.status >= 400 ? ex.data : undefined,
  }

  if (ex.data?.id) {
    const approved = await req('POST', `/expenses/${ex.data.id}/approve`, token)
    out.expenseApprove = {
      status: approved.status,
      approval: approved.data?.approvalStatus,
      err: approved.status >= 400 ? approved.data : undefined,
    }
    const je = await prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'Expense',
          sourceId: ex.data.id,
        },
      },
      include: { lines: { include: { glAccount: true } } },
    })
    const codes = (je?.lines || []).map((l) => l.glAccount.code).sort()
    out.expenseJe = {
      exists: Boolean(je),
      balanced:
        je &&
        Math.abs(
          je.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
        ) < 0.02,
      codes,
      has5200: codes.includes('5200'),
      has1120: codes.includes('1120'),
      has1310: codes.includes('1310'),
    }

    const delBlocked = await req('DELETE', `/expenses/${ex.data.id}`, token)
    out.deleteApprovedBlocked = {
      status: delBlocked.status,
      ok: delBlocked.status === 409,
    }
  }

  // Cheque + clear
  const chq = await req('POST', '/cheques', token, {
    chequeNo: `CHQ-V7-${Date.now().toString().slice(-6)}`,
    bankAccountId: pkrBank?.id,
    payee: 'Verify Payee',
    amount: 5000,
    issueDate: '2026-09-24',
  })
  out.cheque = {
    status: chq.status,
    id: chq.data?.id,
    err: chq.status >= 400 ? chq.data : undefined,
  }
  if (chq.data?.id) {
    const cleared = await req('PATCH', `/cheques/${chq.data.id}/status`, token, {
      status: 'Cleared',
      clearedDate: '2026-09-25',
    })
    out.chequeClear = {
      status: cleared.status,
      chequeStatus: cleared.data?.status,
    }
  }

  // Contra CashBank
  const contra = await req('POST', '/contra-entries', token, {
    branchId: branch?.id,
    entryDate: '2026-09-24',
    contraType: 'CashBank',
    amount: 15000,
    fromIsCash: true,
    toBankAccountId: pkrBank?.id,
  })
  out.contra = {
    status: contra.status,
    id: contra.data?.id,
    err: contra.status >= 400 ? contra.data : undefined,
  }
  if (contra.data?.id) {
    const je = await prisma.journalEntry.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'Contra',
          sourceId: contra.data.id,
        },
      },
      include: { lines: true },
    })
    out.contraJe = {
      exists: Boolean(je),
      balanced:
        je &&
        Math.abs(
          je.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
        ) < 0.02,
    }
  }

  // Fiscal lock
  const locked = await req('POST', '/petty-cash', token, {
    branchId: branch?.id,
    entryDate: '2020-01-01',
    categoryId: stationery?.id,
    description: 'locked',
    entryType: 'out',
    principal: 10,
  })
  out.fiscalLock = { status: locked.status, ok: locked.status >= 400 }

  await prisma.$disconnect()
  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M7' &&
    out.pettyCash?.status === 201 &&
    out.pettyJe?.exists &&
    out.pettyJe?.balanced &&
    out.expenseCreate?.status === 201 &&
    out.expenseApprove?.approval === 'Approved' &&
    out.expenseJe?.exists &&
    out.expenseJe?.balanced &&
    out.deleteApprovedBlocked?.ok &&
    out.cheque?.status === 201 &&
    out.chequeClear?.chequeStatus === 'Cleared' &&
    out.contra?.status === 201 &&
    out.contraJe?.exists &&
    out.fiscalLock?.ok

  if (!ok) {
    console.error('VERIFY M7 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M7 OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
