/* Rules shared by the two push functions (push-subscribe.mjs saves a phone, push-send.mjs sends the reminders).
   Everything here is plain code with no network and no clock of its own, so it can be tested alone.

   What the server keeps about one phone (and NOTHING else - never the text of a daily record):
   the phone's "push address" (endpoint + two keys), the reminder time, weekdays and message, the date of the last
   reminder sent, and the date of the last day the user wrote a record (so a day that is already written gets no reminder). */
const crypto = require('node:crypto');

const MAX_RECORDS = 300;          // phones kept at most: a stranger cannot fill the storage
const MAX_BODY_CHARS = 4096;      // a request bigger than this is refused
const CATCH_UP_HOURS = 3;         // a reminder is sent at most this long after its time (a missed run never sends a stale one)
const DEFAULT_TITLE = '오늘 하루는 어땠나요?';
const BODY_TEXT = '잠깐 시간을 내서 오늘을 적어 봐요. 한 줄이면 충분해요.';

/* The only places a push address may point to. The server will connect to the address it is given, so an
   arbitrary address would let anyone make this server call any site. These are the push services of the
   browsers/phones (Chrome and Android, Firefox, Safari/iPhone, Edge/Windows). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9.-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/
];

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const isTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 700) return false;
  let url;
  try { url = new URL(value); } catch (e) { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return false;
  return PUSH_HOSTS.some(rule => rule.test(url.hostname.toLowerCase()));
}

/* {endpoint, keys:{p256dh, auth}} exactly as the browser makes it, or null. */
function cleanSubscription(raw) {
  if (!isPlain(raw) || !validEndpoint(raw.endpoint) || !isPlain(raw.keys)) return null;
  const key = (value, max) => (typeof value === 'string' && value.length >= 8 && value.length <= max && /^[A-Za-z0-9_-]+={0,2}$/.test(value) ? value : '');
  const p256dh = key(raw.keys.p256dh, 200), auth = key(raw.keys.auth, 100);
  return p256dh && auth ? { endpoint: raw.endpoint, keys: { p256dh, auth } } : null;
}

/* The reminder settings the phone sends. Same rules as the app, so a broken value can never reach a record. */
function cleanSettings(raw) {
  const s = isPlain(raw) ? raw : {};
  return {
    remind: s.remind === true,
    time: isTime(s.time) ? s.time : '21:00',
    days: Array.isArray(s.days) ? [...new Set(s.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6],
    message: typeof s.message === 'string' ? s.message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) : '',
    lastNotified: isDate(s.lastNotified) ? s.lastNotified : ''
  };
}

/* An id for a phone that does not reveal its push address. */
function recordId(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
}

function koreaNow(ms) {
  const shifted = new Date(ms + 9 * 3600000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: shifted.getUTCDay() };
}

/* Builds the record to store. `old` is what was stored before (or null). The last-sent date only ever moves forward. */
function buildRecord(subscription, settings, doneDate, old, nowMs) {
  const clean = cleanSettings(settings);
  const lastSent = [old && isDate(old.lastSent) ? old.lastSent : '', clean.lastNotified].sort().pop();
  const stamp = new Date(nowMs).toISOString();
  return {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    remind: clean.remind,
    time: clean.time,
    days: clean.days,
    message: clean.message,
    lastSent,
    doneDate: isDate(doneDate) ? doneDate : '',
    createdAt: old && typeof old.createdAt === 'string' ? old.createdAt : stamp,
    updatedAt: stamp
  };
}

/* True when this phone should get today's reminder now: on, a chosen weekday, the time reached (but not more than
   CATCH_UP_HOURS ago), not sent yet today and the day is not already written. */
function isDue(record, nowMs) {
  if (!isPlain(record) || record.remind !== true || !isTime(record.time)) return false;
  const now = koreaNow(nowMs);
  if (!Array.isArray(record.days) || !record.days.includes(now.weekday)) return false;
  if (record.lastSent === now.date || record.doneDate === now.date) return false;
  const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const late = minutes(now.time) - minutes(record.time);
  return late >= 0 && late <= CATCH_UP_HOURS * 60;
}

/* What the phone shows. Never any record text. */
function buildPayload(record) {
  return { title: (record && record.message) || DEFAULT_TITLE, body: BODY_TEXT, screen: 'journal' };
}

module.exports = {
  MAX_RECORDS, MAX_BODY_CHARS, CATCH_UP_HOURS, DEFAULT_TITLE, BODY_TEXT, PUSH_HOSTS,
  validEndpoint, cleanSubscription, cleanSettings, recordId, koreaNow, buildRecord, isDue, buildPayload
};
