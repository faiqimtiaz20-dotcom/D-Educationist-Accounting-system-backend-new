/**
 * M14 smoke: login + hit every primary sidebar API the UI depends on.
 * Run with API up: node scripts/verify-m14.js
 */
require('dotenv').config()

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1'

/** Sidebar-aligned API paths (business data). */
const ROUTES = [
  { name: 'health', method: 'GET', path: '/health', auth: false },
  { name: 'me', method: 'GET', path: '/auth/me' },
  { name: 'dashboard-metrics', method: 'GET', path: '/dashboard/metrics' },
  { name: 'students', method: 'GET', path: '/students?take=25&skip=0' },
  { name: 'invoices', method: 'GET', path: '/invoices' },
  { name: 'other-invoices', method: 'GET', path: '/other-invoices' },
  { name: 'receivables', method: 'GET', path: '/receivables' },
  { name: 'sub-agents', method: 'GET', path: '/sub-agents' },
  { name: 'sub-agent-commissions', method: 'GET', path: '/sub-agent-commissions' },
  { name: 'sub-agent-payments', method: 'GET', path: '/sub-agent-payments' },
  { name: 'petty-cash', method: 'GET', path: '/petty-cash' },
  { name: 'expenses', method: 'GET', path: '/expenses' },
  { name: 'bank-accounts', method: 'GET', path: '/bank-accounts' },
  { name: 'journal-entries', method: 'GET', path: '/journal-entries?take=50&skip=0' },
  { name: 'gl-trial-balance', method: 'GET', path: '/gl/trial-balance' },
  { name: 'tax-summary', method: 'GET', path: '/tax/summary?period=2026-09' },
  { name: 'employees', method: 'GET', path: '/employees' },
  { name: 'payroll-runs', method: 'GET', path: '/payroll-runs' },
  { name: 'approvals', method: 'GET', path: '/approvals' },
  { name: 'documents', method: 'GET', path: '/documents' },
  { name: 'audit-logs', method: 'GET', path: '/audit-logs?take=25&skip=0' },
  { name: 'reports-catalog', method: 'GET', path: '/reports' },
  { name: 'report-trial-balance', method: 'GET', path: '/reports/trial-balance' },
  { name: 'branches', method: 'GET', path: '/branches' },
  { name: 'users', method: 'GET', path: '/users' },
  { name: 'settings', method: 'GET', path: '/settings' },
]

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
  const out = { ok: true, fails: [], routes: {} }

  const health = await req('GET', '/health')
  out.health = { status: health.status, milestone: health.data?.milestone }
  if (health.data?.milestone !== 'M14') {
    out.ok = false
    out.fails.push(`milestone expected M14 got ${health.data?.milestone}`)
  }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  const token = login.data?.accessToken
  if (!token) {
    console.log(JSON.stringify({ ok: false, login }, null, 2))
    process.exit(1)
  }

  // Pagination shape checks
  const students = await req('GET', '/students?take=2&skip=0', token)
  const journals = await req('GET', '/journal-entries?take=2&skip=0', token)
  const audits = await req('GET', '/audit-logs?take=2&skip=0', token)
  out.pagination = {
    students: {
      status: students.status,
      hasItems: Array.isArray(students.data?.items),
      total: students.data?.total,
    },
    journals: {
      status: journals.status,
      hasItems: Array.isArray(journals.data?.items),
      total: journals.data?.total,
    },
    audits: {
      status: audits.status,
      hasItems: Array.isArray(audits.data?.items),
      total: audits.data?.total,
    },
  }
  for (const [k, v] of Object.entries(out.pagination)) {
    if (v.status !== 200 || !v.hasItems) {
      out.ok = false
      out.fails.push(`pagination:${k}`)
    }
  }

  // Counsellor 403 on financial report
  const cLogin = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: 'ChangeMe123!',
  })
  const cToken = cLogin.data?.accessToken
  if (cToken) {
    const forbidden = await req('GET', '/reports/trial-balance', cToken)
    out.counsellor403 = { status: forbidden.status }
    if (forbidden.status !== 403) {
      out.ok = false
      out.fails.push('counsellor-403')
    }
  }

  for (const r of ROUTES) {
    if (!r.auth && r.name === 'health') {
      out.routes[r.name] = { status: health.status, pass: health.status === 200 }
      continue
    }
    const res = await req(r.method, r.path, token)
    const pass = res.status >= 200 && res.status < 300
    out.routes[r.name] = { status: res.status, pass }
    if (!pass) {
      out.ok = false
      out.fails.push(r.name)
    }
  }

  console.log(JSON.stringify(out, null, 2))
  process.exit(out.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
