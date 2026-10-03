/**
 * One-shot retest of REV-008: split one bulk remittance across two open invoices.
 * The suite runner picked a zero-outstanding invoice (0 is falsy) and got a correct 400.
 */
require('dotenv').config()

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1'
const pwd = process.env.SEED_PASSWORD || 'ChangeMe123!'

async function req(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  let payload
  if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

function unwrap(list) {
  if (Array.isArray(list)) return list
  if (list?.items) return list.items
  return []
}

async function main() {
  const login = await req('POST', '/auth/login', null, { email: 'admin@saa.com', password: pwd })
  if (!login.data?.accessToken) {
    console.log(JSON.stringify({ ok: false, step: 'login', login }, null, 2))
    process.exit(1)
  }
  const T = login.data.accessToken
  await req('PATCH', '/settings', T, { fiscalPeriodLockedUntil: null })

  const branches = unwrap((await req('GET', '/branches', T)).data)
  const khi = branches.find((b) => b.code === 'KHI')
  const universities = unwrap((await req('GET', '/universities', T)).data)
  const uni = universities[0]
  const banks = unwrap((await req('GET', '/bank-accounts', T)).data)
  const bank = banks.find((b) => b.branchId === khi.id) || banks[0]
  const students = unwrap((await req('GET', '/students?take=5', T)).data)
  const student = students[0]
  if (!khi || !uni || !bank || !student) {
    console.log(JSON.stringify({ ok: false, step: 'fixtures', khi: !!khi, uni: !!uni, bank: !!bank, student: !!student }))
    process.exit(1)
  }

  const stamp = Date.now().toString(36)
  const created = []
  for (const label of ['A', 'B']) {
    const draft = await req('POST', '/invoices', T, {
      branchId: khi.id,
      universityId: uni.id,
      invoiceDate: '2026-09-28',
      currencyCode: 'PKR',
      exchangeRate: 1,
      lines: [{
        studentId: student.id,
        tuitionFee: 100000,
        scholarship: 0,
        commissionRate: 10,
        bonus: 0,
      }],
    })
    if (draft.status >= 300 || !draft.data?.id) {
      console.log(JSON.stringify({ ok: false, step: 'draft', label, draft }, null, 2))
      process.exit(1)
    }
    const sent = await req('POST', `/invoices/${draft.data.id}/send`, T)
    const got = await req('GET', `/invoices/${draft.data.id}`, T)
    created.push({ label, id: draft.data.id, no: draft.data.invoiceNo, send: sent.status, invoice: got.data })
  }

  const outstandingOf = (inv) => {
    const lines = inv.lines || []
    const total = lines.reduce((s, l) => s + Number(l.commissionAmount || 0), 0)
    const paid = (inv.receivables || []).reduce((s, r) => s + Number(r.amountReceived || 0), 0)
    return Math.round((total - paid) * 100) / 100
  }
  const o1 = outstandingOf(created[0].invoice)
  const o2 = outstandingOf(created[1].invoice)
  const part = Math.min(1000, o1, o2)
  if (part <= 0) {
    console.log(JSON.stringify({ ok: false, step: 'outstanding', o1, o2, sample: created[0].invoice }, null, 2))
    process.exit(1)
  }

  const bulk = await req('POST', '/receivables', T, {
    branchId: khi.id,
    bankAccountId: bank.id,
    currencyCode: 'PKR',
    amountReceived: part * 2,
    exchangeRate: 1,
    receiptDate: '2026-09-28',
    isBulkRemittance: true,
  })
  const alloc = bulk.data?.id ? await req('POST', `/receivables/${bulk.data.id}/allocate`, T, {
    allocations: [
      { invoiceId: created[0].id, allocatedAmount: part },
      { invoiceId: created[1].id, allocatedAmount: part },
    ],
  }) : { status: 0, data: null }

  const after = []
  for (const c of created) {
    const got = await req('GET', `/invoices/${c.id}`, T)
    after.push({ no: c.no, status: got.data?.status, outstanding: outstandingOf(got.data || {}) })
  }

  const pass = bulk.status < 300 && alloc.status < 300 && after.every((a) => a.outstanding === o1 - part || a.outstanding === o2 - part)
  console.log(JSON.stringify({
    case: 'REV-008',
    pass,
    invoices: created.map((c) => ({ no: c.no, send: c.send, outstandingBefore: outstandingOf(c.invoice) })),
    bulk: { status: bulk.status, id: bulk.data?.id, body: bulk.status >= 300 ? bulk.data : undefined },
    alloc: { status: alloc.status, body: alloc.status >= 300 ? alloc.data : { keys: alloc.data && Object.keys(alloc.data) } },
    after,
    part,
    stamp,
  }, null, 2))
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
