/**
 * MT4 exit criteria — per-tenant masters/settings + template.
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
  return [];
}

async function main() {
  const results = [];
  const ded = await login('admin@saa.com');
  const demo = await login('admin@demo.local');

  // 1) Uni in A invisible to B (and vice versa for Demo Isolation Uni)
  const dedUnis = asList((await req('GET', '/universities', ded.accessToken)).json);
  const demoUnis = asList(
    (await req('GET', '/universities', demo.accessToken)).json,
  );
  assert(
    !dedUnis.some((u) => u.name === 'Demo Isolation University'),
    'DED sees Demo Isolation University',
  );
  assert(
    demoUnis.some((u) => u.name === 'Demo Isolation University'),
    'DEMO missing Demo Isolation University',
  );
  results.push({
    id: 'UNI_ISOLATED',
    pass: true,
    ded: dedUnis.length,
    demo: demoUnis.length,
  });

  // 2) orgName / WHT / fiscal independent
  const dedSet = (await req('GET', '/settings', ded.accessToken)).json;
  const demoSet = (await req('GET', '/settings', demo.accessToken)).json;
  assert(dedSet?.orgName, 'DED orgName missing');
  assert(demoSet?.orgName, 'DEMO orgName missing');
  assert(
    dedSet.orgName !== demoSet.orgName,
    `orgName not independent: both "${dedSet.orgName}"`,
  );
  assert(
    Number(dedSet.whtRatePercent) !== Number(demoSet.whtRatePercent),
    `wht not independent: both ${dedSet.whtRatePercent}`,
  );
  assert(
    String(dedSet.fiscalPeriodLockedUntil) !==
      String(demoSet.fiscalPeriodLockedUntil),
    `fiscal lock not independent: both ${dedSet.fiscalPeriodLockedUntil}`,
  );
  results.push({
    id: 'SETTINGS_INDEPENDENT',
    pass: true,
    ded: {
      org: dedSet.orgName,
      wht: dedSet.whtRatePercent,
      fiscal: dedSet.fiscalPeriodLockedUntil,
    },
    demo: {
      org: demoSet.orgName,
      wht: demoSet.whtRatePercent,
      fiscal: demoSet.fiscalPeriodLockedUntil,
    },
  });

  // 3) New tenant template usable without A's transactional data
  const dedGl = asList((await req('GET', '/gl-accounts', ded.accessToken)).json);
  const demoGl = asList(
    (await req('GET', '/gl-accounts', demo.accessToken)).json,
  );
  assert(demoGl.length >= 20, `DEMO COA too small: ${demoGl.length}`);
  const dedGlIds = new Set(dedGl.map((g) => g.id));
  assert(
    !demoGl.some((g) => dedGlIds.has(g.id)),
    'DEMO GL ids overlap DED (copied rows?)',
  );
  const demoCats = asList(
    (await req('GET', '/expense-categories', demo.accessToken)).json,
  );
  assert(demoCats.length >= 5, `DEMO expense cats missing: ${demoCats.length}`);
  const dedStudents = asList(
    (await req('GET', '/students', ded.accessToken)).json,
  );
  const demoStudents = asList(
    (await req('GET', '/students', demo.accessToken)).json,
  );
  assert(
    !demoStudents.some((s) =>
      dedStudents.some((d) => d.id === s.id),
    ),
    'DEMO student ids overlap DED',
  );
  results.push({
    id: 'TEMPLATE_NO_TX_COPY',
    pass: true,
    demoGl: demoGl.length,
    demoCats: demoCats.length,
    demoStudents: demoStudents.length,
  });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  process.exit(1);
});
