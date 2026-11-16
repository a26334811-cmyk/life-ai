/* Reads the PUBLIC summary of one job-posting page the user pasted (title, company, deadline when the page states it).
   It never returns the raw page. Safety rules, because this is a server fetching a user-supplied address:
   - only http/https on the default ports, never localhost or private/internal addresses (checked again after every redirect)
   - at most 3 redirects, 7 s per request, only the first 1.5 MB of HTML is read (the rest is dropped), HTML content types only
   - one page per call, nothing is stored
   Known limit: the host name is checked and then fetched, so a hostile DNS server that changes its answer between the two
   steps (DNS rebinding) is not fully covered. The function holds no secrets besides its own environment, and the reply
   contains only a short summary, never the page. */
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 1536 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 7000;
const USER_AGENT = 'life-ai-link-preview/1.0 (reads one page for its owner)';

/* ---------- address safety ---------- */
function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
      return isPrivateIp([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
    }
    return /^(fc|fd|fe[89ab])/.test(lower) || lower.startsWith('ff');
  }
  return true; // not an IP at all: treat as unsafe
}

async function assertPublicUrl(raw, lookup) {
  let url;
  try { url = new URL(raw); } catch (e) { throw userError('올바른 링크가 아니에요.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw userError('http 또는 https 링크만 읽을 수 있어요.');
  if (url.username || url.password) throw userError('아이디·비밀번호가 들어간 링크는 읽을 수 없어요.');
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== defaultPort) throw userError('이 링크는 읽을 수 없어요.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw userError('이 링크는 읽을 수 없어요.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw userError('이 링크는 읽을 수 없어요.');
    return url;
  }
  let addresses;
  try { addresses = await lookup(host, { all: true }); } catch (e) { throw userError('링크 주소를 찾지 못했어요.'); }
  if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) throw userError('이 링크는 읽을 수 없어요.');
  return url;
}

function userError(message, status) {
  const error = new Error(message);
  error.userMessage = message;
  error.status = status || 400;
  return error;
}

/* ---------- reading the page ---------- */
function charsetFrom(contentType, head) {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1].toLowerCase() : 'utf-8';
}

function decodeBytes(bytes, contentType) {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  let charset = charsetFrom(contentType, head);
  if (['ks_c_5601-1987', 'euckr', 'x-windows-949', 'cp949', 'ms949'].includes(charset)) charset = 'euc-kr';
  try { return new TextDecoder(charset).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
}

async function readLimited(response) {
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.length > MAX_BYTES ? buffer.subarray(0, MAX_BYTES) : buffer;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_BYTES) { try { await reader.cancel(); } catch (e) { /* ignore */ } break; }
  }
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= all.length) break;
    const part = chunk.subarray(0, all.length - offset);
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

async function fetchPage(rawUrl, { fetchImpl, lookupImpl }) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, lookupImpl);
    let response;
    try {
      response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ko,en;q=0.8' }
      });
    } catch (e) {
      throw userError('페이지가 응답하지 않아요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.', 504);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw userError('링크를 따라가지 못했어요.', 502);
      current = new URL(location, url).href;
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw userError('이 사이트는 자동으로 읽을 수 없게 막혀 있어요. 직접 입력해 주세요.', 502);
    }
    if (!response.ok) throw userError('페이지를 불러오지 못했어요. (' + response.status + ')', 502);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(type)) throw userError('웹 페이지가 아니라서 읽을 수 없어요.', 415);
    const bytes = await readLimited(response);
    return { html: decodeBytes(bytes, type), finalUrl: url.href };
  }
  throw userError('링크가 너무 여러 번 다른 곳으로 이동해요.', 502);
}

