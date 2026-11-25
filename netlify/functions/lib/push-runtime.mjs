/* The two outside things the push functions need, in one place so tests can swap them for fakes:
   the storage (Netlify Blobs) and the sender (web-push). Nothing here runs until a function calls it. */
export const hooks = { store: null, send: null, now: null };

export function nowMs() {
  return hooks.now ? hooks.now() : Date.now();
}

/* Storage for the phones that asked for reminders. Strong consistency: a save is visible to the next read at once. */
export async function openStore() {
  if (hooks.store) return hooks.store;
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'journal-push', consistency: 'strong' });
}

/* Sends one push message. `subscription` is {endpoint, keys}; `payload` is the small object the phone shows. */
export async function sendPush(subscription, payload) {
  if (hooks.send) return hooks.send(subscription, payload);
  const mod = await import('web-push');
  const webpush = mod.default || mod;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw Object.assign(new Error('VAPID keys are not set'), { statusCode: 0, notReady: true });
  const subject = process.env.VAPID_SUBJECT || process.env.URL || 'https://calm-lebkuchen-1f8cec.netlify.app';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3 * 3600, urgency: 'normal', timeout: 10000 });
}

export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

/* Only pages of this same site may call: Origin or Referer must have the same host as the request. */
export function fromOwnSite(req) {
  const host = String(req.headers.get('host') || new URL(req.url).host || '').toLowerCase();
  const source = req.headers.get('origin') || req.headers.get('referer');
  if (!host || !source) return false;
  try { return new URL(source).host.toLowerCase() === host; } catch (e) { return false; }
}
