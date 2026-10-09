const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require.resolve('../netlify/functions/qnet-schedule');
function setup(responder){
  delete require.cache[path];
  process.env.DATA_GO_KR_SERVICE_KEY='test';
  global.fetch=async(url)=>({ok:true,text:async()=>responder(new URL(url))});
  return require(path).handler;
}
const qual=(code,name)=>`<item><jmcd>${code}</jmcd><jmfldnm>${name}</jmfldnm><qualgbcd>T</qualgbcd></item>`;
test('search reads all pages and normalizes spaces',async()=>{
  const pages=[];
  const handler=setup(url=>{pages.push(url.searchParams.get('pageNo'));return `<response><totalCount>2</totalCount>${url.searchParams.get('pageNo')==='1'?qual('1150','전기기사'):qual('2035','설비보전산업기사')}</response>`;});
  const result=await handler({queryStringParameters:{mode:'search',q:'설비 보전'}});
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).items[0].code,'2035');
  assert.deepEqual(pages,['1','2']);
  await handler({queryStringParameters:{mode:'search',q:'전기'}});
  assert.equal(pages.length,2);
});
test('partial names do not silently select a different exam level',async()=>{
  const handler=setup(()=>`<response><totalCount>2</totalCount>${qual('1150','전기기사')}${qual('2150','전기산업기사')}</response>`);
  const result=await handler({queryStringParameters:{name:'전기'}});
  assert.equal(result.statusCode,502);
  assert.match(JSON.parse(result.body).message,/여러 종목/);
});
test('upstream repeating page is reported as incomplete',async()=>{
  const handler=setup(()=>`<response><totalCount>2</totalCount>${qual('1150','전기기사')}</response>`);
  const result=await handler({queryStringParameters:{mode:'search',q:'전기'}});
  assert.equal(result.statusCode,502);
});
test('selected code produces events and removes duplicate rounds',async()=>{
  const item='<item><implYy>2026</implYy><description>정기 1회</description><docRegStartDt>20260101</docRegStartDt><docRegEndDt>20260105</docRegEndDt><docExamStartDt>20260201</docExamStartDt></item>';
  const handler=setup(()=>`<response><totalCount>2</totalCount>${item}${item}</response>`);
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}});
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.rounds.length,1);
  assert.equal(data.items.length,2);
  assert.equal(data.items[0].startDate,'2026-01-01');
});
test('invalid year and missing service key fail clearly',async()=>{
  const handler=setup(()=>{throw Error('must not fetch');});
  assert.equal((await handler({queryStringParameters:{name:'전기기사',year:'x'}})).statusCode,400);
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  assert.equal((await handler({queryStringParameters:{name:'전기기사'}})).statusCode,503);
});
