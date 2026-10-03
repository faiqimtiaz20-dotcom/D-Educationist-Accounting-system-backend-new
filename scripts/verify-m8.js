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
    '/journal-entries',
    '/gl/trial-balance',
    '/gl/chart',
    '/gl/accounts/1120/activity',
  ]) {
    const r = await req('GET', p, token)
    lists[p] = {
      status: r.status,
      count: Array.isArray(r.data)
        ? r.data.length
        : Array.isArray(r.data?.rows)
          ? r.data.rows.length
          : Array.isArray(r.data?.entries)
            ? r.data.entries.length
            : null,
      balanced: r.data?.balanced,
      err: r.status >= 400 ? r.data : undefined,
    }
  }
  out.lists = lists

  const branches = await req('GET', '/branches', token)
  const branch =
    (branches.data || []).find((b) => b.code === 'KHI') ||
    (branches.data || [])[0]
  const students = await req('GET', '/students', token)
  const student = (students.data || [])[0]
  const vendors = await req('GET', '/vendors', token)
  const vendor = (vendors.data || [])[0]
  const agents = await req('GET', '/sub-agents', token)
  const agent = (agents.data || [])[0]

  // Unbalanced reject
  const unbalanced = await req('POST', '/journal-entries', token, {
    branchId: branch?.id,
    entryDate: '2026-09-28',
    description: 'unbalanced',
    lines: [
      { accountCode: '1110', debit: 100, credit: 0 },
      { accountCode: '1120', debit: 0, credit: 50 },
    ],
  })
  out.unbalancedReject = {
    status: unbalanced.status,
    ok: unbalanced.status >= 400,
  }

  // Create draft manual
  const created = await req('POST', '/journal-entries', token, {
    branchId: branch?.id,
    entryDate: '2026-09-28',
    description: `Verify M8 manual ${Date.now()}`,
    lines: [
      { accountCode: '1110', debit: 5000, credit: 0 },
      { accountCode: '1120', debit: 0, credit: 5000 },
    ],
  })
  out.create = {
    status: created.status,
    id: created.data?.id,
    entryNo: created.data?.entryNo,
    approval: created.data?.approvalStatus,
    err: created.status >= 400 ? created.data : undefined,
  }

  if (created.data?.id) {
    const approved = await req(
      'POST',
      `/journal-entries/${created.data.id}/approve`,
      token,
    )
    out.approve = {
      status: approved.status,
      approval: approved.data?.approvalStatus,
    }

    const tb = await req('GET', '/gl/trial-balance', token)
    out.trialAfter = {
      status: tb.status,
      balanced: tb.data?.balanced,
      rows: tb.data?.rows?.length,
    }

    const activity = await req('GET', '/gl/accounts/1110/activity', token)
    out.cashActivity = {
      status: activity.status,
      entries: activity.data?.entries?.length,
      closing: activity.data?.closingBalance,
    }

    const reversed = await req(
      'POST',
      `/journal-entries/${created.data.id}/reverse`,
      token,
      { reason: 'Verify reverse' },
    )
    out.reverse = {
      status: reversed.status,
      sourceType: reversed.data?.sourceType,
      err: reversed.status >= 400 ? reversed.data : undefined,
    }

    const doubleReverse = await req(
      'POST',
      `/journal-entries/${created.data.id}/reverse`,
      token,
      {},
    )
    out.doubleReverseBlocked = {
      status: doubleReverse.status,
      ok: doubleReverse.status === 409,
    }

    const delBlocked = await req(
      'DELETE',
      `/journal-entries/${created.data.id}`,
      token,
    )
    out.deleteApprovedBlocked = {
      status: delBlocked.status,
      ok: delBlocked.status === 409,
    }
  }

  // Fiscal lock
  const locked = await req('POST', '/journal-entries', token, {
    branchId: branch?.id,
    entryDate: '2020-01-01',
    description: 'locked',
    lines: [
      { accountCode: '1110', debit: 10, credit: 0 },
      { accountCode: '1120', debit: 0, credit: 10 },
    ],
  })
  out.fiscalLock = { status: locked.status, ok: locked.status >= 400 }

  // Party ledgers
  if (student?.id) {
    const sl = await req('GET', `/ledgers/students/${student.id}`, token)
    out.studentLedger = {
      status: sl.status,
      entries: sl.data?.entries?.length,
      party: sl.data?.partyName,
    }
  }
  if (vendor?.id) {
    const vl = await req('GET', `/ledgers/vendors/${vendor.id}`, token)
    out.vendorLedger = {
      status: vl.status,
      entries: vl.data?.entries?.length,
      party: vl.data?.partyName,
    }
  }
  if (agent?.id) {
    const al = await req('GET', `/ledgers/sub-agents/${agent.id}`, token)
    out.subAgentLedger = {
      status: al.status,
      entries: al.data?.entries?.length,
      party: al.data?.partyName,
    }
  }

  console.log(JSON.stringify(out, null, 2))

  const ok =
    out.health?.milestone === 'M8' &&
    out.lists['/journal-entries']?.status === 200 &&
    out.lists['/gl/trial-balance']?.status === 200 &&
    out.unbalancedReject?.ok &&
    out.create?.status === 201 &&
    out.approve?.approval === 'Approved' &&
    out.trialAfter?.balanced &&
    out.reverse?.sourceType === 'Reversal' &&
    out.doubleReverseBlocked?.ok &&
    out.deleteApprovedBlocked?.ok &&
    out.fiscalLock?.ok &&
    out.studentLedger?.status === 200 &&
    out.vendorLedger?.status === 200 &&
    out.subAgentLedger?.status === 200

  if (!ok) {
    console.error('VERIFY M8 FAILED')
    process.exit(1)
  }
  console.log('VERIFY M8 OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
