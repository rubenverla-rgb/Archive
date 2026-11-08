import { onRequest } from '../functions/api/[[path]].js';
import { createTursoDatabase } from '../functions/lib/turso.js';
import { createBlobStorage } from '../functions/lib/blob.js';

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
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      return send(res, new Response(JSON.stringify({ error: 'blob_not_configured' }), {
        status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      }));
    }
    db = createTursoDatabase(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
    const env = {
      DB: db,
      FILES: createBlobStorage(),
      APP_ORIGIN: process.env.APP_ORIGIN,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      MAIL_FROM: process.env.MAIL_FROM
    };
    return await send(res, await onRequest({ request, env }));
  } catch (error) {
    console.error('Archive API error:', error);
    return send(res, new Response(JSON.stringify({ error: 'server' }), {
      status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    }));
  } finally {
    if (db) {
      try {
        await db.close();
      } catch (error) {
        console.error('Turso close error:', error);
      }
    }
  }
}

async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = res.req?.method === 'HEAD' || [204, 304].includes(response.status) ? null : Buffer.from(await response.arrayBuffer());
  res.end(body);
}
