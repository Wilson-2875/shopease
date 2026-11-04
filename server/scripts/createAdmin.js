// Creates (or promotes) the admin account from ADMIN_* values in .env.  Usage: npm run db:admin
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';

const name = process.env.ADMIN_NAME || 'Store Admin';
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

try {
  if (!email || password.length < 8) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters in .env');
  const hash = await bcrypt.hash(password, 12);
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows[0]) {
    await pool.query("UPDATE users SET role = 'admin', password_hash = ?, name = ? WHERE id = ?", [hash, name, rows[0].id]);
    console.log(`Updated existing user ${email} to admin with the password from .env`);
  } else {
    await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [name, email, hash]);
    console.log(`Admin account created: ${email}`);
  }
  console.log('Sign in at /login.html, then change the password from your account page.');
} catch (err) {
  console.error('Could not create admin:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  void env;
}
