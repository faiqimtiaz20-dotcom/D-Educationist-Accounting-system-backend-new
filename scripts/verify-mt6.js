/**
 * MT6 smoke (API + route contract).
 * UI shell splits CRM vs accounting; full browser E2E is manual / optional.
 *
 * 1) CRM login → /crm/tenants list OK; /gl-accounts still 403
 * 2) Create tenant via API (same as UI wizard payload)
 * 3) New Tenant Admin login OK; cannot call /crm/tenants
 * 4) DED Tenant Admin cannot call /crm/tenants
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

async function login(email, password = pwd) {
  return req('POST', '/auth/login', null, { email, password });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];
  const suffix = Date.now().toString(36).toUpperCase();
  const tenantCode = `UI6${suffix}`.slice(0, 40);
  const adminEmail = `admin.mt6.${suffix.toLowerCase()}@example.local`;
  const adminPassword = 'Mt6UiPass123!';

  const crm = await login('crm@platform.local');
  assert(crm.status === 200 || crm.status === 201, `CRM login ${crm.status}`);
  assert(crm.json.user?.isCrmAdmin === true, 'CRM isCrmAdmin');
  const crmToken = crm.json.accessToken;

  const list = await req('GET', '/crm/tenants', crmToken);
  assert(list.status === 200, `CRM tenants list ${list.status}`);
  results.push({ id: 'CRM_TENANTS_UI_API', pass: true });

  const gl = await req('GET', '/gl-accounts', crmToken);
  assert(gl.status === 403, `CRM GL blocked ${gl.status}`);
  results.push({ id: 'CRM_NO_ACCOUNTING_API', pass: true });

  const created = await req('POST', '/crm/tenants', crmToken, {
    code: tenantCode,
    name: `MT6 UI Tenant ${suffix}`,
    adminEmail,
    adminPassword,
    adminFullName: 'MT6 UI Admin',
    branchCity: 'Islamabad',
  });
  assert(
    created.status === 200 || created.status === 201,
    `create ${created.status} ${JSON.stringify(created.json)}`,
  );
  results.push({ id: 'CREATE_TENANT_WIZARD_PAYLOAD', pass: true, code: tenantCode });

  const admin = await login(adminEmail, adminPassword);
  assert(admin.status === 200 || admin.status === 201, `admin login ${admin.status}`);
  assert(admin.json.user?.tenantId === created.json.tenant.id, 'tenant scope');
  const adminCrm = await req('GET', '/crm/tenants', admin.json.accessToken);
  assert(adminCrm.status === 403, `new admin CRM 403 got ${adminCrm.status}`);
  results.push({ id: 'NEW_ADMIN_NO_CRM_NAV_EQUIV', pass: true });

  const ded = await login('admin@saa.com');
  const dedCrm = await req('GET', '/crm/tenants', ded.json.accessToken);
  assert(dedCrm.status === 403, `DED CRM 403 got ${dedCrm.status}`);
  results.push({ id: 'TENANT_NO_CRM', pass: true });

  await req('POST', `/crm/tenants/${created.json.tenant.id}/suspend`, crmToken);

  console.log(
    JSON.stringify(
      {
        ok: true,
        results,
        uiChecklist: [
          'Login as crm@platform.local → lands on /crm/tenants; sidebar = Tenants only',
          'Create tenant wizard → new admin can login to accounting shell',
          'Login as admin@saa.com → no CRM nav; /crm/tenants redirects home',
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  process.exit(1);
});
