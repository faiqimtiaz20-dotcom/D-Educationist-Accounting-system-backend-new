/**
 * Tenant isolation QA — TN-ISO-001 … TN-ISO-015
 *
 * Actors: Tenant A = DED (admin@saa.com), Tenant B = DEMO (admin@demo.local),
 *         CRM = crm@platform.local
 *
 * Usage: node scripts/qa-run-tenant-isolation.js
 * Output: docs/qa/evidence/tenant-isolation-results.json
 *         docs/qa/TENANT-ISOLATION-RESULTS.md
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1'
const pwd = process.env.SEED_PASSWORD || 'ChangeMe123!'
const stamp = Date.now().toString(36)

const ALL_IDS = Array.from({ length: 15 }, (_, i) =>
  `TN-ISO-${String(i + 1).padStart(3, '0')}`,
)

async function req(method, p, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  let payload = body
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${base}${p}`, { method, headers, body: payload })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, text, contentType: res.headers.get('content-type') || '' }
}

async function login(email) {
  const r = await req('POST', '/auth/login', null, { email, password: pwd })
  if (r.status >= 400 || !r.data?.accessToken) {
    throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`)
  }
  return { token: r.data.accessToken, user: r.data.user }
}

function unwrap(list) {
  if (Array.isArray(list)) return list
  if (list?.items) return list.items
  if (list?.data && Array.isArray(list.data)) return list.data
  if (list?.rows) return list.rows
  return []
}

function result(id, status, actual, defectId = null) {
  return { id, status, actual, defectId, at: new Date().toISOString() }
}

function tenantIdOf(row) {
  return row?.tenantId || row?.tenant?.id || null
}

async function main() {
  const out = {}
  const set = (r) => {
    out[r.id] = r
  }

  const health = await req('GET', '/health')
  if (health.data?.database !== 'up' && health.status >= 400) {
    console.error('API/DB not up', health)
    process.exit(1)
  }

  const tenantA = await login('admin@saa.com')
  const tenantB = await login('admin@demo.local')
  const crm = await login('crm@platform.local')

  assertTenants(tenantA, tenantB)

  // Resolve DEMO student for cross-tenant probes
  const bStudents = unwrap((await req('GET', '/students?take=50', tenantB.token)).data)
  let demoStu = bStudents.find((s) => s.studentCode === 'DEMO-STU-001')
  if (!demoStu) {
    // create one for the suite
    const branchesB = unwrap((await req('GET', '/branches', tenantB.token)).data)
    const unisB = unwrap((await req('GET', '/universities', tenantB.token)).data)
    const ho = branchesB[0]
    const uni = unisB[0]
    if (!ho || !uni) throw new Error('DEMO missing branch/university — re-seed')
    const created = await req('POST', '/students', tenantB.token, {
      studentCode: `TNISO-B-${stamp}`,
      fullName: 'TNISO Demo Student',
      cnicPassport: `TNISO-${stamp}`,
      contact: '+92 300 1111111',
      email: `tniso.b.${stamp}@demo.local`,
      branchId: ho.id,
      counsellorId: tenantB.user.id,
      country: 'UK',
      universityId: uni.id,
      course: 'MSc',
      intake: 'Sep-2026',
      applicationStatus: 'Applied',
      tuitionFee: 1000,
      scholarship: 0,
      expectedCommissionRate: 10,
      currencyCode: 'GBP',
    })
    if (created.status >= 400) {
      throw new Error(`create DEMO student failed ${created.status} ${JSON.stringify(created.data)}`)
    }
    demoStu = created.data
  }

  const aStudents = unwrap((await req('GET', '/students?take=100', tenantA.token)).data)
  const aStu = aStudents[0]
  if (!aStu) throw new Error('DED has no students — re-seed')

  // ── TN-ISO-001 Student list A ↛ B ────────────────────────────────────────
  const leakStu = aStudents.filter(
    (s) =>
      s.studentCode === 'DEMO-STU-001' ||
      s.id === demoStu.id ||
      s.fullName === 'Demo Only Student' ||
      (tenantIdOf(s) && tenantIdOf(s) === tenantB.user.tenantId),
  )
  set(
    result(
      'TN-ISO-001',
      leakStu.length === 0 ? 'Pass' : 'Fail',
      `aCount=${aStudents.length} foreign=${leakStu.length}`,
      leakStu.length ? 'DEF-TN-ISO-001' : null,
    ),
  )

  // ── TN-ISO-002 Search does not find B student ────────────────────────────
  const searchCode = demoStu.studentCode || 'DEMO-STU-001'
  const search = await req(
    'GET',
    `/students?q=${encodeURIComponent(searchCode)}&take=50`,
    tenantA.token,
  )
  const searchHits = unwrap(search.data).filter(
    (s) => s.id === demoStu.id || s.studentCode === searchCode,
  )
  set(
    result(
      'TN-ISO-002',
      search.status === 200 && searchHits.length === 0 ? 'Pass' : 'Fail',
      `status=${search.status} hits=${searchHits.length}`,
      searchHits.length || search.status !== 200 ? 'DEF-TN-ISO-002' : null,
    ),
  )

  // ── TN-ISO-003 Direct UUID of B student ──────────────────────────────────
  const direct = await req('GET', `/students/${demoStu.id}`, tenantA.token)
  set(
    result(
      'TN-ISO-003',
      direct.status === 403 || direct.status === 404 ? 'Pass' : 'Fail',
      `status=${direct.status}`,
      direct.status < 400 ? 'DEF-TN-ISO-003' : null,
    ),
  )

  // ── TN-ISO-004 Invoices A ↛ B ────────────────────────────────────────────
  const aInvoices = unwrap((await req('GET', '/invoices?take=100', tenantA.token)).data)
  const bInvoices = unwrap((await req('GET', '/invoices?take=100', tenantB.token)).data)
  const invLeak = aInvoices.filter(
    (inv) =>
      bInvoices.some((b) => b.id === inv.id) ||
      (tenantIdOf(inv) && tenantIdOf(inv) === tenantB.user.tenantId),
  )
  // B must not see A's first invoice by id
  let invDirectOk = true
  let invDirectStatus = 'n/a'
  if (aInvoices[0]) {
    const cross = await req('GET', `/invoices/${aInvoices[0].id}`, tenantB.token)
    invDirectStatus = cross.status
    invDirectOk = cross.status === 403 || cross.status === 404
  }
  set(
    result(
      'TN-ISO-004',
      invLeak.length === 0 && invDirectOk ? 'Pass' : 'Fail',
      `a=${aInvoices.length} b=${bInvoices.length} listLeak=${invLeak.length} directB=${invDirectStatus}`,
      invLeak.length || !invDirectOk ? 'DEF-TN-ISO-004' : null,
    ),
  )

  // ── TN-ISO-005 Expenses A ↛ B ────────────────────────────────────────────
  const aExp = unwrap((await req('GET', '/expenses?take=100', tenantA.token)).data)
  const bExp = unwrap((await req('GET', '/expenses?take=100', tenantB.token)).data)
  const expLeak = aExp.filter((e) => bExp.some((x) => x.id === e.id))
  let expDirectOk = true
  let expDirectStatus = 'n/a'
  if (aExp[0]) {
    const cross = await req('GET', `/expenses/${aExp[0].id}`, tenantB.token)
    expDirectStatus = cross.status
    expDirectOk = cross.status === 403 || cross.status === 404
  }
  set(
    result(
      'TN-ISO-005',
      expLeak.length === 0 && expDirectOk ? 'Pass' : 'Fail',
      `a=${aExp.length} b=${bExp.length} listLeak=${expLeak.length} directB=${expDirectStatus}`,
      expLeak.length || !expDirectOk ? 'DEF-TN-ISO-005' : null,
    ),
  )

  // ── TN-ISO-006 Journals A ↛ B ────────────────────────────────────────────
  const aJe = unwrap((await req('GET', '/journal-entries?take=100', tenantA.token)).data)
  const bJe = unwrap((await req('GET', '/journal-entries?take=100', tenantB.token)).data)
  const jeLeak = aJe.filter((e) => bJe.some((x) => x.id === e.id))
  let jeDirectOk = true
  let jeDirectStatus = 'n/a'
  if (aJe[0]) {
    const cross = await req('GET', `/journal-entries/${aJe[0].id}`, tenantB.token)
    jeDirectStatus = cross.status
    jeDirectOk = cross.status === 403 || cross.status === 404
  }
  set(
    result(
      'TN-ISO-006',
      jeLeak.length === 0 && jeDirectOk ? 'Pass' : 'Fail',
      `a=${aJe.length} b=${bJe.length} listLeak=${jeLeak.length} directB=${jeDirectStatus}`,
      jeLeak.length || !jeDirectOk ? 'DEF-TN-ISO-006' : null,
    ),
  )

  // ── TN-ISO-007 Reports ───────────────────────────────────────────────────
  const rptA = await req('GET', '/reports/branch-income', tenantA.token)
  const rptB = await req('GET', '/reports/branch-income', tenantB.token)
  const rptAText = JSON.stringify(rptA.data || {})
  const rptBText = JSON.stringify(rptB.data || {})
  const rptLeak =
    rptAText.includes(demoStu.id) ||
    rptAText.includes('DEMO-STU-001') ||
    rptAText.includes('Demo Only Student') ||
    rptBText.includes(aStu.id)
  set(
    result(
      'TN-ISO-007',
      rptA.status === 200 && rptB.status === 200 && !rptLeak ? 'Pass' : 'Fail',
      `a=${rptA.status} b=${rptB.status} leak=${rptLeak}`,
      rptA.status !== 200 || rptB.status !== 200 || rptLeak ? 'DEF-TN-ISO-007' : null,
    ),
  )

  // ── TN-ISO-008 CSV export ────────────────────────────────────────────────
  const csvA = await fetch(`${base}/reports/branch-income/csv`, {
    headers: { Authorization: `Bearer ${tenantA.token}` },
  })
  const csvText = await csvA.text()
  const csvLeak =
    csvText.includes('DEMO-STU-001') ||
    csvText.includes('Demo Only Student') ||
    csvText.includes(demoStu.id) ||
    /\bDEMO\b/.test(csvText)
  set(
    result(
      'TN-ISO-008',
      csvA.status === 200 && !csvLeak ? 'Pass' : 'Fail',
      `status=${csvA.status} len=${csvText.length} leak=${csvLeak}`,
      csvA.status !== 200 || csvLeak ? 'DEF-TN-ISO-008' : null,
    ),
  )

  // ── TN-ISO-009 Forged tenantId rejected ──────────────────────────────────
  const forged = await req(
    'GET',
    `/students?tenantId=${tenantB.user.tenantId}`,
    tenantA.token,
  )
  // Either 403 (guard) or 200 with only A's data (query ignored)
  const forgedList = unwrap(forged.data)
  const forgedLeak = forgedList.some(
    (s) => s.id === demoStu.id || s.studentCode === 'DEMO-STU-001',
  )
  const forgedOk =
    forged.status === 403 || (forged.status === 200 && !forgedLeak)
  set(
    result(
      'TN-ISO-009',
      forgedOk ? 'Pass' : 'Fail',
      `status=${forged.status} leak=${forgedLeak}`,
      forgedOk ? null : 'DEF-TN-ISO-009',
    ),
  )

  // ── TN-ISO-010 CRM ↛ GL ──────────────────────────────────────────────────
  const crmGl = await req('GET', '/gl-accounts', crm.token)
  const crmStu = await req('GET', '/students', crm.token)
  set(
    result(
      'TN-ISO-010',
      crmGl.status === 403 && crmStu.status === 403 ? 'Pass' : 'Fail',
      `gl=${crmGl.status} students=${crmStu.status}`,
      crmGl.status !== 403 || crmStu.status !== 403 ? 'DEF-TN-ISO-010' : null,
    ),
  )

  // ── TN-ISO-011 Tenant Admin ↛ CRM APIs ───────────────────────────────────
  const crmList = await req('GET', '/crm/tenants', tenantA.token)
  set(
    result(
      'TN-ISO-011',
      crmList.status === 403 ? 'Pass' : 'Fail',
      `status=${crmList.status}`,
      crmList.status !== 403 ? 'DEF-TN-ISO-011' : null,
    ),
  )

  // ── TN-ISO-012 Universities per tenant (not shared) ──────────────────────
  const aUnis = unwrap((await req('GET', '/universities', tenantA.token)).data)
  const bUnis = unwrap((await req('GET', '/universities', tenantB.token)).data)
  const uniLeak = aUnis.some((u) => u.name === 'Demo Isolation University')
  const demoHas = bUnis.some((u) => u.name === 'Demo Isolation University')
  set(
    result(
      'TN-ISO-012',
      !uniLeak && demoHas ? 'Pass' : 'Fail',
      `aLeak=${uniLeak} demoHas=${demoHas} a=${aUnis.length} b=${bUnis.length}`,
      uniLeak || !demoHas ? 'DEF-TN-ISO-012' : null,
    ),
  )

  // ── TN-ISO-013 Settings org independent ──────────────────────────────────
  const aSet = await req('GET', '/settings', tenantA.token)
  const bSet = await req('GET', '/settings', tenantB.token)
  const settingsOk =
    aSet.status === 200 &&
    bSet.status === 200 &&
    typeof aSet.data?.orgName === 'string' &&
    typeof bSet.data?.orgName === 'string' &&
    aSet.data.orgName !== bSet.data.orgName
  set(
    result(
      'TN-ISO-013',
      settingsOk ? 'Pass' : 'Fail',
      `aOrg=${aSet.data?.orgName} bOrg=${bSet.data?.orgName}`,
      settingsOk ? null : 'DEF-TN-ISO-013',
    ),
  )

  // ── TN-ISO-014 Documents cross-tenant + upload path ──────────────────────
  let docPass = false
  let docActual = ''
  try {
    const form = new FormData()
    const blob = new Blob([`tn-iso ${stamp}`], { type: 'text/plain' })
    form.append('file', blob, `tn-iso-${stamp}.txt`)
    form.append('docType', 'Agreement')
    form.append('linkedType', 'student')
    form.append('linkedId', aStu.id)
    form.append('name', `TNISO-${stamp}`)

    const upRes = await fetch(`${base}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantA.token}` },
      body: form,
    })
    const upText = await upRes.text()
    let upData
    try {
      upData = JSON.parse(upText)
    } catch {
      upData = { raw: upText }
    }
    const keyOk =
      upRes.status < 400 &&
      typeof upData.storageKey === 'string' &&
      upData.storageKey.startsWith(`${tenantA.user.tenantId}/`)
    const crossDoc = upData.id
      ? await req('GET', `/documents/${upData.id}`, tenantB.token)
      : { status: 999 }
    const crossOk = crossDoc.status === 403 || crossDoc.status === 404
    docPass = keyOk && crossOk
    docActual = `up=${upRes.status} key=${upData.storageKey || 'n/a'} cross=${crossDoc.status}`
    // cleanup
    if (upData.id) {
      await req('DELETE', `/documents/${upData.id}`, tenantA.token)
    }
  } catch (err) {
    docActual = String(err?.message || err)
    docPass = false
  }
  set(
    result(
      'TN-ISO-014',
      docPass ? 'Pass' : 'Fail',
      docActual,
      docPass ? null : 'DEF-TN-ISO-014',
    ),
  )

  // ── TN-ISO-015 B student list ↛ A ────────────────────────────────────────
  const bList2 = unwrap((await req('GET', '/students?take=100', tenantB.token)).data)
  const bLeakA = bList2.filter(
    (s) =>
      s.id === aStu.id ||
      (tenantIdOf(s) && tenantIdOf(s) === tenantA.user.tenantId),
  )
  set(
    result(
      'TN-ISO-015',
      bLeakA.length === 0 ? 'Pass' : 'Fail',
      `bCount=${bList2.length} foreignA=${bLeakA.length}`,
      bLeakA.length ? 'DEF-TN-ISO-015' : null,
    ),
  )

  for (const id of ALL_IDS) {
    if (!out[id]) set(result(id, 'Fail', 'Not executed', 'DEF-TN-ISO-MISS'))
  }

  const summary = { Pass: 0, Fail: 0, Blocked: 0, 'N/A': 0 }
  for (const r of Object.values(out)) summary[r.status] = (summary[r.status] || 0) + 1

  const evidenceDir = path.join(__dirname, '..', '..', 'docs', 'qa', 'evidence')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const jsonPath = path.join(evidenceDir, 'tenant-isolation-results.json')
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        base,
        stamp,
        tenants: {
          A: {
            code: tenantA.user.tenantCode,
            id: tenantA.user.tenantId,
            email: tenantA.user.email,
          },
          B: {
            code: tenantB.user.tenantCode,
            id: tenantB.user.tenantId,
            email: tenantB.user.email,
          },
          CRM: { email: crm.user.email },
        },
        summary,
        results: out,
      },
      null,
      2,
    ),
  )

  const mdPath = path.join(__dirname, '..', '..', 'docs', 'qa', 'TENANT-ISOLATION-RESULTS.md')
  const fails = Object.values(out).filter((r) => r.status === 'Fail')
  const lines = [
    '# Tenant Isolation QA Results (TN-ISO-001 … 015)',
    '',
    '**Rule:** Tenant A must never see Tenant B transactional or master data. CRM Admin cannot access tenant GL/business APIs. Tenant Admin cannot call CRM APIs. Uploads live under `uploads/{tenantId}/`.',
    '',
    `**Environment:** \`${base}\`  `,
    `**Tenant A:** ${tenantA.user.tenantCode} (\`${tenantA.user.email}\`)  `,
    `**Tenant B:** ${tenantB.user.tenantCode} (\`${tenantB.user.email}\`)  `,
    `**CRM:** \`${crm.user.email}\`  `,
    `**Ran:** ${new Date().toISOString()}`,
    '',
    '## Totals',
    '',
    `| Status | Count |`,
    `| --- | ---: |`,
    `| Pass | ${summary.Pass} |`,
    `| Fail | ${summary.Fail} |`,
    `| Blocked | ${summary.Blocked || 0} |`,
    '',
    '## Results',
    '',
    `| TC ID | Status | Actual |`,
    `| --- | --- | --- |`,
    ...ALL_IDS.map((id) => {
      const r = out[id]
      return `| ${id} | **${r.status}** | ${String(r.actual).replace(/\|/g, '/')} |`
    }),
    '',
  ]
  if (fails.length) {
    lines.push('## Failures', '')
    for (const f of fails) {
      lines.push(`- **${f.id}** (${f.defectId || 'n/a'}): ${f.actual}`)
    }
    lines.push('')
  }
  lines.push(`Evidence JSON: \`docs/qa/evidence/tenant-isolation-results.json\``)
  fs.writeFileSync(mdPath, lines.join('\n'))

  console.log(JSON.stringify({ ok: summary.Fail === 0, summary, fails: fails.map((f) => f.id) }, null, 2))
  if (summary.Fail > 0) process.exit(1)
}

function assertTenants(a, b) {
  if (!a.user.tenantId || !b.user.tenantId) throw new Error('missing tenantId on login')
  if (a.user.tenantId === b.user.tenantId) throw new Error('DED and DEMO share tenantId')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
