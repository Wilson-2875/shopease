import { api } from './api.js';
import { faqs } from './faq.js';
import { initPage, state, $, esc, toast } from './ui.js';

if (await initPage({ title: 'Support' })) {
  $('#faq').innerHTML = faqs.map((f) => `<details class="stack" style="padding:8px 0;border-bottom:1px solid var(--line)"><summary><strong>${esc(f.q)}</strong></summary><p style="margin-top:8px">${esc(f.a)}</p></details>`).join('');
   const { supportEmail, supportPhone, whatsappNumber } = state.config;
  $('#contact-info').innerHTML = [supportEmail && `Email: <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>`, supportPhone && `Phone: <a href="tel:${esc(supportPhone)}">${esc(supportPhone)}</a>`,whatsappNumber && `WhatsApp: <a href="https://wa.me/${esc(whatsappNumber)}" target="_blank" rel="noopener noreferrer">+${esc(whatsappNumber)}</a>`].filter(Boolean).join('<br>');

  const form = $('#support-form');
  if (state.user) { form.name.value = state.user.name; form.email.value = state.user.email; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#error').textContent = '';
    try {
      await api('/support', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      toast('Message sent. We will reply by email.');
      form.subject.value = '';
      form.message.value = '';
    } catch (err) { $('#error').textContent = err.message; }
  });
}
