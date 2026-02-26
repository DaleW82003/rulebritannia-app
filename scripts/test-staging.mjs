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
async function req(path, { method='GET', cookie, body }={}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { res, json };
}

let pass=0, fail=0;
function ok(name){ console.log(`PASS ${name}`); pass++; }
function bad(name,why){ console.log(`FAIL ${name}: ${why}`); fail++; }

(async()=>{
  try {
    const adminCookie = await login(TEST_EMAIL, TEST_PASSWORD);

    // persistence
    const title = `staging-${Date.now()}`;
    const created = await req('/api/press', { method:'POST', cookie: adminCookie, body:{ type:'release', title, text:'e2e' }});
    if (![200,201].includes(created.res.status)) bad('persistence.create', created.res.status); else {
      const id = created.json?.item?.id || created.json?.id;
      const listed = await req('/api/press', { cookie: adminCookie });
      const found = JSON.stringify(listed.json||{}).includes(title);
      found ? ok('persistence') : bad('persistence', 'created entity not found after GET');
      // immutability check author patch should fail
      if (id) {
        const patch = await req(`/api/press/${id}`, { method:'PUT', cookie: adminCookie, body:{ title:`edit-${title}` } });
        ([401,403,409].includes(patch.res.status) ? ok('immutability.author-edit-block') : bad('immutability.author-edit-block', patch.res.status));
      }
    }

    // division authority: client weight tamper ignored
    const divCreate = await req('/api/divisions/create', { method:'POST', cookie: adminCookie, body:{ entity_type:'motion', entity_id:`m-${Date.now()}`, title:'staging division' } });
    const did = divCreate.json?.division?.id || divCreate.json?.id;
    if (!did) bad('division.create','no id');
    else {
      const vote = await req(`/api/divisions/${did}/vote`, { method:'POST', cookie: adminCookie, body:{ vote:'aye', weight:9999 } });
      const ew = vote.json?.vote?.effective_weight;
      (ew === 1 ? ok('division.authority.weight-server') : bad('division.authority.weight-server', `effective_weight=${ew}`));
    }

    // rbac low user optional
    if (TEST_LOW_EMAIL && TEST_LOW_PASSWORD) {
      const lowCookie = await login(TEST_LOW_EMAIL, TEST_LOW_PASSWORD);
      const forbidden = await req('/api/divisions/create', { method:'POST', cookie: lowCookie, body:{ entity_type:'motion', entity_id:'x' } });
      ([401,403].includes(forbidden.res.status) ? ok('rbac.forbidden-write') : bad('rbac.forbidden-write', forbidden.res.status));
    } else {
      bad('rbac.forbidden-write','TEST_LOW_EMAIL/TEST_LOW_PASSWORD missing');
    }
  } catch (e) {
    bad('runner', e.message);
  }
  console.log(`\nSummary: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
