import { del, get, list, put } from '@vercel/blob';

// Vercel Blob adapter met dezelfde interface als de API eerder gebruikte.
export function createBlobStorage() {
  return {
    async put(key, body, options = {}) {
      await put(key, body, {
        access: 'private',
        addRandomSuffix: false,
        contentType: options.httpMetadata?.contentType || 'application/octet-stream'
      });
    },
    async get(key) {
      const result = await get(key, { access: 'private' });
      if (!result || result.statusCode !== 200) return null;
      return {
        body: result.stream,
        httpMetadata: { contentType: result.blob?.contentType || 'application/octet-stream' }
      };
    },
    async delete(keys) {
      if (keys?.length) await del(keys);
    },
    async list({ prefix = '', cursor } = {}) {
      const result = await list({ prefix, cursor, limit: 1000 });
      return {
        objects: (result.blobs || []).map((item) => ({ key: item.pathname })),
        truncated: !!result.hasMore,
        cursor: result.cursor
      };
    }
  };
}
