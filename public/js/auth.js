import { api } from './api.js';
import { initPage, state, $, safeNext } from './ui.js';

const next = safeNext(new URLSearchParams(location.search).get('next'));
const loginForm = $('#login-form');
const regForm = $('#register-form');
const err = $('#error');

if (await initPage({ title: loginForm ? 'Sign in' : 'Create account' })) {
  if (state.user) location.replace(next);
  // Keep the redirect target when switching between the two pages.
  const withNext = (a) => { if (a && next !== '/') a.href += `?next=${encodeURIComponent(next)}`; };
  withNext($('#to-register'));
  withNext($('#to-login'));

  (loginForm || regForm).addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(f));
      await api(loginForm ? '/auth/login' : '/auth/register', { method: 'POST', body });
      location.href = next;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}