/* ---------- parsing ---------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => safeChar(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m));
}
function safeChar(code) {
  try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; } catch (e) { return ''; }
}
function plain(text, max) {
  return decodeEntities(String(text || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!name || name[1].toLowerCase() !== key) continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    if (content) return plain(content[1] !== undefined ? content[1] : content[2], 600);
  }
  return '';
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch (e) { /* ignore broken block */ }
  }
  return out;
}
function flattenLd(node, list) {
  if (Array.isArray(node)) node.forEach(n => flattenLd(n, list));
  else if (node && typeof node === 'object') {
    list.push(node);
    if (node['@graph']) flattenLd(node['@graph'], list);
  }
  return list;
}
function isJobPosting(node) {
  const type = node['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}
function text(value) {
  if (typeof value === 'string') return plain(value, 200);
  if (value && typeof value === 'object' && typeof value.name === 'string') return plain(value.name, 200);
  return '';
}
function isoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return '';
  const date = new Date(m[0] + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === m[0] ? m[0] : '';
}
function regionFrom(location) {
  const first = Array.isArray(location) ? location[0] : location;
  const address = first && first.address;
  if (!address) return '';
  if (typeof address === 'string') return plain(address, 100);
  return [address.addressRegion, address.addressLocality].map(x => plain(x, 40)).filter(Boolean).join(' ');
}

/* Company career sites (not job boards) usually name the employer in <meta name="author"> or the site publisher.
   That is a guess about the page owner, so it is used only when the same name also appears inside the posting title
   (after removing a trailing site name). A board such as "시설관리 - 사람인" therefore never yields "사람인". */
function inferCompany(html, nodes, title, siteName) {
  const candidates = [metaContent(html, 'author')];
  for (const node of nodes) {
    if (node && node.publisher) candidates.push(text(node.publisher));
    if (node && node['@type'] === 'Organization') candidates.push(text(node));
  }
  let bare = String(title || '');
  for (const sep of [' - ', ' | ', ' : ', ' · ', ' – ', ' — ']) {
    if (siteName && bare.endsWith(sep + siteName)) { bare = bare.slice(0, -(sep + siteName).length); break; }
  }
  for (const name of candidates) {
    if (name && name.length >= 2 && name !== siteName && bare.includes(name)) return name;
  }
  return '';
}

function parsePage(html, finalUrl) {
  const nodes = jsonLdBlocks(html).reduce((all, block) => flattenLd(block, all), []);
  const job = nodes.find(isJobPosting);
  const siteName = metaContent(html, 'og:site_name');
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const metaTitle = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || (titleTag ? plain(titleTag[1], 200) : '');
  const metaDescription = metaContent(html, 'og:description') || metaContent(html, 'description');
  if (job) {
    const title = text(job.title) || metaTitle;
    const stated = text(job.hiringOrganization);
    const inferred = stated ? '' : inferCompany(html, nodes, title, siteName);
    return {
      ok: true, source: 'jobposting', url: finalUrl, siteName,
      title,
      company: stated || inferred, companyInferred: Boolean(inferred),
      deadline: isoDate(job.validThrough),
      region: regionFrom(job.jobLocation),
      description: plain(job.description, 1500) || metaDescription
    };
  }
  const inferred = inferCompany(html, nodes, metaTitle, siteName);
  return {
    ok: true, source: 'meta', url: finalUrl, siteName,
    title: metaTitle, company: inferred, companyInferred: Boolean(inferred), deadline: '', region: '', description: metaDescription
  };
}

/* ---------- handler ---------- */
function json(status, body) {
  return { statusCode: status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

function createHandler(deps) {
  const fetchImpl = (deps && deps.fetchImpl) || fetch;
  const lookupImpl = (deps && deps.lookupImpl) || dns.lookup;
  return async function handler(event) {
    const raw = String((event.queryStringParameters && event.queryStringParameters.url) || '').trim();
    if (!raw || raw.length > 2000) return json(400, { ok: false, message: '공고 링크를 입력해 주세요.' });
    try {
      const { html, finalUrl } = await fetchPage(raw, { fetchImpl, lookupImpl });
      const result = parsePage(html, finalUrl);
      if (!result.title && !result.company && !result.deadline) {
        return json(200, { ...result, ok: false, message: '이 페이지에서는 공고 정보를 찾지 못했어요. 직접 입력해 주세요.' });
      }
      return json(200, result);
    } catch (e) {
      if (e.userMessage) return json(e.status || 400, { ok: false, message: e.userMessage });
      return json(502, { ok: false, message: '링크를 읽지 못했어요. 직접 입력해 주세요.' });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.parsePage = parsePage;
exports.isPrivateIp = isPrivateIp;
exports.assertPublicUrl = assertPublicUrl;
exports.decodeBytes = decodeBytes;
