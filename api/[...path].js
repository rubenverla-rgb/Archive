import { onRequest } from '../functions/api/[[path]].js';
import { createTursoDatabase } from '../functions/lib/turso.js';
import { createR2Storage } from '../functions/lib/r2-s3.js';

// Vercel Node.js Function catch-all for /api/*.
export const config = { api: { bodyParser: false } };

function headersFromNode(source) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, String(v)));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

export default async function handler(req, res) {
  let db = null;
  try {
    const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    url.protocol = proto === 'http' ? 'http:' : 'https:';
    const requestInit = { method: req.method || 'GET', headers: headersFromNode(req.headers) };
    if (!['GET', 'HEAD'].includes(requestInit.method)) {
      requestInit.body = req;
      requestInit.duplex = 'half';
    }
    const request = new Request(url, requestInit);

    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      return send(res, new Response(JSON.stringify({ error: 'turso_not_configured' }), {
        status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      }));
    }
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
      return send(res, new Response(JSON.stringify({ error: 'not_configured' }), {
        status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      }));
    }
    db = createTursoDatabase(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
    const files = createR2Storage(process.env);
    const env = {
      DB: db,
      FILES: files,
      APP_ORIGIN: process.env.APP_ORIGIN,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      MAIL_FROM: process.env.MAIL_FROM
    };
    const response = await onRequest({ request, env });
    return await send(res, response);
  } catch (error) {
    console.error('Archive API error:', error);
    const missingConfig = error?.message === 'R2_NOT_CONFIGURED';
    return send(res, new Response(JSON.stringify({ error: missingConfig ? 'not_configured' : 'server' }), {
      status: missingConfig ? 503 : 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }));
  } finally {
    if (db) await db.close().catch((error) => console.error('Turso close error:', error));
  }
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = ['HEAD'].includes(res.req?.method) || [204, 304].includes(response.status) ? null : Buffer.from(await response.arrayBuffer());
  res.end(body);
}
