// Creates the database, tables and sample data.  Usage: npm run db:setup   (add --reset to wipe and rebuild)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database');
const reset = process.argv.includes('--reset');
const dbName = env.db.database.replace(/[^\w$]/g, '');

const conn = await mysql.createConnection({
  host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, multipleStatements: true,
});

try {
  if (reset) {
    console.log(`Dropping database ${dbName}...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);

  for (const file of ['schema.sql', 'seed.sql']) {
    // The files contain CREATE DATABASE / USE lines for manual runs; we handle that above.
    const sql = (await fs.readFile(path.join(dir, file), 'utf8')).replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, '');
    await conn.query(sql);
    console.log(`Ran ${file}`);
  }
  console.log('\nDatabase ready. Next: npm run db:admin   (creates the admin account)');
} catch (err) {
  console.error('\nDatabase setup failed:', err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
