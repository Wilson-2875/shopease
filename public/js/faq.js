// Shared by the support page (FAQ list) and the chat helper (keyword answers).
export const faqs = [
  { q: 'How long does delivery take?', a: 'Standard delivery takes about 7 days, express about 3 days and next-day delivery 1 day. You choose the option at checkout.', keys: ['deliver', 'shipping', 'ship', 'how long', 'arrive'] },
  { q: 'How can I pay?', a: 'You can pay by card, M-Pesa, PayPal or bank transfer. Bank transfer orders are processed once we confirm your payment.', keys: ['pay', 'payment', 'mpesa', 'm-pesa', 'card', 'paypal', 'transfer'] },
  { q: 'Can I cancel or change my order?', a: 'You can cancel an order from your account until it has shipped. Open the order and choose "Cancel order".', keys: ['cancel', 'change order', 'modify'] },
  { q: 'How do I track my order?', a: 'Open Account > Orders and select your order. The tracking page shows each stage and the tracking number once it ships.', keys: ['track', 'where is my order', 'status'] },
  { q: 'What is your return policy?', a: 'Contact us within 7 days of delivery with your order number and we will arrange a return or refund for unused items.', keys: ['return', 'refund', 'money back', 'exchange'] },
  { q: 'I forgot my password', a: 'Contact support with the email on your account and we will help you regain access.', keys: ['password', 'login', 'sign in', 'locked'] },
  { q: 'How do I use a coupon?', a: 'Enter the code in the "Coupon" box at checkout and select Apply. The discount appears in your order summary.', keys: ['coupon', 'discount', 'promo', 'code', 'voucher'] },
];

/** Very small rule-based helper: finds the FAQ whose keywords appear in the question. */
export function answerQuestion(text) {
  const t = text.toLowerCase();
  const hit = faqs.find((f) => f.keys.some((k) => t.includes(k)));
  if (hit) return { text: hit.a };
  return { text: "I'm not sure about that one. Send us a message and a person will reply.", link: { href: '/support.html', label: 'Contact support' } };
}
