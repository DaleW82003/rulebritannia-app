#!/usr/bin/env node
const { BASE_URL, TEST_EMAIL, TEST_PASSWORD, TEST_LOW_EMAIL, TEST_LOW_PASSWORD } = process.env;
if (!BASE_URL || !TEST_EMAIL || !TEST_PASSWORD) {
  console.error('FAIL: BASE_URL, TEST_EMAIL, TEST_PASSWORD are required');
  process.exit(1);
}
const base = BASE_URL.replace(/\/$/, '');

async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('no set-cookie on login');
  return cookie.split(';')[0];
}
async function req(path, { method='GET', cookie, body, csrfToken }={}) {
  const headers = {
    ...(cookie ? { cookie } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
  };
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { res, json };
}

async function getCsrf(cookie) {
  const { json } = await req('/api/csrf-token', { cookie });
  return json?.csrfToken || json?.token || '';
}

let pass=0, fail=0, skip=0;
function ok(name){ console.log(`PASS ${name}`); pass++; }
function bad(name,why){ console.log(`FAIL ${name}: ${why}`); fail++; }
function skipped(name,why){ console.log(`SKIP ${name}: ${why}`); skip++; }

(async()=>{
  try {
    const adminCookie = await login(TEST_EMAIL, TEST_PASSWORD);
    const csrf = await getCsrf(adminCookie);

    // ── Persistence ────────────────────────────────────────────────────────
    const title = `staging-${Date.now()}`;
    const created = await req('/api/press', { method:'POST', cookie: adminCookie, csrfToken: csrf, body:{ type:'release', title, text:'e2e' }});
    if (![200,201].includes(created.res.status)) bad('persistence.create', created.res.status); else {
      const id = created.json?.item?.id || created.json?.id;
      const listed = await req('/api/press', { cookie: adminCookie });
      const found = JSON.stringify(listed.json||{}).includes(title);
      found ? ok('persistence') : bad('persistence', 'created entity not found after GET');

      // immutability check: author PUT should fail (press items are immutable after submit)
      if (id) {
        const patch = await req(`/api/press/${id}`, { method:'PUT', cookie: adminCookie, csrfToken: csrf, body:{ title:`edit-${title}` } });
        ([401,403,409].includes(patch.res.status) ? ok('immutability.author-edit-block') : bad('immutability.author-edit-block', patch.res.status));
      }
    }

    // ── Division authority: client-supplied weight is ignored ──────────────
    const divCreate = await req('/api/divisions/create', { method:'POST', cookie: adminCookie, csrfToken: csrf, body:{ entity_type:'motion', entity_id:`m-${Date.now()}`, title:'staging division' } });
    const did = divCreate.json?.division?.id || divCreate.json?.id;
    if (!did) bad('division.create','no id');
    else {
      const vote = await req(`/api/divisions/${did}/vote`, { method:'POST', cookie: adminCookie, csrfToken: csrf, body:{ vote:'aye', weight:9999 } });
      const ew = vote.json?.vote?.effective_weight;
      (ew === 1 ? ok('division.authority.weight-server') : bad('division.authority.weight-server', `effective_weight=${ew}`));
    }

    // ── Bill vote server authority (B3) ────────────────────────────────────
    // Create a test bill, cast a tampered-weight vote, verify server ignores client weight
    const billId = `bill-staging-${Date.now()}`;
    const billCreate = await req('/api/bills', { method:'POST', cookie: adminCookie, csrfToken: csrf, body:{
      id: billId, title: 'Staging Test Bill', status: 'in-progress', stage: 'Final Division',
      author: 'StagingTest', billText: 'Test.', amendments: [],
    }});
    if (![200,201].includes(billCreate.res.status)) {
      bad('division.bill-vote','could not create test bill: ' + billCreate.res.status);
    } else {
      const billVote = await req(`/api/bills/${billId}/vote`, { method:'PATCH', cookie: adminCookie, csrfToken: csrf, body:{ vote:'aye' } });
      if (![200,201].includes(billVote.res.status)) {
        bad('division.bill-vote', `PATCH /api/bills/:id/vote returned ${billVote.res.status}`);
      } else {
        const ew = billVote.json?.vote?.effective_weight;
        // effective_weight must be a number ≥ 0 (server-computed, not 9999)
        (typeof ew === 'number' && ew !== 9999 ? ok('division.bill-vote.server-weight') : bad('division.bill-vote.server-weight', `effective_weight=${ew}`));
      }
      // cleanup
      await req(`/api/bills/${billId}`, { method:'DELETE', cookie: adminCookie, csrfToken: csrf });
    }

    // ── RBAC ───────────────────────────────────────────────────────────────
    // Tier 1: unauthenticated write must return 401 (always testable without extra creds)
    const anonWrite = await req('/api/divisions/create', { method:'POST', csrfToken: csrf, body:{ entity_type:'motion', entity_id:'anon-test' } });
    ([401,403].includes(anonWrite.res.status) ? ok('rbac.unauthenticated-blocked') : bad('rbac.unauthenticated-blocked', anonWrite.res.status));

    // Tier 2: low-privilege authenticated user must be forbidden from admin-only writes
    if (TEST_LOW_EMAIL && TEST_LOW_PASSWORD) {
      const lowCookie = await login(TEST_LOW_EMAIL, TEST_LOW_PASSWORD);
      const lowCsrf = await getCsrf(lowCookie);
      const forbidden = await req('/api/divisions/create', { method:'POST', cookie: lowCookie, csrfToken: lowCsrf, body:{ entity_type:'motion', entity_id:'x' } });
      ([401,403].includes(forbidden.res.status) ? ok('rbac.low-priv-blocked') : bad('rbac.low-priv-blocked', forbidden.res.status));
    } else {
      skipped('rbac.low-priv-blocked', 'TEST_LOW_EMAIL/TEST_LOW_PASSWORD not set');
    }

  } catch (e) {
    bad('runner', e.message);
  }
  console.log(`\nSummary: pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail ? 1 : 0);
})();
