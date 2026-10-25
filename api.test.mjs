// Integratietest voor de API. Start eerst: npm run dev   (daarna: npm test)
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const sfx = Math.random().toString(16).slice(2, 8);

function client() {
  let cookie = '';
  return async (method, path, body, opts = {}) => {
    const headers = { 'x-requested-with': 'archive', ...(opts.headers || {}) };
    if (cookie) headers.cookie = cookie;
    let payload = body;
    if (body !== undefined && !opts.raw) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

const A = client(), B = client(), C = client();
const aEmail = `anna-${sfx}@test.be`, bEmail = `bert-${sfx}@test.be`, cEmail = `carl-${sfx}@test.be`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

await t('niet ingelogd: /api/me geeft user null', async () => {
  const r = await A('GET', '/api/me'); assert.equal(r.status, 200); assert.equal(r.data.user, null);
  assert.equal((await A('GET', '/api/workspace')).status, 401);
});
await t('registreren: validatie en dubbele e-mail', async () => {
  assert.equal((await A('POST', '/api/auth/register', { name: 'Anna', email: 'geen-email', password: 'geheim123' })).data.error, 'invalid_email');
  assert.equal((await A('POST', '/api/auth/register', { name: 'Anna', email: aEmail, password: 'kort' })).data.error, 'weak_password');
  const r = await A('POST', '/api/auth/register', { name: 'Anna', email: aEmail, password: 'geheim123' });
  assert.equal(r.status, 200); assert.equal(r.data.user.email, aEmail);
  assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await A('GET', '/api/me')).data.user.name, 'Anna');
  assert.equal((await client()('POST', '/api/auth/register', { name: 'X', email: aEmail, password: 'geheim123' })).status, 409);
});
await t('CSRF: schrijven zonder header of met vreemde origin mislukt', async () => {
  const r = await fetch(BASE + '/api/auth/logout', { method: 'POST' }); assert.equal(r.status, 403);
  const r2 = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'archive', origin: 'https://evil.example' } }); assert.equal(r2.status, 403);
});
await t('inloggen: fout wachtwoord, juist wachtwoord, uitloggen', async () => {
  const L = client();
  assert.equal((await L('POST', '/api/auth/login', { email: aEmail, password: 'fout-fout' })).status, 401);
  const ok = await L('POST', '/api/auth/login', { email: aEmail, password: 'geheim123' }); assert.equal(ok.status, 200);
  assert.equal((await L('GET', '/api/me')).data.user.email, aEmail);
  await L('POST', '/api/auth/logout'); assert.equal((await L('GET', '/api/me')).data.user, null);
});
await t('inloggen wordt geblokkeerd na te veel pogingen', async () => {
  const L = client(); let last;
  for (let i = 0; i < 9; i++) last = await L('POST', '/api/auth/login', { email: `nobody-${sfx}@test.be`, password: 'x'.repeat(9) });
  assert.equal(last.status, 429);
});
await t('profiel, voorkeuren en wachtwoord wijzigen', async () => {
  const r = await A('PATCH', '/api/me', { name: 'Anna A', prefs: { bg: 'stad', lang: 'en' } });
  assert.equal(r.data.user.name, 'Anna A'); assert.deepEqual(r.data.user.prefs, { bg: 'stad', lang: 'en' });
  assert.equal((await A('PATCH', '/api/me', { email: 'nope' })).data.error, 'invalid_email');
  assert.equal((await A('POST', '/api/me/password', { current: 'verkeerd1', next: 'nieuw-wachtwoord' })).status, 401);
  assert.equal((await A('POST', '/api/me/password', { current: 'geheim123', next: 'kort' })).data.error, 'weak_password');
  assert.equal((await A('POST', '/api/me/password', { current: 'geheim123', next: 'nieuw-wachtwoord' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/login', { email: aEmail, password: 'geheim123' })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: aEmail, password: 'nieuw-wachtwoord' })).status, 200);
});
await t('workspace: opslaan, versiecontrole en geen inline afbeeldingen', async () => {
  let r = await A('GET', '/api/workspace'); assert.equal(r.data.rev, 0); assert.deepEqual(r.data.data, {});
  const data = { collections: [{ id: 'c1', name: 'Test', m: ['m1'] }], media: [{ id: 'm1', t: 'Item', src: '/api/file/x/y.jpg' }], notes: [{ t: 'Notitie' }], quotes: [], reading: [], groups: { notities: [] } };
  r = await A('PUT', '/api/workspace', { rev: 0, data }); assert.equal(r.status, 200); assert.equal(r.data.rev, 1);
  r = await A('GET', '/api/workspace'); assert.equal(r.data.rev, 1); assert.equal(r.data.data.collections[0].name, 'Test');
  assert.equal((await A('PUT', '/api/workspace', { rev: 0, data })).status, 409);
  assert.equal((await A('PUT', '/api/workspace', { rev: 1, data: { media: [{ src: 'data:image/png;base64,AAAA' }] } })).data.error, 'upload_images_first');
  assert.equal((await B('PUT', '/api/workspace', { rev: 0, data })).status, 401);
});
let fileUrl;
await t('bestanden uploaden en ophalen (met toegangscontrole)', async () => {
  const bad = await A('POST', '/api/upload', Buffer.from('x'), { raw: true, headers: { 'content-type': 'image/svg+xml' } }); assert.equal(bad.status, 415);
  const up = await A('POST', '/api/upload', PNG, { raw: true, headers: { 'content-type': 'image/png' } });
  assert.equal(up.status, 200); fileUrl = up.data.url; assert.match(fileUrl, /^\/api\/file\/[0-9a-f]{16}\/[0-9a-f]{32}\.png$/);
  const g = await A('GET', fileUrl); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/png'); assert.deepEqual(g.data, PNG);
  assert.equal((await client()('GET', fileUrl)).status, 401);
  await B('POST', '/api/auth/register', { name: 'Bert', email: bEmail, password: 'geheim123' });
  assert.equal((await B('GET', fileUrl)).status, 404);
});
await t('link-voorbeeld weigert lokale adressen', async () => {
  for (const u of ['http://localhost/x', 'http://127.0.0.1/', 'ftp://example.com/a', 'nonsense']) assert.equal((await A('POST', '/api/preview', { url: u })).data.error, 'invalid_url');
});
const sid = 's' + sfx.padEnd(12, '0').slice(0, 12);
let tokB;
await t('delen: aanmaken, uitnodigen, accepteren', async () => {
  const media = [{ id: 'aaaaaa01', t: 'Van Anna', k: 'image', r: 0.75, src: fileUrl, tags: ['a'] }];
  let r = await A('POST', '/api/shared', { id: sid, name: 'Gedeeld', desc: 'x', cover: fileUrl, ln: 'Gedeeld', media });
  assert.equal(r.status, 200); assert.equal(r.data.col.rev, 1); assert.equal(r.data.col.media[0].by.email, aEmail);
  assert.equal((await A('POST', '/api/shared', { id: 'zzz', name: 'x' })).status, 400);
  r = await A('POST', `/api/shared/${sid}/invites`, { email: 'geen' }); assert.equal(r.data.error, 'invalid_email');
  assert.equal((await A('POST', `/api/shared/${sid}/invites`, { email: aEmail })).data.error, 'own_email');
  r = await A('POST', `/api/shared/${sid}/invites`, { email: bEmail }); assert.equal(r.status, 200); tokB = r.data.invite.token; assert.equal(r.data.emailed, false);
  assert.equal((await A('POST', `/api/shared/${sid}/invites`, { email: bEmail })).status, 409);
  r = await B('GET', '/api/shared'); const col = r.data.cols[sid];
  assert.ok(col, 'Bert ziet de uitnodiging'); assert.equal(col.media.length, 0); assert.equal(col.invites.length, 1); assert.equal(col.members.length, 0);
  assert.equal((await B('GET', fileUrl)).status, 404);
  await C('POST', '/api/auth/register', { name: 'Carl', email: cEmail, password: 'geheim123' });
  assert.equal((await C('POST', `/api/shared/${sid}/accept`, { token: tokB })).status, 403);
  assert.equal(Object.keys((await C('GET', '/api/shared')).data.cols).length, 0);
  r = await B('POST', `/api/shared/${sid}/accept`, { token: tokB }); assert.equal(r.status, 200);
  assert.equal(r.data.col.members.length, 1); assert.equal(r.data.col.media.length, 1); assert.equal(r.data.col.invites.length, 0);
  assert.equal((await B('GET', fileUrl)).status, 200, 'lid mag gedeelde afbeelding zien');
});
await t('delen: leden voegen toe en mogen alleen eigen items wijzigen', async () => {
  let r = await B('GET', '/api/shared'); let col = r.data.cols[sid];
  const items = [...col.media.map((m) => ({ ...m, t: 'GEHACKT', tags: [...m.tags, 'bert-tag'], by: { name: 'Anna', email: aEmail } })), { id: 'bbbbbb01', t: 'Van Bert', k: 'link', u: 'https://example.com', tags: ['b'], by: { name: 'Anna', email: aEmail } }];
  r = await B('PUT', `/api/shared/${sid}`, { rev: col.rev, name: 'Geen recht', media: items });
  assert.equal(r.status, 200); col = r.data.col;
  assert.equal(col.name, 'Gedeeld', 'lid kan niet hernoemen');
  const a1 = col.media.find((m) => m.id === 'aaaaaa01'), b1 = col.media.find((m) => m.id === 'bbbbbb01');
  assert.equal(a1.t, 'Van Anna', 'titel van andermans item blijft'); assert.deepEqual(a1.tags, ['a', 'bert-tag'], 'tags zijn gedeeld');
  assert.equal(b1.by.email, bEmail, 'nieuwe items krijgen de naam van de lid');
  r = await B('PUT', `/api/shared/${sid}`, { rev: col.rev, media: col.media.filter((m) => m.id !== 'aaaaaa01') });
  assert.ok(r.data.col.media.some((m) => m.id === 'aaaaaa01'), 'lid kan andermans item niet verwijderen');
  assert.equal((await B('PUT', `/api/shared/${sid}`, { rev: 1, media: [] })).status, 409, 'oude versie wordt geweigerd');
  assert.equal((await B('POST', `/api/shared/${sid}/invites`, { email: 'x@y.be' })).status, 403);
  assert.equal((await B('DELETE', `/api/shared/${sid}`)).status, 403);
  assert.equal((await C('PUT', `/api/shared/${sid}`, { rev: 1, media: [] })).status, 404, 'buitenstaander ziet niets');
  r = await B('PUT', `/api/shared/${sid}`, { rev: r.data.col.rev, media: r.data.col.media.filter((m) => m.id !== 'bbbbbb01') });
  assert.ok(!r.data.col.media.some((m) => m.id === 'bbbbbb01'), 'lid kan eigen item wel verwijderen');
});
await t('delen: ongeldige gegevens worden geweigerd', async () => {
  const col = (await A('GET', '/api/shared')).data.cols[sid];
  assert.equal((await A('PUT', `/api/shared/${sid}`, { rev: col.rev, media: [{ id: 'cccccc01', t: 'x', src: 'data:image/png;base64,AAAA' }] })).data.error, 'invalid');
  assert.equal((await A('PUT', `/api/shared/${sid}`, { rev: col.rev, media: [{ id: 'cccccc02', t: 'x', u: 'javascript:alert(1)' }] })).data.error, 'invalid');
});
await t('delen: eigenaar beheert leden en stopt met delen', async () => {
  let col = (await A('GET', '/api/shared')).data.cols[sid];
  let r = await A('PUT', `/api/shared/${sid}`, { rev: col.rev, name: 'Nieuwe naam', media: col.media }); assert.equal(r.data.col.name, 'Nieuwe naam');
  r = await A('POST', `/api/shared/${sid}/invites`, { email: cEmail }); const tokC = r.data.invite.token;
  assert.equal((await A('DELETE', `/api/shared/${sid}/invites/${tokC}`)).status, 200);
  assert.equal((await C('POST', `/api/shared/${sid}/accept`, { token: tokC })).status, 404);
  r = await A('POST', `/api/shared/${sid}/invites`, { email: cEmail }); const tok2 = r.data.invite.token;
  assert.equal((await C('POST', `/api/shared/${sid}/decline`, { token: tok2 })).status, 200);
  assert.equal(Object.keys((await C('GET', '/api/shared')).data.cols).length, 0);
  assert.equal((await A('DELETE', `/api/shared/${sid}/members/${encodeURIComponent(bEmail)}`)).status, 200);
  assert.equal(Object.keys((await B('GET', '/api/shared')).data.cols).length, 0, 'verwijderd lid ziet niets meer');
  r = await A('POST', `/api/shared/${sid}/invites`, { email: bEmail }); await B('POST', `/api/shared/${sid}/accept`, { token: r.data.invite.token });
  assert.equal((await B('POST', `/api/shared/${sid}/leave`)).status, 200);
  assert.equal(Object.keys((await B('GET', '/api/shared')).data.cols).length, 0);
  assert.equal((await A('DELETE', `/api/shared/${sid}`)).status, 200);
  assert.equal(Object.keys((await A('GET', '/api/shared')).data.cols).length, 0);
});
await t('account verwijderen ruimt alles op', async () => {
  assert.equal((await C('DELETE', '/api/me', { password: 'fout-fout' })).status, 401);
  assert.equal((await C('DELETE', '/api/me', { password: 'geheim123' })).status, 200);
  assert.equal((await C('GET', '/api/me')).data.user, null);
  assert.equal((await client()('POST', '/api/auth/login', { email: cEmail, password: 'geheim123' })).status, 401);
  assert.equal((await A('DELETE', '/api/me', { password: 'nieuw-wachtwoord' })).status, 200);
  assert.equal((await B('GET', fileUrl)).status, 404);
});
console.log(`\n${passed} testgroepen geslaagd`);
