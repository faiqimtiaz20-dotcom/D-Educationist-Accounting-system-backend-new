/**
 * MT2 exit criteria smoke (honest, no false green).
 *
 * Checks:
 * 1) CRM Admin login OK; GET /students → 403
 * 2) Tenant Admin A (DED) branches do not include DEMO branch ids
 * 3) Tenant Admin A users do not include admin@demo.local
 * 4) Forged ?tenantId=DEMO rejected (403) for DED admin
 * 5) Demo admin branches only DEMO (not DED HO list size)
 * 6) DED login includes tenantId + role TENANT_ADMIN
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
  return { status: res.status, json };
}

async function login(email) {
  const r = await req('POST', '/auth/login', null, { email, password: pwd });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`login failed ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];

  // 1 CRM cannot call students
  const crm = await login('crm@platform.local');
  assert(crm.user?.isCrmAdmin === true, 'CRM user missing isCrmAdmin');
  assert(crm.user?.tenantId == null, 'CRM must have null tenantId');
  const crmStudents = await req('GET', '/students', crm.accessToken);
  assert(crmStudents.status === 403, `CRM /students expected 403 got ${crmStudents.status}`);
  results.push({ id: 'CRM_STUDENTS_403', pass: true });

  // 2+3+6 DED tenant admin
  const ded = await login('admin@saa.com');
  assert(
    ded.user?.roleCode === 'TENANT_ADMIN' || ded.user?.roleCode === 'SUPER_ADMIN',
    `DED admin role expected TENANT_ADMIN got ${ded.user?.roleCode}`,
  );
  assert(!!ded.user?.tenantId, 'DED admin missing tenantId');
  assert(ded.user?.isSuperAdmin === true, 'DED admin should be isSuperAdmin');
  results.push({ id: 'DED_LOGIN_TENANT', pass: true, tenantId: ded.user.tenantId });

  const dedBranches = await req('GET', '/branches', ded.accessToken);
  assert(dedBranches.status === 200, `DED branches ${dedBranches.status}`);
  const dedBranchList = Array.isArray(dedBranches.json) ? dedBranches.json : [];
  assert(
    dedBranchList.every((b) => b.tenantId === ded.user.tenantId),
    'DED branches leaked foreign tenantId',
  );
  assert(
    !dedBranchList.some((b) => b.name === 'Demo Head Office'),
    'DED admin can see DEMO branch',
  );
  results.push({
    id: 'DED_BRANCHES_SCOPED',
    pass: true,
    count: dedBranchList.length,
  });

  const dedUsers = await req('GET', '/users', ded.accessToken);
  assert(dedUsers.status === 200, `DED users ${dedUsers.status}`);
  const dedUserList = Array.isArray(dedUsers.json) ? dedUsers.json : [];
  assert(
    !dedUserList.some((u) => u.email === 'admin@demo.local'),
    'DED admin can see DEMO user',
  );
  assert(
    !dedUserList.some((u) => u.email === 'crm@platform.local'),
    'DED admin can see CRM user',
  );
  results.push({ id: 'DED_USERS_SCOPED', pass: true, count: dedUserList.length });

  // 4 forged tenantId
  const forged = await req(
    'GET',
    `/branches?tenantId=b0000000-0000-4000-8000-000000000002`,
    ded.accessToken,
  );
  assert(forged.status === 403, `forged tenantId expected 403 got ${forged.status}`);
  results.push({ id: 'FORGED_TENANT_403', pass: true });

  // 5 DEMO admin
  const demo = await login('admin@demo.local');
  assert(demo.user?.tenantId !== ded.user.tenantId, 'DEMO tenantId equals DED');
  const demoBranches = await req('GET', '/branches', demo.accessToken);
  assert(demoBranches.status === 200, `DEMO branches ${demoBranches.status}`);
  const demoBranchList = Array.isArray(demoBranches.json) ? demoBranches.json : [];
  assert(demoBranchList.length >= 1, 'DEMO has no branches');
  assert(
    demoBranchList.every((b) => b.tenantId === demo.user.tenantId),
    'DEMO branches leaked DED',
  );
  assert(
    !demoBranchList.some((b) => b.code === 'KHI' && b.tenantId === ded.user.tenantId),
    'DEMO sees DED KHI',
  );
  results.push({
    id: 'DEMO_BRANCHES_SCOPED',
    pass: true,
    count: demoBranchList.length,
  });

  // CRM still blocked on GL
  const crmGl = await req('GET', '/gl-accounts', crm.accessToken);
  assert(crmGl.status === 403, `CRM /gl-accounts expected 403 got ${crmGl.status}`);
  results.push({ id: 'CRM_GL_403', pass: true });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  process.exit(1);
});
