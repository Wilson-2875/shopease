import { HttpError, str } from './http.js';

/** Validate an address object coming from the client and return a clean copy. */
export function validateAddress(a) {
  if (!a || typeof a !== 'object') {
    throw new HttpError(400, 'Address is required');
  }
  return {
    label: str(a.label, 'Label', { max: 50, optional: true }),
    fullName: str(a.fullName, 'Full name', { max: 100 }),
    phone: str(a.phone, 'Phone', { min: 7, max: 30 }),
    line1: str(a.line1, 'Address line 1', { max: 190 }),
    line2: str(a.line2, 'Address line 2', { max: 190, optional: true }),
    city: str(a.city, 'City', { max: 100 }),
    region: str(a.region, 'County / state', { max: 100, optional: true }),
    postalCode: str(a.postalCode, 'Postal code', { max: 20, optional: true }),
    country: str(a.country, 'Country', { max: 100 }),
  };
}
