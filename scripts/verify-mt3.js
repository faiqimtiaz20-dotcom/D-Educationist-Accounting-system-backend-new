/**
 * MT3 exit criteria — tenant isolation on domain APIs (honest).
 *
 * Requires: API up, seed with DEMO student DEMO-STU-001.
 */
const base = process.env.API_BASE || 'http://127.0.0.1:3001/api/v1';
const pwd = process.env.SEED_PASSWORD || 'ChangeMe123!';

async function req(method, path, token, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function login(email) {
  const r = await req('POST', '/auth/login', null, { email, password: pwd });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function asList(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

async function main() {
  const results = [];

  const ded = await login('admin@saa.com');
  const demo = await login('admin@demo.local');
  assert(ded.user.tenantId !== demo.user.tenantId, 'tenants must differ');

  // Students list isolation
  const dedStudents = await req('GET', '/students', ded.accessToken);
  assert(dedStudents.status === 200, `DED students ${dedStudents.status}`);
  const dedList = asList(dedStudents.json);
  assert(
    !dedList.some((s) => s.studentCode === 'DEMO-STU-001'),
    'DED students list leaked DEMO-STU-001',
  );
  assert(
    !dedList.some((s) => s.fullName === 'Demo Only Student'),
    'DED students list leaked Demo Only Student',
  );
  results.push({ id: 'DED_STUDENTS_NO_DEMO', pass: true, count: dedList.length });

  const demoStudents = await req('GET', '/students', demo.accessToken);
  assert(demoStudents.status === 200, `DEMO students ${demoStudents.status}`);
  const demoList = asList(demoStudents.json);
  const demoStu = demoList.find((s) => s.studentCode === 'DEMO-STU-001');
  assert(demoStu, 'DEMO seed student DEMO-STU-001 missing — re-seed');
  results.push({ id: 'DEMO_HAS_SAMPLE_STUDENT', pass: true, id_student: demoStu.id });

  // get-by-id cross-tenant
  const crossGet = await req(
    'GET',
    `/students/${demoStu.id}`,
    ded.accessToken,
  );
  assert(
    crossGet.status === 404 || crossGet.status === 403,
    `DED get DEMO student expected 404/403 got ${crossGet.status}`,
  );
  results.push({ id: 'DED_GET_DEMO_STUDENT_DENIED', pass: true, status: crossGet.status });

  // Universities
  const dedUnis = await req('GET', '/universities', ded.accessToken);
  const demoUnis = await req('GET', '/universities', demo.accessToken);
  assert(dedUnis.status === 200 && demoUnis.status === 200, 'universities list failed');
  const dedUniList = asList(dedUnis.json);
  const demoUniList = asList(demoUnis.json);
  assert(
    !dedUniList.some((u) => u.name === 'Demo Isolation University'),
    'DED universities leaked Demo Isolation University',
  );
  assert(
    demoUniList.some((u) => u.name === 'Demo Isolation University'),
    'DEMO missing Demo Isolation University',
  );
  results.push({
    id: 'UNIVERSITIES_SCOPED',
    pass: true,
    ded: dedUniList.length,
    demo: demoUniList.length,
  });

  // Invoices list — DEMO ids absent from DED
  const dedInvoices = await req('GET', '/invoices', ded.accessToken);
  assert(dedInvoices.status === 200, `DED invoices ${dedInvoices.status}`);
  const invList = asList(dedInvoices.json);
  assert(
    !invList.some((i) => i.tenantId && i.tenantId === demo.user.tenantId),
    'DED invoices leaked DEMO tenantId',
  );
  results.push({ id: 'DED_INVOICES_SCOPED', pass: true, count: invList.length });

  // Report CSV — branch-income (must not contain Demo Only Student / DEMO codes)
  const report = await req(
    'GET',
    '/reports/branch-income/csv',
    ded.accessToken,
  );
  assert(
    report.status === 200,
    `DED report csv ${report.status} ${JSON.stringify(report.json).slice(0, 200)}`,
  );
  const csv = report.text || '';
  assert(!csv.includes('Demo Only Student'), 'CSV leaked Demo Only Student');
  assert(!csv.includes('DEMO-STU-001'), 'CSV leaked DEMO-STU-001');
  assert(!csv.includes('Demo Isolation University'), 'CSV leaked Demo uni');
  results.push({
    id: 'DED_REPORT_CSV_NO_DEMO',
    pass: true,
    bytes: csv.length,
  });

  // GL accounts scoped
  const dedGl = await req('GET', '/gl-accounts', ded.accessToken);
  const demoGl = await req('GET', '/gl-accounts', demo.accessToken);
  assert(dedGl.status === 200, `DED gl ${dedGl.status}`);
  // DEMO may have 0 GL until MT4 template — still must not see DED codes count match leak via ids
  const dedGlList = asList(dedGl.json);
  const demoGlList = asList(demoGl.json);
  if (demoGlList.length && dedGlList.length) {
    const dedIds = new Set(dedGlList.map((g) => g.id));
    assert(
      !demoGlList.some((g) => dedIds.has(g.id)),
      'DEMO GL ids overlap DED',
    );
  }
  results.push({
    id: 'GL_ACCOUNTS_SCOPED',
    pass: true,
    ded: dedGlList.length,
    demo: demoGlList.length,
  });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  process.exit(1);
});
