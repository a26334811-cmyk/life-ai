/* Lets the app ask for daily-record reminders that arrive even when the app is closed.
   GET  ?key          -> {publicKey}: the public half of the server's key pair, which the phone needs to subscribe.
   POST {action:'save', subscription, settings, doneDate}  -> remembers this phone and its reminder settings.
   POST {action:'remove', endpoint}                         -> forgets this phone.
   Only the app's own page may call it. The server keeps no text of any daily record (see lib/push-core.js). */
import core from './lib/push-core.js';
import { openStore, nowMs, json, fromOwnSite } from './lib/push-runtime.mjs';

export default async (req) => {
  if (!fromOwnSite(req)) return json(403, { message: '이 앱 화면에서만 사용할 수 있어요.' });
  try {
    if (req.method === 'GET') {
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      if (!publicKey) return json(503, { message: '알림 서버가 아직 준비되지 않았어요.' });
      return json(200, { publicKey });
    }
    if (req.method !== 'POST') return json(405, { message: '지원하지 않는 요청이에요.' });

    const text = await req.text();
    if (text.length > core.MAX_BODY_CHARS) return json(413, { message: '요청이 너무 커요.' });
    let body;
    try { body = JSON.parse(text); } catch (e) { return json(400, { message: '요청을 읽지 못했어요.' }); }
    if (!body || typeof body !== 'object') return json(400, { message: '요청을 읽지 못했어요.' });

    const store = await openStore();
    if (body.action === 'remove') {
      if (!core.validEndpoint(body.endpoint)) return json(400, { message: '알림 주소가 올바르지 않아요.' });
      await store.delete(core.recordId(body.endpoint));
      return json(200, { ok: true });
    }
    if (body.action !== 'save') return json(400, { message: '지원하지 않는 요청이에요.' });

    const subscription = core.cleanSubscription(body.subscription);
    if (!subscription) return json(400, { message: '알림 주소가 올바르지 않아요.' });
    const id = core.recordId(subscription.endpoint);
    const old = await store.get(id, { type: 'json' });
    if (!old) {
      const listing = await store.list();
      if ((listing.blobs || []).length >= core.MAX_RECORDS) return json(429, { message: '지금은 새 알림을 더 받을 수 없어요.' });
    }
    const record = core.buildRecord(subscription, body.settings, body.doneDate, old, nowMs());
    await store.setJSON(id, record);
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { message: '알림 설정을 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.' });
  }
};
