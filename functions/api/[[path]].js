// Archive API — Cloudflare Pages Functions (D1 + R2)
// Alle routes onder /api/*. Bindings: DB (D1) en FILES (R2). Optioneel: RESEND_API_KEY, MAIL_FROM, APP_ORIGIN.

const enc = new TextEncoder();
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_JSON = 2_000_000;
const MAX_FILE = 6_000_000;
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf' };
const KINDS = ['collections', 'media', 'notes', 'quotes', 'reading', 'groups'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const bad = (code, status = 400) => { throw new HttpError(status, code); };
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const rnd = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
// Workers staat maximaal 100.000 PBKDF2-iteraties toe
async function pbkdf2(pw, saltHex) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: 100000, hash: 'SHA-256' }, k, 256));
}
function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const str = (v, max, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function cookie(req, name) {
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : null;
}
const setCookie = (token, maxAge, url) => `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;

async function readJson(req) {
  const t = await req.text();
  if (t.length > MAX_JSON) bad('too_large', 413);
  try { return JSON.parse(t || '{}'); } catch { return bad('bad_json'); }
}

async function userFromRequest(req, env) {
  const tok = cookie(req, 'sid');
  if (!tok) return null;
  const row = await env.DB.prepare(
    'SELECT u.id,u.email,u.name,u.prefs,u.ws_rev FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?'
  ).bind(await sha256(tok), now()).first();
  return row || null;
}
const pub = (u) => ({ name: u.name, email: u.email, prefs: safeJson(u.prefs, {}) });
function safeJson(s, d) { try { return JSON.parse(s); } catch { return d; } }

async function throttle(env, key, limit, windowMs) {
  const r = await env.DB.prepare('SELECT n,reset_at FROM throttle WHERE key=?').bind(key).first();
  if (r && r.reset_at > now() && r.n >= limit) bad('too_many', 429);
}
async function throttleHit(env, key, windowMs) {
  const r = await env.DB.prepare('SELECT n,reset_at FROM throttle WHERE key=?').bind(key).first();
  if (r && r.reset_at > now()) await env.DB.prepare('UPDATE throttle SET n=n+1 WHERE key=?').bind(key).run();
  else await env.DB.prepare('INSERT INTO throttle(key,n,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=1,reset_at=excluded.reset_at').bind(key, now() + windowMs).run();
}

async function startSession(env, userId, url) {
  const token = rnd(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), userId, now() + SESSION_MS)
  ]);
  return setCookie(token, SESSION_MS / 1000, url);
}

// ---------- validatie van gedeelde media ----------
const SRC_OK = (s) => s === '' || s.startsWith('/api/file/') || s.startsWith('assets/') || /^https:\/\//i.test(s);
const URL_OK = (s) => s === '' || /^https?:\/\//i.test(s);
function cleanTags(t) { return (Array.isArray(t) ? t : []).slice(0, 30).map((x) => str(x, 60).trim()).filter(Boolean); }
function cleanRec(r) {
  if (!r || typeof r !== 'object') bad('invalid');
  const id = str(r.id, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) bad('invalid');
  const src = str(r.src, 2000), img = str(r.img, 2000), u = str(r.u, 2000);
  if (!SRC_OK(src) || !URL_OK(img) || !URL_OK(u)) bad('invalid');
  const k = ['pdf', 'image', 'link', 'social'].includes(r.k) ? r.k : 'link';
  const ratio = Number(r.r); 
  const o = { id, t: str(r.t, 300), k, r: ratio > 0.05 && ratio < 20 ? ratio : 0.75, src, img, u, f: str(r.f, 300), d: str(r.d, 5000), at: str(r.at, 30), ll: str(r.ll, 40), lb: str(r.lb, 120), tags: cleanTags(r.tags), _u: Number(r._u) || 0 };
  if (r.by && typeof r.by === 'object') o.by = { name: str(r.by.name, 80), email: str(r.by.email, 200).toLowerCase() };
  return o;
}
function noInlineImages(obj) { if (JSON.stringify(obj).includes('"data:')) bad('upload_images_first'); }

// ---------- e-mail (optioneel via Resend) ----------
async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text })
    });
    return r.ok;
  } catch { return false; }
}

// ---------- router ----------
export async function onRequest({ request: req, env }) {
  const url = new URL(req.url);
  try {
    if (!env.DB || !env.FILES) return json({ error: 'not_configured' }, 503);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const o = req.headers.get('origin');
      if (o && new URL(o).host !== url.host) bad('forbidden', 403);
      if (req.headers.get('x-requested-with') !== 'archive') bad('forbidden', 403);
    }
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    return await route(req, env, url, path, path.split('/'));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}

async function route(req, env, url, path, seg) {
  const m = req.method;

  // ----- auth -----
  if (m === 'POST' && path === 'auth/register') {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    await throttle(env, 'r:' + ip, 20, 3600000);
    const b = await readJson(req);
    const name = str(b.name, 80).trim(), email = str(b.email, 200).trim().toLowerCase(), pw = str(b.password, 200);
    if (!name || !email || !pw) bad('missing');
    if (!EMAIL_RE.test(email)) bad('invalid_email');
    if (pw.length < 8) bad('weak_password');
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) bad('exists', 409);
    const id = rnd(8), salt = rnd(16), hash = await pbkdf2(pw, salt);
    await env.DB.prepare('INSERT INTO users(id,email,name,salt,hash,created_at) VALUES(?,?,?,?,?,?)').bind(id, email, name, salt, hash, now()).run();
    await throttleHit(env, 'r:' + ip, 3600000);
    const c = await startSession(env, id, url);
    return json({ user: { name, email, prefs: {} } }, 200, { 'set-cookie': c });
  }
  if (m === 'POST' && path === 'auth/login') {
    const b = await readJson(req);
    const email = str(b.email, 200).trim().toLowerCase(), pw = str(b.password, 200);
    if (!email || !pw) bad('missing');
    await throttle(env, 'l:' + email, 8, 900000);
    const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    const ok = u ? same(await pbkdf2(pw, u.salt), u.hash) : (await pbkdf2(pw, '00'.repeat(16)), false);
    if (!ok) { await throttleHit(env, 'l:' + email, 900000); bad('invalid_credentials', 401); }
    await env.DB.prepare('DELETE FROM throttle WHERE key=?').bind('l:' + email).run();
    const c = await startSession(env, u.id, url);
    return json({ user: pub(u) }, 200, { 'set-cookie': c });
  }
  if (m === 'POST' && path === 'auth/logout') {
    const tok = cookie(req, 'sid');
    if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0, url) });
  }

  // ----- vanaf hier is inloggen verplicht -----
  const user = await userFromRequest(req, env);
  if (path === 'me' && m === 'GET') return json({ user: user ? pub(user) : null });
  if (!user) bad('unauthorized', 401);

  if (path === 'me' && m === 'PATCH') {
    const b = await readJson(req);
    let name = user.name, email = user.email, prefs = safeJson(user.prefs, {});
    if (b.name !== undefined) { name = str(b.name, 80).trim(); if (!name) bad('missing'); }
    if (b.email !== undefined) {
      email = str(b.email, 200).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) bad('invalid_email');
      if (email !== user.email && await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) bad('exists', 409);
    }
    if (b.prefs && typeof b.prefs === 'object') {
      if (b.prefs.bg !== undefined) prefs.bg = str(b.prefs.bg, 40);
      if (b.prefs.lang === 'nl' || b.prefs.lang === 'en') prefs.lang = b.prefs.lang;
    }
    await env.DB.prepare('UPDATE users SET name=?,email=?,prefs=? WHERE id=?').bind(name, email, JSON.stringify(prefs), user.id).run();
    return json({ user: { name, email, prefs } });
  }
  if (path === 'me/password' && m === 'POST') {
    const b = await readJson(req);
    const u = await env.DB.prepare('SELECT salt,hash FROM users WHERE id=?').bind(user.id).first();
    if (!same(await pbkdf2(str(b.current, 200), u.salt), u.hash)) bad('invalid_credentials', 401);
    const next = str(b.next, 200);
    if (next.length < 8) bad('weak_password');
    const salt = rnd(16), tok = cookie(req, 'sid');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').bind(salt, await pbkdf2(next, salt), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').bind(user.id, await sha256(tok || ''))
    ]);
    return json({ ok: true });
  }
  if (path === 'me' && m === 'DELETE') {
    const b = await readJson(req);
    const u = await env.DB.prepare('SELECT salt,hash FROM users WHERE id=?').bind(user.id).first();
    if (!same(await pbkdf2(str(b.password, 200), u.salt), u.hash)) bad('invalid_credentials', 401);
    let cursor;
    for (let i = 0; i < 20; i++) {
      const l = await env.FILES.list({ prefix: `u/${user.id}/`, cursor });
      if (l.objects.length) await env.FILES.delete(l.objects.map((o) => o.key));
      if (!l.truncated) break;
      cursor = l.cursor;
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invites WHERE collection_id IN (SELECT id FROM shared_collections WHERE owner_id=?)').bind(user.id),
      env.DB.prepare('DELETE FROM members WHERE collection_id IN (SELECT id FROM shared_collections WHERE owner_id=?)').bind(user.id),
      env.DB.prepare('DELETE FROM shared_collections WHERE owner_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM members WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM workspace WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id)
    ]);
    return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0, url) });
  }

  // ----- persoonlijke gegevens -----
  if (path === 'workspace' && m === 'GET') {
    const rows = (await env.DB.prepare('SELECT kind,data FROM workspace WHERE user_id=?').bind(user.id).all()).results || [];
    const data = {};
    rows.forEach((r) => { data[r.kind] = safeJson(r.data, null); });
    return json({ rev: user.ws_rev, data });
  }
  if (path === 'workspace' && m === 'PUT') {
    const b = await readJson(req);
    if (!b.data || typeof b.data !== 'object') bad('invalid');
    const parts = [];
    for (const k of KINDS) {
      if (b.data[k] === undefined) continue;
      noInlineImages(b.data[k]);
      const s = JSON.stringify(b.data[k]);
      if (s.length > 1_900_000) bad('too_large', 413);
      parts.push([k, s]);
    }
    const r = await env.DB.prepare('UPDATE users SET ws_rev=ws_rev+1 WHERE id=? AND ws_rev=?').bind(user.id, Number(b.rev) || 0).run();
    if (!r.meta || r.meta.changes === 0) return json({ error: 'conflict' }, 409);
    if (parts.length) await env.DB.batch(parts.map(([k, s]) => env.DB.prepare('INSERT INTO workspace(user_id,kind,data) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET data=excluded.data').bind(user.id, k, s)));
    return json({ rev: (Number(b.rev) || 0) + 1 });
  }

  // ----- bestanden -----
  if (path === 'upload' && m === 'POST') {
    const ct = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = FILE_TYPES[ct];
    if (!ext) bad('type_not_allowed', 415);
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0) bad('empty');
    if (buf.byteLength > MAX_FILE) bad('too_large', 413);
    const name = rnd(16) + '.' + ext;
    await env.FILES.put(`u/${user.id}/${name}`, buf, { httpMetadata: { contentType: ct } });
    return json({ url: `/api/file/${user.id}/${name}` });
  }
  if (seg[0] === 'file' && seg.length === 3 && (m === 'GET' || m === 'HEAD')) {
    const [, uid, name] = seg;
    if (!/^[0-9a-f]{16}$/.test(uid) || !/^[0-9a-f]{32}\.(jpg|png|webp|gif|avif|pdf)$/.test(name)) bad('not_found', 404);
    if (uid !== user.id) {
      const needle = `/api/file/${uid}/${name}`;
      const ok = await env.DB.prepare(
        'SELECT 1 FROM shared_collections sc WHERE (sc.owner_id=?1 OR sc.id IN (SELECT collection_id FROM members WHERE user_id=?1)) AND (instr(sc.media, ?2) > 0 OR instr(sc.cover, ?2) > 0) LIMIT 1'
      ).bind(user.id, needle).first();
      if (!ok) bad('not_found', 404);
    }
    const o = await env.FILES.get(`u/${uid}/${name}`);
    if (!o) bad('not_found', 404);
    return new Response(m === 'HEAD' ? null : o.body, {
      headers: {
        'content-type': (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream',
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox"
      }
    });
  }

  // ----- link-voorbeeld: titel, beschrijving en afbeelding ophalen -----
  if (path === 'preview' && m === 'POST') return preview(req, env, user);

  // ----- gedeelde collecties -----
  if (seg[0] === 'shared') return shared(req, env, url, user, seg);

  bad('not_found', 404);
}

// ---------- link-voorbeeld ----------
function privateHost(h) {
  h = h.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || !h.includes('.');
}
async function limitedText(res, max) {
  const r = res.body.getReader(); const dec = new TextDecoder(); let out = '', n = 0;
  while (n < max) { const { done, value } = await r.read(); if (done) break; n += value.length; out += dec.decode(value, { stream: true }); }
  try { r.cancel(); } catch { /* ignore */ }
  return out;
}
const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decodeHtml(m[1]).trim();
  }
  return '';
}
async function preview(req, env, user) {
  const b = await readJson(req);
  let u;
  try { u = new URL(str(b.url, 2000)); } catch { return bad('invalid_url'); }
  if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) bad('invalid_url');
  const ua = { 'user-agent': 'Mozilla/5.0 (compatible; ArchiveBot/1.0; +link-preview)', accept: 'text/html,application/xhtml+xml' };
  let html = '';
  try {
    const res = await fetch(u.href, { headers: ua, redirect: 'follow', signal: AbortSignal.timeout(7000) });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return json({ title: '', description: '', image: '', site: u.hostname.replace(/^www\./, '') });
    html = await limitedText(res, 300000);
  } catch { return json({ title: '', description: '', image: '', site: u.hostname.replace(/^www\./, '') }); }
  const title = meta(html, ['og:title', 'twitter:title']) || decodeHtml((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  const description = meta(html, ['og:description', 'twitter:description', 'description']);
  let image = '';
  const im = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
  if (im) {
    try {
      const iu = new URL(im, u.href);
      if (/^https?:$/.test(iu.protocol) && !privateHost(iu.hostname)) {
        const r = await fetch(iu.href, { headers: { 'user-agent': ua['user-agent'], accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const ext = FILE_TYPES[ct];
        if (r.ok && ext && ext !== 'pdf') {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 0 && buf.byteLength <= MAX_FILE) {
            const name = rnd(16) + '.' + ext;
            await env.FILES.put(`u/${user.id}/${name}`, buf, { httpMetadata: { contentType: ct } });
            image = `/api/file/${user.id}/${name}`;
          }
        }
      }
    } catch { /* geen afbeelding */ }
  }
  return json({ title: title.slice(0, 300), description: description.slice(0, 1000), image, site: u.hostname.replace(/^www\./, '') });
}

// ---------- gedeelde collecties ----------
async function loadCols(env, user, onlyId) {
  const where = onlyId ? 'sc.id=?3' : '(sc.owner_id=?1 OR sc.id IN (SELECT collection_id FROM members WHERE user_id=?1) OR sc.id IN (SELECT collection_id FROM invites WHERE email=?2))';
  const order = ' ORDER BY sc.id';
  const q = env.DB.prepare(`SELECT sc.*,u.name AS oname,u.email AS oemail FROM shared_collections sc JOIN users u ON u.id=sc.owner_id WHERE ${where}${order}`);
  const rows = (await (onlyId ? q.bind(user.id, user.email, onlyId) : q.bind(user.id, user.email)).all()).results || [];
  const ids = rows.map((r) => r.id);
  const mem = [], inv = [];
  for (const part of chunks(ids, 80)) {
    const ph = part.map(() => '?').join(',');
    mem.push(...((await env.DB.prepare(`SELECT m.collection_id AS cid,u.email,u.name,u.id AS uid FROM members m JOIN users u ON u.id=m.user_id WHERE m.collection_id IN (${ph}) ORDER BY m.joined_at, u.email`).bind(...part).all()).results || []));
    inv.push(...((await env.DB.prepare(`SELECT collection_id AS cid,email,token FROM invites WHERE collection_id IN (${ph}) ORDER BY created_at, email`).bind(...part).all()).results || []));
  }
  const out = {};
  for (const r of rows) {
    const members = mem.filter((x) => x.cid === r.id);
    const isOwner = r.owner_id === user.id, isMember = members.some((x) => x.uid === user.id);
    const mine = inv.filter((x) => x.cid === r.id && x.email === user.email);
    if (!isOwner && !isMember && !mine.length) continue;
    out[r.id] = {
      id: r.id, name: r.name, desc: r.desc, cover: r.cover, ln: r.ln, rev: r.rev,
      owner: { name: r.oname, email: r.oemail },
      members: (isOwner || isMember) ? members.map((x) => ({ email: x.email, name: x.name })) : [],
      invites: isOwner ? inv.filter((x) => x.cid === r.id).map((x) => ({ email: x.email, token: x.token })) : mine.map((x) => ({ email: x.email, token: x.token })),
      media: (isOwner || isMember) ? safeJson(r.media, []) : []
    };
  }
  return out;
}
async function accessOf(env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM shared_collections WHERE id=?').bind(id).first();
  if (!row) bad('not_found', 404);
  const isOwner = row.owner_id === user.id;
  const isMember = isOwner || !!(await env.DB.prepare('SELECT 1 FROM members WHERE collection_id=? AND user_id=?').bind(id, user.id).first());
  return { row, isOwner, isMember };
}

async function shared(req, env, url, user, seg) {
  const m = req.method, id = seg[1];
  if (seg.length === 1 && m === 'GET') return json({ cols: await loadCols(env, user) });

  if (seg.length === 1 && m === 'POST') { // aanmaken
    const b = await readJson(req);
    const cid = str(b.id, 20);
    if (!/^s[0-9a-f]{12}$/.test(cid)) bad('invalid');
    const media = (Array.isArray(b.media) ? b.media : []).slice(0, 2000).map(cleanRec);
    media.forEach((r) => { if (!r.by) r.by = { name: user.name, email: user.email }; });
    const cover = str(b.cover, 2000);
    if (!SRC_OK(cover)) bad('invalid');
    if (await env.DB.prepare('SELECT 1 FROM shared_collections WHERE id=?').bind(cid).first()) bad('exists', 409);
    await env.DB.prepare('INSERT INTO shared_collections(id,owner_id,name,desc,cover,ln,rev,media,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
      .bind(cid, user.id, str(b.name, 200) || 'Collectie', str(b.desc, 2000), cover, str(b.ln, 200), JSON.stringify(media), now()).run();
    return json({ col: (await loadCols(env, user, cid))[cid] });
  }

  if (!id || !/^s[0-9a-f]{12}$/.test(id)) bad('not_found', 404);

  // accepteren / weigeren (voor wie is uitgenodigd)
  if (seg[2] === 'accept' && m === 'POST') {
    const b = await readJson(req);
    const inv = await env.DB.prepare('SELECT * FROM invites WHERE token=? AND collection_id=?').bind(str(b.token, 64), id).first();
    if (!inv) bad('not_found', 404);
    if (inv.email !== user.email) bad('wrong_email', 403);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO members(collection_id,user_id,joined_at) VALUES(?,?,?)').bind(id, user.id, now()),
      env.DB.prepare('DELETE FROM invites WHERE token=?').bind(inv.token)
    ]);
    return json({ col: (await loadCols(env, user, id))[id] });
  }
  if (seg[2] === 'decline' && m === 'POST') {
    const b = await readJson(req);
    await env.DB.prepare('DELETE FROM invites WHERE token=? AND collection_id=? AND email=?').bind(str(b.token, 64), id, user.email).run();
    return json({ ok: true });
  }

  const { row, isOwner, isMember } = await accessOf(env, user, id);
  if (!isMember) bad('not_found', 404);

  if (seg.length === 2 && m === 'PUT') { // bijwerken (met versiecontrole)
    const b = await readJson(req);
    if (Number(b.rev) !== row.rev) return json({ error: 'conflict', col: (await loadCols(env, user, id))[id] }, 409);
    const incoming = (Array.isArray(b.media) ? b.media : []).slice(0, 2000).map(cleanRec);
    const cur = safeJson(row.media, []);
    let next;
    if (isOwner) {
      next = incoming.map((r) => { if (!r.by) r.by = { name: user.name, email: user.email }; return r; });
    } else {
      const curBy = new Map(cur.map((r) => [r.id, r]));
      const mine = (r) => r && r.by && r.by.email === user.email;
      next = [];
      const seen = new Set();
      for (const r of incoming) {
        const old = curBy.get(r.id);
        seen.add(r.id);
        if (!old) next.push({ ...r, by: { name: user.name, email: user.email } }); // nieuw: altijd onder eigen naam
        else if (mine(old)) next.push({ ...r, by: old.by }); // eigen item: alles aanpasbaar
        else next.push({ ...old, tags: r.tags }); // item van een ander: alleen tags
      }
      cur.forEach((r) => { if (!seen.has(r.id) && !mine(r)) next.push(r); }); // andermans items kun je niet verwijderen
      const order = new Map(cur.map((r, i) => [r.id, i]));
      next.sort((a, b2) => (order.has(a.id) ? order.get(a.id) : 1e9) - (order.has(b2.id) ? order.get(b2.id) : 1e9));
    }
    next.forEach((r) => { if (!r._u) r._u = now(); });
    let name = row.name, desc = row.desc, cover = row.cover;
    if (isOwner) {
      if (b.name !== undefined) name = str(b.name, 200) || row.name;
      if (b.desc !== undefined) desc = str(b.desc, 2000);
      if (b.cover !== undefined) { cover = str(b.cover, 2000); if (!SRC_OK(cover)) bad('invalid'); }
    }
    const s = JSON.stringify(next);
    if (s.length > 1_900_000) bad('too_large', 413);
    await env.DB.prepare('UPDATE shared_collections SET name=?,desc=?,cover=?,media=?,rev=rev+1,updated_at=? WHERE id=?').bind(name, desc, cover, s, now(), id).run();
    return json({ col: (await loadCols(env, user, id))[id] });
  }

  if (seg.length === 2 && m === 'DELETE') { // eigenaar: stop met delen
    if (!isOwner) bad('forbidden', 403);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM invites WHERE collection_id=?').bind(id),
      env.DB.prepare('DELETE FROM members WHERE collection_id=?').bind(id),
      env.DB.prepare('DELETE FROM shared_collections WHERE id=?').bind(id)
    ]);
    return json({ ok: true });
  }
  if (seg[2] === 'leave' && m === 'POST') {
    if (isOwner) bad('forbidden', 403);
    await env.DB.prepare('DELETE FROM members WHERE collection_id=? AND user_id=?').bind(id, user.id).run();
    return json({ ok: true });
  }

  if (seg[2] === 'invites' && seg.length === 3 && m === 'POST') {
    if (!isOwner) bad('forbidden', 403);
    const b = await readJson(req);
    const email = str(b.email, 200).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) bad('invalid_email');
    if (email === user.email) bad('own_email');
    const dupe = await env.DB.prepare('SELECT 1 FROM invites WHERE collection_id=? AND email=?').bind(id, email).first()
      || await env.DB.prepare('SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.collection_id=? AND u.email=?').bind(id, email).first();
    if (dupe) bad('duplicate', 409);
    const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE collection_id=?').bind(id).first()).n;
    if (count >= 50) bad('too_many', 429);
    const token = rnd(12);
    await env.DB.prepare('INSERT INTO invites(token,collection_id,email,created_at) VALUES(?,?,?,?)').bind(token, id, email, now()).run();
    const origin = env.APP_ORIGIN || url.origin;
    const text = `Hoi,\n\n${user.name} nodigt je uit om samen media toe te voegen aan de collectie "${row.name}" in Archive.\n\nOpen deze link om de uitnodiging te accepteren:\n${origin}/#invite=${token}\n\nLet op: log in of registreer met dit e-mailadres.\n`;
    const emailed = await sendMail(env, email, `${user.name} nodigt je uit voor de collectie "${row.name}"`, text);
    return json({ invite: { email, token }, emailed });
  }
  if (seg[2] === 'invites' && seg.length === 4 && m === 'DELETE') {
    if (!isOwner) bad('forbidden', 403);
    await env.DB.prepare('DELETE FROM invites WHERE token=? AND collection_id=?').bind(seg[3], id).run();
    return json({ ok: true });
  }
  if (seg[2] === 'members' && seg.length === 4 && m === 'DELETE') {
    if (!isOwner) bad('forbidden', 403);
    const email = decodeURIComponent(seg[3]).toLowerCase();
    await env.DB.prepare('DELETE FROM members WHERE collection_id=? AND user_id=(SELECT id FROM users WHERE email=?)').bind(id, email).run();
    return json({ ok: true });
  }
  return bad('not_found', 404);
}
