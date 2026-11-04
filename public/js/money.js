// Adapted from the original money.js, extended with currency formatting.
let currency = 'KES';
export const setCurrency = (c) => { if (c) currency = c; };

export function formatMoney(amount) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
  }
}

/** Percent change from previous to current price. Negative = price dropped. Returns a number. */
export function calculatePercentChange(currentPrice, previousPrice) {
  if (!previousPrice) return 0;
  return Math.round(((currentPrice - previousPrice) / previousPrice) * 100);
}
