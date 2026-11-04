import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { esc } from '../utils/http.js';

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  transporter = env.smtp.host
    ? nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.port === 465,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      })
    : null;
  return transporter;
}

/** Sends an email. Never throws: a failed email must not break an order. */
export async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email not sent - SMTP not configured] to=${to} subject="${subject}"`);
    return false;
  }
  try {
    await t.sendMail({ from: env.mailFrom, to, subject, html, text });
    return true;
  } catch (err) {
    console.error('Email failed:', err.message);
    return false;
  }
}

const money = (n) => `${env.currency} ${Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function sendOrderConfirmation(user, order) {
  const rows = order.items
    .map((i) => `<tr><td>${esc(i.name)} &times; ${i.quantity}</td><td align="right">${money(i.price * i.quantity)}</td></tr>`)
    .join('');
  return sendMail({
    to: user.email,
    subject: `${env.storeName} order ${order.order_number} received`,
    html: `<h2>Thanks for your order, ${esc(user.name)}!</h2>
      <p>Order <strong>${esc(order.order_number)}</strong> is ${esc(order.status)}.</p>
      <table cellpadding="6" width="100%">${rows}
        <tr><td>Shipping</td><td align="right">${money(order.shipping)}</td></tr>
        <tr><td><strong>Total</strong></td><td align="right"><strong>${money(order.total)}</strong></td></tr></table>
      <p><a href="${env.appUrl}/order.html?id=${order.id}">Track your order</a></p>`,
  });
}

export function sendStatusUpdate(order) {
  return sendMail({
    to: order.customer_email,
    subject: `${env.storeName} order ${order.order_number}: ${order.status}`,
    html: `<p>Hi ${esc(order.customer_name)}, your order <strong>${esc(order.order_number)}</strong> is now <strong>${esc(order.status)}</strong>.</p>
      ${order.tracking_number ? `<p>Tracking number: <strong>${esc(order.tracking_number)}</strong></p>` : ''}
      <p><a href="${env.appUrl}/order.html?id=${order.id}">View your order</a></p>`,
  });
}
