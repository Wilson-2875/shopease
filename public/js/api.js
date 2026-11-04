// Small fetch wrapper. Cookies are sent automatically because the API is on the same origin.
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (form) {
    opts.body = form; // FormData: the browser sets the multipart header itself
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON response */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Something went wrong (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
