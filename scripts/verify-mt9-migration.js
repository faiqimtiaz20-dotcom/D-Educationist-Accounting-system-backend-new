/**
 * MT9 — migration + dual-tenant readiness verify.
 *
 * Checks (against running API + optional Prisma via HTTP only):
 * 1) Health / DB up
 * 2) Tenant A (DED) login has tenant context
 * 3) CRM platform login; list tenants; no GL
 * 4) At least 2 tenants visible to CRM (DED + DEMO or created)
 * 5) DEMO (or second tenant) settings orgName differs from DED
 * 6) Tenant Admin blocked from CRM
 * 7) Forged tenantId rejected
 *
 * Does NOT claim client UAT sign-off.
 *
 * Usage: node scripts/verify-mt9-migration.js
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

  const health = await req('GET', '/health');
  assert(
    health.status === 200 &&
      (health.json?.database === 'up' || health.json?.status === 'ok'),
    `health failed ${health.status} ${JSON.stringify(health.json)}`,
  );
  results.push({ id: 'HEALTH', pass: true });

  const ded = await login('admin@saa.com');
  assert(ded.user?.tenantId, 'DED missing tenantId — MT1 not applied?');
  assert(ded.user?.tenantCode, 'DED missing tenantCode — redeploy auth serialize');
  assert(
    ded.user?.roleCode === 'TENANT_ADMIN' || ded.user?.roleCode === 'SUPER_ADMIN',
    `DED role ${ded.user?.roleCode}`,
  );
  results.push({
    id: 'TENANT_A_CONTEXT',
    pass: true,
    tenantCode: ded.user.tenantCode,
    tenantName: ded.user.tenantName,
  });

  const crm = await login('crm@platform.local');
  assert(crm.user?.isCrmAdmin === true, 'CRM isCrmAdmin');
  assert(crm.user?.tenantId == null, 'CRM must be platform');
  const list = await req('GET', '/crm/tenants', crm.accessToken);
  assert(list.status === 200 && Array.isArray(list.json), `CRM list ${list.status}`);
  assert(list.json.length >= 2, `expected ≥2 tenants got ${list.json.length}`);
  const codes = list.json.map((t) => t.code);
  assert(codes.includes('DED'), 'DED missing from CRM list');
  results.push({ id: 'CRM_TENANTS', pass: true, count: list.json.length, codes });

  const gl = await req('GET', '/gl-accounts', crm.accessToken);
  assert(gl.status === 403, `CRM GL expected 403 got ${gl.status}`);
  results.push({ id: 'CRM_NO_LEDGER', pass: true });

  const dedCrm = await req('GET', '/crm/tenants', ded.accessToken);
  assert(dedCrm.status === 403, `DED CRM expected 403 got ${dedCrm.status}`);
  results.push({ id: 'TENANT_NO_CRM', pass: true });

  const demo = await login('admin@demo.local');
  assert(demo.user.tenantId !== ded.user.tenantId, 'DEMO same as DED');
  const aSet = await req('GET', '/settings', ded.accessToken);
  const bSet = await req('GET', '/settings', demo.accessToken);
  assert(aSet.status === 200 && bSet.status === 200, 'settings failed');
  assert(
    aSet.json?.orgName !== bSet.json?.orgName,
    `orgName should differ: ${aSet.json?.orgName} vs ${bSet.json?.orgName}`,
  );
  results.push({
    id: 'DUAL_ORG_SETTINGS',
    pass: true,
    dedOrg: aSet.json.orgName,
    demoOrg: bSet.json.orgName,
  });

  const forged = await req(
    'GET',
    `/branches?tenantId=${demo.user.tenantId}`,
    ded.accessToken,
  );
  assert(forged.status === 403, `forged tenantId expected 403 got ${forged.status}`);
  results.push({ id: 'FORGED_TENANT_REJECT', pass: true });

  // Optional: create a fresh Tenant B to prove CRM create still works
  const suffix = Date.now().toString(36).toUpperCase();
  const created = await req('POST', '/crm/tenants', crm.accessToken, {
    code: `P9${suffix}`.slice(0, 40),
    name: `MT9 Proof ${suffix}`,
    adminEmail: `admin.mt9.${suffix.toLowerCase()}@example.local`,
    adminPassword: 'Mt9ProofPass123!',
    adminFullName: 'MT9 Proof Admin',
    branchCity: 'Karachi',
  });
  assert(
    created.status === 200 || created.status === 201,
    `create B ${created.status} ${JSON.stringify(created.json)}`,
  );
  const bLogin = await req('POST', '/auth/login', null, {
    email: `admin.mt9.${suffix.toLowerCase()}@example.local`,
    password: 'Mt9ProofPass123!',
  });
  assert(
    bLogin.status === 200 || bLogin.status === 201,
    `B login ${bLogin.status}`,
  );
  assert(
    bLogin.json.user?.tenantId === created.json.tenant.id,
    'B tenantId mismatch',
  );
  await req(
    'POST',
    `/crm/tenants/${created.json.tenant.id}/suspend`,
    crm.accessToken,
  );
  results.push({
    id: 'CRM_CREATE_TENANT_B',
    pass: true,
    code: created.json.tenant.code,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        results,
        claims: {
          engineeringDualTenantProof: true,
          clientUatSigned: false,
          productionHostClaimed: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: String(err?.message || err) }),
  );
  process.exit(1);
});
