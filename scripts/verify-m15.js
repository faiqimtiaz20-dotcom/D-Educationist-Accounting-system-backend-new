/**
 * M15 go-live readiness: health + golden path smoke.
 * Usage: API_BASE=http://127.0.0.1:3001/api/v1 node scripts/verify-m15.js
 */
require('dotenv').config()

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1'

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

function ok(res) {
  return res.status >= 200 && res.status < 300
}

async function main() {
  const out = { ok: true, fails: [], steps: {} }

  const health = await req('GET', '/health')
  out.steps.health = {
    status: health.status,
    milestone: health.data?.milestone,
    database: health.data?.database,
  }
  if (health.data?.milestone !== 'M15' || health.data?.database !== 'up') {
    out.ok = false
    out.fails.push('health')
  }

  const info = await req('GET', '/')
  out.steps.root = {
    status: info.status,
    milestone: info.data?.milestone,
    version: info.data?.version,
  }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: process.env.SEED_PASSWORD || 'ChangeMe123!',
  })
  const token = login.data?.accessToken
  out.steps.login = { status: login.status, hasToken: Boolean(token) }
  if (!token) {
    out.ok = false
    out.fails.push('login')
    console.log(JSON.stringify(out, null, 2))
    process.exit(1)
  }

  const me = await req('GET', '/auth/me', token)
  out.steps.me = {
    status: me.status,
    role: me.data?.user?.roleCode,
    isSuperAdmin: me.data?.user?.isSuperAdmin,
  }
  if (!ok(me) || me.data?.user?.roleCode !== 'SUPER_ADMIN') {
    out.ok = false
    out.fails.push('me')
  }

  // Golden path reads
  const pathChecks = [
    ['students', '/students?take=5&skip=0'],
    ['invoices', '/invoices'],
    ['receivables', '/receivables'],
    ['expenses', '/expenses'],
    ['journal-entries', '/journal-entries?take=10&skip=0'],
    ['dashboard', '/dashboard/metrics'],
    ['tax', '/tax/summary?period=2026-09'],
    ['reports', '/reports'],
    ['trial-balance-report', '/reports/trial-balance'],
    ['approvals', '/approvals'],
    ['audit', '/audit-logs?take=10&skip=0'],
    ['branches', '/branches'],
  ]

  for (const [name, path] of pathChecks) {
    const r = await req('GET', path, token)
    const pass = ok(r)
    out.steps[name] = { status: r.status, pass }
    if (!pass) {
      out.ok = false
      out.fails.push(name)
    }
  }

  // Students page envelope
  const st = await req('GET', '/students?take=2&skip=0', token)
  out.steps.studentsPaged = {
    status: st.status,
    items: Array.isArray(st.data?.items) ? st.data.items.length : -1,
    total: st.data?.total,
  }
  if (!Array.isArray(st.data?.items)) {
    out.ok = false
    out.fails.push('studentsPaged')
  }

  // Counsellor restriction
  const cLogin = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: process.env.SEED_PASSWORD || 'ChangeMe123!',
  })
  const cToken = cLogin.data?.accessToken
  if (cToken) {
    const forbidden = await req('GET', '/reports/trial-balance', cToken)
    const allowed = await req('GET', '/reports/counsellor', cToken)
    out.steps.counsellor = {
      trialBalance: forbidden.status,
      counsellorReport: allowed.status,
    }
    if (forbidden.status !== 403 || !ok(allowed)) {
      out.ok = false
      out.fails.push('counsellor')
    }
  } else {
    out.ok = false
    out.fails.push('counsellor-login')
  }

  // Docs presence note (files on disk — informational)
  out.handoverDocs = {
    expected: [
      'docs/DEPLOYMENT.md',
      'docs/UAT-CHECKLIST.md',
      'docs/USER-GUIDE.md',
      'docs/TRAINING-AGENDA.md',
      'docs/HANDOVER.md',
      '.env.example',
      'backend/.env.example',
      'README.md',
    ],
    note: 'Verify these files exist in the delivered archive.',
  }

  console.log(JSON.stringify(out, null, 2))
  if (!out.ok) {
    console.error('VERIFY M15 FAILED')
    process.exit(1)
  }
  console.error('VERIFY M15 OK — engineering readiness (client UAT sign-off still required)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
