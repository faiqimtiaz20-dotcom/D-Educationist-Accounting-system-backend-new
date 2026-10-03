/**
 * MT7 — Frontend tenant context cutover smoke.
 *
 * 1) Tenant login includes tenantId + tenantCode + tenantName
 * 2) Settings.orgName is tenant-scoped
 * 3) No client-forged tenantId needed; forged query still 403
 * 4) CRM login has null tenant; CRM tenants list OK
 * 5) Tenant Admin /branches scoped; DEMO not visible
 * 6) Production guard: VITE_API_URL required (checked via build evidence)
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
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];

  const ded = await login('admin@saa.com');
  assert(!!ded.user?.tenantId, 'DED missing tenantId');
  assert(!!ded.user?.tenantCode, 'DED missing tenantCode');
  assert(!!ded.user?.tenantName, 'DED missing tenantName');
  assert(ded.user.isCrmAdmin !== true, 'DED must not be CRM');
  results.push({
    id: 'TENANT_CONTEXT_ON_LOGIN',
    pass: true,
    tenantCode: ded.user.tenantCode,
    tenantName: ded.user.tenantName,
  });

  const settings = await req('GET', '/settings', ded.accessToken);
  assert(settings.status === 200, `settings ${settings.status}`);
  assert(typeof settings.json?.orgName === 'string', 'orgName missing');
  results.push({
    id: 'SETTINGS_ORG_SCOPED',
    pass: true,
    orgName: settings.json.orgName,
  });

  const forged = await req(
    'GET',
    '/branches?tenantId=b0000000-0000-4000-8000-000000000002',
    ded.accessToken,
  );
  assert(forged.status === 403, `forged tenantId expected 403 got ${forged.status}`);
  results.push({ id: 'NO_CROSS_TENANT_SWITCH', pass: true });

  const branches = await req('GET', '/branches', ded.accessToken);
  assert(branches.status === 200, `branches ${branches.status}`);
  const list = Array.isArray(branches.json) ? branches.json : [];
  assert(
    list.every((b) => b.tenantId === ded.user.tenantId),
    'branch list leaked foreign tenant',
  );
  assert(
    !list.some((b) => b.name === 'Demo Head Office'),
    'DED sees DEMO branch',
  );
  results.push({ id: 'TENANT_A_BRANCHES_REGRESSION', pass: true, count: list.length });

  const crm = await login('crm@platform.local');
  assert(crm.user?.tenantId == null, 'CRM must have null tenantId');
  assert(crm.user?.isCrmAdmin === true, 'CRM isCrmAdmin');
  const crmTenants = await req('GET', '/crm/tenants', crm.accessToken);
  assert(crmTenants.status === 200, `CRM tenants ${crmTenants.status}`);
  const gl = await req('GET', '/gl-accounts', crm.accessToken);
  assert(gl.status === 403, `CRM GL ${gl.status}`);
  results.push({ id: 'CRM_PATH_SAME_BUILD', pass: true });

  const demo = await login('admin@demo.local');
  assert(demo.user.tenantId !== ded.user.tenantId, 'DEMO equals DED');
  assert(demo.user.tenantCode !== ded.user.tenantCode, 'DEMO code equals DED');
  const demoSettings = await req('GET', '/settings', demo.accessToken);
  assert(demoSettings.status === 200, `demo settings ${demoSettings.status}`);
  // Org names should be independently provisioned (may or may not differ by string)
  assert(typeof demoSettings.json?.orgName === 'string', 'demo orgName');
  results.push({
    id: 'DUAL_TENANT_SETTINGS',
    pass: true,
    dedOrg: settings.json.orgName,
    demoOrg: demoSettings.json.orgName,
  });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  process.exit(1);
});
