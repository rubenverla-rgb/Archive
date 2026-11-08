import { createClient } from '@libsql/client/web';

// Adapta la interfaz D1 usada por la API a Turso/libSQL.
export function createTursoDatabase(url, authToken) {
  const client = createClient({ url, authToken });
  function statement(sql, values = []) {
    return {
      sql,
      args: values,
      bind(...next) { return statement(sql, next); },
      async first() {
        const result = await client.execute({ sql, args: values });
        return result.rows[0] || null;
      },
      async all() {
        const result = await client.execute({ sql, args: values });
        return { results: result.rows };
      },
      async run() {
        const result = await client.execute({ sql, args: values });
        return { success: true, meta: { changes: Number(result.rowsAffected || 0), last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) } };
      }
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      return client.batch(statements.map((s) => ({ sql: s.sql, args: s.args })), 'write');
    },
    close() { return client.close(); }
  };
}
