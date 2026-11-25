/* Runs by itself every 10 minutes (Netlify schedule, production site only) and sends the daily-record reminder to
   every phone whose time has come. A phone that is gone (the push service answers 404 or 410) is forgotten.
   The "sent today" date is written BEFORE sending so two overlapping runs cannot send twice, and put back if the
   push service had a temporary problem, so the next run tries again. */
import core from './lib/push-core.js';
import { openStore, nowMs, sendPush, json } from './lib/push-runtime.mjs';

export const config = { schedule: '*/10 * * * *' };

export default async () => {
  const store = await openStore();
  const now = nowMs();
  const today = core.koreaNow(now).date;
  const result = { checked: 0, sent: 0, removed: 0, failed: 0 };
  const listing = await store.list();
  for (const item of listing.blobs || []) {
    result.checked += 1;
    let record;
    try { record = await store.get(item.key, { type: 'json' }); } catch (e) { continue; }
    if (!record || !core.cleanSubscription({ endpoint: record.endpoint, keys: record.keys })) {
      await store.delete(item.key); result.removed += 1; continue;
    }
    if (!core.isDue(record, now)) continue;
    const previous = record.lastSent || '';
    await store.setJSON(item.key, { ...record, lastSent: today });
    try {
      await sendPush({ endpoint: record.endpoint, keys: record.keys }, core.buildPayload(record));
      result.sent += 1;
    } catch (e) {
      const status = Number(e && e.statusCode);
      if (status === 404 || status === 410) { await store.delete(item.key); result.removed += 1; }
      else { await store.setJSON(item.key, { ...record, lastSent: previous }); result.failed += 1; }
    }
  }
  return json(200, result);
};
