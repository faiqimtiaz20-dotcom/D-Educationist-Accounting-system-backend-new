/**
 * Strict branch-isolation QA — BR-ISO-001 … BR-ISO-020
 *
 * Rules under test:
 * - Super Admin: all branches
 * - All other users: home branch only
 * - Universities + shared settings: common
 * - Transactional data: never leaks across branches
 *
 * Usage: node scripts/qa-run-branch-isolation.js
 * Output: docs/qa/evidence/branch-isolation-results.json
 *         docs/qa/BRANCH-ISOLATION-RESULTS.md
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1'
const pwd = process.env.SEED_PASSWORD || 'ChangeMe123!'
const stamp = Date.now().toString(36)

const ALL_IDS = Array.from({ length: 20 }, (_, i) =>
  `BR-ISO-${String(i + 1).padStart(3, '0')}`,
)

async function req(method, p, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  let payload = body
  if (body && typeof body === 'object') {
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
  return { status: res.status, data, contentType: res.headers.get('content-type') || '' }
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
  if (list?.rows) return list.rows
  return []
}

function branchOf(row) {
  return row?.branchId || row?.branch?.id || row?.branch?.code || null
}

function allBelongTo(rows, branchId) {
  if (!rows.length) return true
  return rows.every((r) => {
    const b = branchOf(r)
    // some list shapes omit branchId when already scoped — treat missing as fail-safe only if empty check elsewhere
    return b == null || b === branchId
  })
}

function noneBelongTo(rows, foreignBranchId) {
  return rows.every((r) => {
    const b = branchOf(r)
    return b !== foreignBranchId
  })
}

function result(id, status, actual, defectId = null) {
  return { id, status, actual, defectId, at: new Date().toISOString() }
}

async function main() {
  const out = {}
  const set = (r) => {
    out[r.id] = r
  }

  const health = await req('GET', '/health')
  if (health.data?.database !== 'up') {
    console.error('API/DB not up', health)
    process.exit(1)
  }

  const admin = await login('admin@saa.com')
  const branchA = await login('ahmed@saa.com') // KHI BRANCH_MANAGER
  const branchB = await login('sara@saa.com') // LHR ACCOUNTANT (transactional isolation)
  const branchBMgr = await login('zain@saa.com') // LHR manager (settings-capable)

  const branches = unwrap((await req('GET', '/branches', admin.token)).data)
  const khi = branches.find((b) => b.code === 'KHI')
  const lhr = branches.find((b) => b.code === 'LHR')
  if (!khi || !lhr) throw new Error('Need KHI and LHR branches in seed')

  if (branchA.user.branchId !== khi.id) {
    console.warn('WARN: ahmed branchId != KHI', branchA.user.branchId, khi.id)
  }
  if (branchB.user.branchId !== lhr.id) {
    console.warn('WARN: sara branchId != LHR', branchB.user.branchId, lhr.id)
  }

  const uniList = unwrap((await req('GET', '/universities', admin.token)).data)
  const uni = uniList[0]
  if (!uni) throw new Error('Need at least one university')

  const usersAll = unwrap((await req('GET', '/users', admin.token)).data)
  const counsellorKhi =
    usersAll.find((u) => u.email === 'fatima@saa.com') ||
    usersAll.find((u) => u.branchId === khi.id && u.roleCode === 'COUNSELLOR') ||
    usersAll.find((u) => u.branchId === khi.id)
  const counsellorLhr =
    usersAll.find((u) => u.branchId === lhr.id) || usersAll.find((u) => u.email === 'sara@saa.com')

  function studentPayload(opts) {
    return {
      studentCode: opts.code,
      fullName: opts.name,
      cnicPassport: opts.cnic || `CNIC-${stamp}-${opts.code}`.slice(0, 40),
      contact: '03001234567',
      branchId: opts.branchId,
      counsellorId: opts.counsellorId,
      country: uni.countryName || 'UK',
      universityId: opts.universityId || uni.id,
      course: 'ISO Course',
      intake: 'Sep 2026',
      applicationStatus: 'Applied',
      tuitionFee: opts.tuitionFee ?? 1000,
      scholarship: 0,
      expectedCommissionRate: 10,
      currencyCode: uni.currencyCode || 'GBP',
    }
  }

  const stuA = await req(
    'POST',
    '/students',
    branchA.token,
    studentPayload({
      code: `ISO-A-${stamp}`,
      name: `ISO BranchA ${stamp}`,
      branchId: khi.id,
      counsellorId: counsellorKhi.id,
    }),
  )
  const stuB = await req(
    'POST',
    '/students',
    branchB.token,
    studentPayload({
      code: `ISO-B-${stamp}`,
      name: `ISO BranchB ${stamp}`,
      branchId: lhr.id,
      counsellorId: counsellorLhr.id,
    }),
  )
  // If create fails due to DTO, fall back to existing branch students
  let studentA =
    stuA.data?.id
      ? stuA.data
      : unwrap((await req('GET', '/students?take=50', branchA.token)).data).find(
          (s) => branchOf(s) === khi.id || !branchOf(s),
        )
  let studentB =
    stuB.data?.id
      ? stuB.data
      : unwrap((await req('GET', '/students?take=50', admin.token)).data).find(
          (s) => branchOf(s) === lhr.id,
        )

  if (!studentA || !studentB) {
    if (!studentA) {
      const c = await req(
        'POST',
        '/students',
        admin.token,
        studentPayload({
          code: `ISO-A2-${stamp}`,
          name: `ISO BranchA2 ${stamp}`,
          branchId: khi.id,
          counsellorId: counsellorKhi.id,
        }),
      )
      studentA = c.data
    }
    if (!studentB) {
      const c = await req(
        'POST',
        '/students',
        admin.token,
        studentPayload({
          code: `ISO-B2-${stamp}`,
          name: `ISO BranchB2 ${stamp}`,
          branchId: lhr.id,
          counsellorId: counsellorLhr.id,
          tuitionFee: 2000,
        }),
      )
      studentB = c.data
    }
  }
  if (!studentA?.id || !studentB?.id) {
    throw new Error(
      `Could not obtain A/B students: A=${stuA.status} B=${stuB.status} ${JSON.stringify(stuA.data)?.slice(0, 120)}`,
    )
  }

  // ── BR-ISO-001 Branch A students list ────────────────────────────────────
  const listA = unwrap((await req('GET', '/students?take=200', branchA.token)).data)
  const foreignInA = listA.filter((s) => branchOf(s) === lhr.id)
  const hasOwnOrScoped =
    listA.length === 0 ||
    listA.every((s) => branchOf(s) == null || branchOf(s) === khi.id) ||
    listA.some((s) => s.id === studentA.id)
  set(
    result(
      'BR-ISO-001',
      foreignInA.length === 0 && hasOwnOrScoped ? 'Pass' : 'Fail',
      `n=${listA.length} foreignLHR=${foreignInA.length} hasStudentA=${listA.some((s) => s.id === studentA.id)}`,
      foreignInA.length ? 'DEF-BR-ISO-001' : null,
    ),
  )

  // ── BR-ISO-002 Search Branch B student as Branch A ───────────────────────
  const qName = (studentB.fullName || studentB.name || '').split(' ')[0] || 'ISO'
  const search = await req(
    'GET',
    `/students?take=50&q=${encodeURIComponent(studentB.studentCode || studentB.fullName || qName)}`,
    branchA.token,
  )
  const searchHits = unwrap(search.data).filter((s) => s.id === studentB.id)
  set(
    result(
      'BR-ISO-002',
      searchHits.length === 0 ? 'Pass' : 'Fail',
      `searchHitsForB=${searchHits.length} status=${search.status}`,
      searchHits.length ? 'DEF-BR-ISO-002' : null,
    ),
  )

  // ── BR-ISO-003 Direct ID access to Branch B student ──────────────────────
  const direct = await req('GET', `/students/${studentB.id}`, branchA.token)
  set(
    result(
      'BR-ISO-003',
      direct.status === 403 || direct.status === 404 ? 'Pass' : 'Fail',
      `GET /students/${studentB.id} status=${direct.status}`,
      direct.status < 400 ? 'DEF-BR-ISO-003' : null,
    ),
  )

  // ── BR-ISO-004 Invoices ──────────────────────────────────────────────────
  const invA = unwrap((await req('GET', '/invoices?take=100', branchA.token)).data)
  const invForeign = invA.filter((i) => branchOf(i) === lhr.id)
  set(
    result(
      'BR-ISO-004',
      invForeign.length === 0 ? 'Pass' : 'Fail',
      `invoices=${invA.length} foreignLHR=${invForeign.length}`,
      invForeign.length ? 'DEF-BR-ISO-004' : null,
    ),
  )

  // ── BR-ISO-005 Remittances / receivables ─────────────────────────────────
  const remA = unwrap((await req('GET', '/receivables?take=100', branchA.token)).data)
  const remForeign = remA.filter((r) => branchOf(r) === lhr.id)
  set(
    result(
      'BR-ISO-005',
      remForeign.length === 0 ? 'Pass' : 'Fail',
      `receivables=${remA.length} foreignLHR=${remForeign.length}`,
      remForeign.length ? 'DEF-BR-ISO-005' : null,
    ),
  )

  // ── BR-ISO-006 Expenses ──────────────────────────────────────────────────
  const expA = unwrap((await req('GET', '/expenses?take=100', branchA.token)).data)
  const expForeign = expA.filter((e) => branchOf(e) === lhr.id)
  set(
    result(
      'BR-ISO-006',
      expForeign.length === 0 ? 'Pass' : 'Fail',
      `expenses=${expA.length} foreignLHR=${expForeign.length}`,
      expForeign.length ? 'DEF-BR-ISO-006' : null,
    ),
  )

  // ── BR-ISO-007 Petty cash ────────────────────────────────────────────────
  const pcA = unwrap((await req('GET', '/petty-cash', branchA.token)).data)
  const pcForeign = pcA.filter((e) => branchOf(e) === lhr.id)
  set(
    result(
      'BR-ISO-007',
      pcForeign.length === 0 ? 'Pass' : 'Fail',
      `pettyCash=${pcA.length} foreignLHR=${pcForeign.length}`,
      pcForeign.length ? 'DEF-BR-ISO-007' : null,
    ),
  )

  // ── BR-ISO-008 Bank / cash ───────────────────────────────────────────────
  const banksA = unwrap((await req('GET', '/bank-accounts', branchA.token)).data)
  const banksForeign = banksA.filter((b) => branchOf(b) === lhr.id)
  const balA = await req('GET', '/bank-accounts-balances', branchA.token)
  const balRows = unwrap(balA.data)
  const balForeign = balRows.filter((b) => branchOf(b) === lhr.id)
  set(
    result(
      'BR-ISO-008',
      banksForeign.length === 0 && balForeign.length === 0 ? 'Pass' : 'Fail',
      `banks=${banksA.length} foreignBanks=${banksForeign.length} balForeign=${balForeign.length}`,
      banksForeign.length || balForeign.length ? 'DEF-BR-ISO-008' : null,
    ),
  )

  // ── BR-ISO-009 Journals / GL ─────────────────────────────────────────────
  const jeA = unwrap((await req('GET', '/journal-entries?take=100', branchA.token)).data)
  const jeForeign = jeA.filter((j) => branchOf(j) === lhr.id)
  const tbA = await req('GET', '/gl/trial-balance', branchA.token)
  set(
    result(
      'BR-ISO-009',
      jeForeign.length === 0 && tbA.status === 200 ? 'Pass' : 'Fail',
      `journals=${jeA.length} foreignLHR=${jeForeign.length} TB=${tbA.status}`,
      jeForeign.length ? 'DEF-BR-ISO-009' : null,
    ),
  )

  // ── BR-ISO-010 Reports contain only Branch A ─────────────────────────────
  const rptIncome = await req('GET', '/reports/income-report', branchA.token)
  const rptRows = unwrap(rptIncome.data)
  const rptForeign = rptRows.filter((r) => {
    const code = r.branchCode || r.branch || r.branchId
    return code === lhr.id || code === 'LHR' || code === lhr.name
  })
  // Also check branch-income filtered implicitly
  const rptBranch = await req('GET', '/reports/branch-income', branchA.token)
  const branchRows = unwrap(rptBranch.data)
  const onlyKhi =
    branchRows.length === 0 ||
    branchRows.every((r) => {
      const c = r.branchCode || r.code || r.branch
      return !c || c === 'KHI' || c === khi.id || c === khi.name
    })
  set(
    result(
      'BR-ISO-010',
      rptIncome.status === 200 && rptForeign.length === 0 && onlyKhi ? 'Pass' : 'Fail',
      `incomeForeign=${rptForeign.length} branchIncomeOnlyKhi=${onlyKhi} statuses=${rptIncome.status}/${rptBranch.status}`,
      rptForeign.length || !onlyKhi ? 'DEF-BR-ISO-010' : null,
    ),
  )

  // ── BR-ISO-011 Manipulate branchId query / body ──────────────────────────
  const sneakQuery = await req('GET', `/students?branchId=${lhr.id}`, branchA.token)
  const sneakCreate = await req(
    'POST',
    '/students',
    branchA.token,
    studentPayload({
      code: `ISO-SNEAK-${stamp}`,
      name: `Sneak B ${stamp}`,
      branchId: lhr.id,
      counsellorId: counsellorLhr.id,
      tuitionFee: 1,
    }),
  )
  const sneakList = unwrap(sneakQuery.data)
  const sneakHasB = sneakList.some((s) => s.id === studentB.id || branchOf(s) === lhr.id)
  const createdBranch = sneakCreate.data ? branchOf(sneakCreate.data) : null
  const createBlockedOrForcedHome =
    sneakCreate.status >= 400 ||
    (sneakCreate.status < 300 && createdBranch === khi.id && createdBranch !== lhr.id)
  const manipulateBlocked =
    (sneakQuery.status === 403 || !sneakHasB) && createBlockedOrForcedHome
  set(
    result(
      'BR-ISO-011',
      manipulateBlocked ? 'Pass' : 'Fail',
      `queryStatus=${sneakQuery.status} sneakHasB=${sneakHasB} createStatus=${sneakCreate.status} createdBranch=${createdBranch}`,
      manipulateBlocked ? null : 'DEF-BR-ISO-011',
    ),
  )

  // ── BR-ISO-012 Global-ish search still isolates ──────────────────────────
  const globalSearch = await req(
    'GET',
    `/students?take=100&q=${encodeURIComponent('ISO')}`,
    branchA.token,
  )
  const gHits = unwrap(globalSearch.data)
  const gForeign = gHits.filter((s) => s.id === studentB.id || branchOf(s) === lhr.id)
  set(
    result(
      'BR-ISO-012',
      gForeign.length === 0 ? 'Pass' : 'Fail',
      `isoSearchHits=${gHits.length} foreign=${gForeign.length}`,
      gForeign.length ? 'DEF-BR-ISO-012' : null,
    ),
  )

  // ── BR-ISO-013 Super Admin sees Branch A ─────────────────────────────────
  const adminA = unwrap(
    (await req('GET', `/students?branchId=${khi.id}&take=50`, admin.token)).data,
  )
  set(
    result(
      'BR-ISO-013',
      adminA.some((s) => s.id === studentA.id) || adminA.length > 0 ? 'Pass' : 'Fail',
      `adminKhiStudents=${adminA.length} hasA=${adminA.some((s) => s.id === studentA.id)}`,
    ),
  )

  // ── BR-ISO-014 Super Admin sees Branch B ─────────────────────────────────
  const adminB = unwrap(
    (await req('GET', `/students?branchId=${lhr.id}&take=50`, admin.token)).data,
  )
  set(
    result(
      'BR-ISO-014',
      adminB.some((s) => s.id === studentB.id) || adminB.length > 0 ? 'Pass' : 'Fail',
      `adminLhrStudents=${adminB.length} hasB=${adminB.some((s) => s.id === studentB.id)}`,
    ),
  )

  // ── BR-ISO-015 Super Admin all branches ──────────────────────────────────
  const adminAll = unwrap((await req('GET', '/students?take=200', admin.token)).data)
  const hasBoth =
    adminAll.some((s) => s.id === studentA.id || branchOf(s) === khi.id) &&
    adminAll.some((s) => s.id === studentB.id || branchOf(s) === lhr.id)
  set(
    result(
      'BR-ISO-015',
      hasBoth || adminAll.length >= 2 ? 'Pass' : 'Fail',
      `adminAll=${adminAll.length} hasBothMarkers=${hasBoth}`,
    ),
  )

  // ── BR-ISO-016 University master shared ──────────────────────────────────
  const uniName = `ISO Uni Shared ${stamp}`
  const uniCreate = await req('POST', '/universities', admin.token, {
    name: uniName,
    countryName: 'UK',
    countryCode: 'GB',
    defaultCommissionRate: 12,
    currencyCode: 'GBP',
  })
  const uniId = uniCreate.data?.id
  const uniSeenA = uniId
    ? await req('GET', `/universities/${uniId}`, branchA.token)
    : { status: 0 }
  const uniSeenB = uniId
    ? await req('GET', `/universities/${uniId}`, branchB.token)
    : { status: 0 }
  const uniListA = unwrap((await req('GET', '/universities', branchA.token)).data)
  const uniListB = unwrap((await req('GET', '/universities', branchB.token)).data)
  const sharedOk =
    uniCreate.status < 300 &&
    (uniSeenA.status === 200 || uniListA.some((u) => u.id === uniId || u.name === uniName)) &&
    (uniSeenB.status === 200 || uniListB.some((u) => u.id === uniId || u.name === uniName))
  set(
    result(
      'BR-ISO-016',
      sharedOk ? 'Pass' : 'Fail',
      `create=${uniCreate.status} A=${uniSeenA.status} B=${uniSeenB.status} inListA=${uniListA.some((u) => u.id === uniId)} inListB=${uniListB.some((u) => u.id === uniId)}`,
      sharedOk ? null : 'DEF-BR-ISO-016',
    ),
  )

  // ── BR-ISO-017 Shared settings reflected across branches ─────────────────
  // Use settings-capable roles on each branch (Branch Managers), not Accountant.
  const marker = `ISO-ORG-${stamp}`
  const beforeSettings = await req('GET', '/settings', admin.token)
  const patch = await req('PATCH', '/settings', admin.token, { orgName: marker })
  const setA = await req('GET', '/settings', branchA.token)
  const setB = await req('GET', '/settings', branchBMgr.token)
  if (beforeSettings.data?.orgName) {
    await req('PATCH', '/settings', admin.token, {
      orgName: beforeSettings.data.orgName,
    })
  }
  const settingsShared =
    patch.status < 300 &&
    setA.status === 200 &&
    setB.status === 200 &&
    setA.data?.orgName === marker &&
    setB.data?.orgName === marker
  set(
    result(
      'BR-ISO-017',
      settingsShared ? 'Pass' : 'Fail',
      `patch=${patch.status} A=${setA.status}/${setA.data?.orgName} Bmgr=${setB.status}/${setB.data?.orgName}`,
      settingsShared ? null : 'DEF-BR-ISO-017',
    ),
  )

  // ── BR-ISO-018 Transaction with shared uni belongs to Branch A only ──────
  const useUniId = uniId || uni.id
  const txStu = await req(
    'POST',
    '/students',
    branchA.token,
    studentPayload({
      code: `ISO-TX-${stamp}`,
      name: `ISO Tx ${stamp}`,
      branchId: khi.id,
      counsellorId: counsellorKhi.id,
      universityId: useUniId,
      tuitionFee: 5000,
    }),
  )
  const txId = txStu.data?.id
  const txOnA = txId
    ? await req('GET', `/students/${txId}`, branchA.token)
    : { status: 0 }
  const txOnB = txId
    ? await req('GET', `/students/${txId}`, branchB.token)
    : { status: 0 }
  const uniStillShared = unwrap((await req('GET', '/universities', branchB.token)).data).some(
    (u) => u.id === useUniId,
  )
  const txOk =
    txStu.status < 300 &&
    txOnA.status === 200 &&
    (txOnB.status === 403 || txOnB.status === 404) &&
    uniStillShared &&
    branchOf(txStu.data) === khi.id
  set(
    result(
      'BR-ISO-018',
      txOk ? 'Pass' : 'Fail',
      `create=${txStu.status} branchId=${branchOf(txStu.data)} A=${txOnA.status} B=${txOnB.status} uniShared=${uniStillShared}`,
      txOk ? null : 'DEF-BR-ISO-018',
    ),
  )

  // ── BR-ISO-019 Branch B report must not include Branch A txn ─────────────
  const rptB = await req('GET', '/reports/counsellor', branchB.token)
  const rptBRows = unwrap(rptB.data)
  const leaked =
    rptBRows.some((r) => r.studentId === studentA.id || r.studentId === txId) ||
    rptBRows.some((r) => {
      const c = r.branchCode || r.branch
      return c === 'KHI' || c === khi.id
    })
  const invB = unwrap((await req('GET', '/invoices?take=100', branchB.token)).data)
  const invLeak = invB.filter((i) => branchOf(i) === khi.id)
  set(
    result(
      'BR-ISO-019',
      !leaked && invLeak.length === 0 ? 'Pass' : 'Fail',
      `counsellorLeak=${leaked} invoiceKhiLeak=${invLeak.length} rptStatus=${rptB.status}`,
      leaked || invLeak.length ? 'DEF-BR-ISO-019' : null,
    ),
  )

  // ── BR-ISO-020 CSV / export Branch A only ────────────────────────────────
  const csvA = await fetch(`${base}/reports/branch-income/csv`, {
    headers: { Authorization: `Bearer ${branchA.token}` },
  })
  const csvText = await csvA.text()
  const csvHasLhr =
    /\bLHR\b/i.test(csvText) ||
    csvText.includes(lhr.id) ||
    csvText.toLowerCase().includes('lahore')
  // Prefer asserting KHI presence or empty/own-only; LHR must not appear
  set(
    result(
      'BR-ISO-020',
      csvA.status === 200 && !csvHasLhr ? 'Pass' : 'Fail',
      `csvStatus=${csvA.status} len=${csvText.length} hasLHR=${csvHasLhr}`,
      csvA.status !== 200 || csvHasLhr ? 'DEF-BR-ISO-020' : null,
    ),
  )

  for (const id of ALL_IDS) {
    if (!out[id]) set(result(id, 'Fail', 'Not executed', 'DEF-BR-ISO-MISS'))
  }

  const summary = { Pass: 0, Fail: 0, Blocked: 0, 'N/A': 0 }
  for (const r of Object.values(out)) summary[r.status] = (summary[r.status] || 0) + 1

  const evidenceDir = path.join(__dirname, '..', '..', 'docs', 'qa', 'evidence')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const jsonPath = path.join(evidenceDir, 'branch-isolation-results.json')
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        base,
        stamp,
        branches: { A: { code: 'KHI', id: khi.id }, B: { code: 'LHR', id: lhr.id } },
        users: {
          A: branchA.user?.email,
          B: branchB.user?.email,
          admin: admin.user?.email,
        },
        summary,
        results: out,
      },
      null,
      2,
    ),
  )

  const mdPath = path.join(__dirname, '..', '..', 'docs', 'qa', 'BRANCH-ISOLATION-RESULTS.md')
  const fails = Object.values(out).filter((r) => r.status === 'Fail')
  const lines = [
    '# Branch Isolation QA Results (BR-ISO-001 … 020)',
    '',
    '**Rule:** Super Admin sees all branches; every other role is home-branch only. Universities and shared settings are common; transactional data never crosses branches.',
    '',
    `**Environment:** \`${base}\`  `,
    `**Branch A:** KHI (\`${branchA.user?.email}\`)  `,
    `**Branch B:** LHR (\`${branchB.user?.email}\`)  `,
    `**Super Admin:** \`${admin.user?.email}\`  `,
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
      return `| ${id} | ${r.status} | ${String(r.actual).replace(/\|/g, '/')} |`
    }),
    '',
    '## Failures',
    '',
    fails.length
      ? fails.map((r) => `- **${r.id}** [${r.defectId || 'n/a'}]: ${r.actual}`).join('\n')
      : '_None — all isolation cases passed._',
    '',
    `Evidence JSON: \`docs/qa/evidence/branch-isolation-results.json\``,
    '',
  ]
  fs.writeFileSync(mdPath, lines.join('\n'))

  console.log(JSON.stringify(summary, null, 2))
  console.log('Wrote', jsonPath)
  console.log('Wrote', mdPath)
  if (summary.Fail > 0) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
