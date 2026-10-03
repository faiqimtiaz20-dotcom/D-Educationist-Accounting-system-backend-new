require('dotenv').config()

const base = 'http://127.0.0.1:3001/api/v1'

const SLUGS = [
  'branch-income',
  'branch-expenses',
  'branch-profit',
  'branch-cash',
  'university-wise-pl',
  'consolidated-pl',
  'consolidated-bs',
  'consolidated-cf',
  'trial-balance',
  'cash-book',
  'bank-book',
  'journal-register',
  'expense-report',
  'income-report',
  'receivable-ageing',
  'payable-ageing',
  'petty-cash',
  'wht-summary',
  'gst-summary',
  'salary-tax',
  'commission-tracking',
  'subagent-payout',
  'net-margin',
  'counsellor',
  'country-wise',
  'university-wise',
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
  return { status: res.status, data, headers: res.headers }
}

async function main() {
  const out = { ok: true, reports: {}, fails: [] }

  const health = await req('GET', '/health')
  out.health = { status: health.status, milestone: health.data?.milestone }
  if (health.data?.milestone !== 'M13') {
    out.ok = false
    out.fails.push(`health milestone expected M13 got ${health.data?.milestone}`)
  }

  const login = await req('POST', '/auth/login', null, {
    email: 'admin@saa.com',
    password: 'ChangeMe123!',
  })
  const token = login.data?.accessToken
  out.login = { status: login.status }
  if (!token) {
    console.log(JSON.stringify({ ...out, ok: false, error: 'login failed' }, null, 2))
    process.exit(1)
  }

  const catalog = await req('GET', '/reports', token)
  out.catalog = {
    status: catalog.status,
    count: Array.isArray(catalog.data) ? catalog.data.length : 0,
  }
  if (catalog.status !== 200 || catalog.data?.length !== SLUGS.length) {
    out.ok = false
    out.fails.push(
      `catalog expected ${SLUGS.length} got ${catalog.data?.length} status ${catalog.status}`,
    )
  }

  for (const slug of SLUGS) {
    const q =
      slug === 'wht-summary' || slug === 'gst-summary' || slug === 'salary-tax'
        ? '?period=2026-09'
        : ''
    const r = await req('GET', `/reports/${slug}${q}`, token)
    const rows = r.data?.rows
    const pass =
      r.status === 200 &&
      Array.isArray(r.data?.columns) &&
      Array.isArray(rows) &&
      r.data?.slug === slug &&
      Array.isArray(r.data?.exportFormats) &&
      r.data.exportFormats.includes('csv')
    out.reports[slug] = {
      status: r.status,
      rows: Array.isArray(rows) ? rows.length : -1,
      columns: Array.isArray(r.data?.columns) ? r.data.columns.length : -1,
      pass,
      err: pass ? undefined : r.data,
    }
    if (!pass) {
      out.ok = false
      out.fails.push(slug)
    }
  }

  const csv = await req('GET', '/reports/trial-balance/csv', token)
  const csvOk =
    csv.status === 200 &&
    typeof csv.data === 'string' &&
    csv.data.includes(',')
  out.csv = { status: csv.status, ok: csvOk, sample: String(csv.data).slice(0, 80) }
  if (!csvOk) {
    out.ok = false
    out.fails.push('csv')
  }

  // Counsellor restricted catalog
  const cLogin = await req('POST', '/auth/login', null, {
    email: 'fatima@saa.com',
    password: 'ChangeMe123!',
  })
  const cToken = cLogin.data?.accessToken
  if (cToken) {
    const cCat = await req('GET', '/reports', cToken)
    const forbidden = await req('GET', '/reports/trial-balance', cToken)
    const allowed = await req('GET', '/reports/counsellor', cToken)
    out.counsellor = {
      catalogCount: Array.isArray(cCat.data) ? cCat.data.length : -1,
      catalogOk:
        Array.isArray(cCat.data) &&
        cCat.data.length === 3 &&
        cCat.data.every((r) => r.counsellorAllowed === true),
      trialBalanceStatus: forbidden.status,
      counsellorStatus: allowed.status,
    }
    if (
      forbidden.status !== 403 ||
      allowed.status !== 200 ||
      !out.counsellor.catalogOk
    ) {
      out.ok = false
      out.fails.push('counsellor-scope')
    }
  } else {
    out.counsellor = { skipped: true, reason: 'login fatima@saa.com failed' }
  }

  console.log(JSON.stringify(out, null, 2))
  process.exit(out.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
