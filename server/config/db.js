import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  decimalNumbers: true, // DECIMAL columns come back as numbers, not strings
  timezone: 'Z',
});

// Keep every connection in UTC so dates are consistent; the browser formats them in local time.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

/** Run a query and return only the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run fn(connection) inside a transaction; commits on success, rolls back on any error. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
