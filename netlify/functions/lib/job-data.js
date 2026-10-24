const { XMLParser, XMLValidator } = require('fast-xml-parser');
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });
function parseXml(xml, root) {
  if(typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('INVALID_RESPONSE');
  const data = parser.parse(xml);
  if(!data[root] || typeof data[root] !== 'object') throw new Error('INVALID_RESPONSE');
  return data[root];
}
function text(value) { return String(value && typeof value === 'object' ? value['#text'] ?? '' : value ?? '').trim(); }
function safeUrl(raw) { try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function reply(statusCode, data) { return {statusCode, headers:{'content-type':'application/json; charset=utf-8','cache-control':statusCode===200?'public, max-age=600':'no-store'},body:JSON.stringify(data)}; }
async function readText(response) {
  if(Number(response.headers?.get('content-length')) > 2000000) throw new Error('INVALID_RESPONSE');
  if(!response.body?.getReader) {const value=await response.text();if(Buffer.byteLength(value)>2000000)throw new Error('INVALID_RESPONSE');return value;}
  const reader=response.body.getReader(),parts=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000)throw new Error('INVALID_RESPONSE');parts.push(Buffer.from(value));}} finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(parts).toString('utf8');
}
function failure(error) {
  const code = ['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':error.message==='INVALID_RESPONSE'?'INVALID_RESPONSE':'UPSTREAM_ERROR';
  return reply(502,{code,message:code==='TIMEOUT'?'응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.':code==='INVALID_RESPONSE'?'제공처 응답을 읽지 못했어요. 원문에서 확인해 주세요.':'제공처 연결에 실패했어요. 잠시 후 다시 시도해 주세요.'});
}
module.exports={parseXml,text,safeUrl,reply,readText,failure};
