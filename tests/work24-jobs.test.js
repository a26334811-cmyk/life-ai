const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require.resolve('../netlify/functions/work24-jobs');
function setup(xml,status=200){
  delete require.cache[path];
  process.env.WORK24_AUTH_KEY='test-key';
  global.fetch=async()=>({ok:status>=200&&status<300,status,text:async()=>xml});
  return require(path).handler;
}
test('parses jobs and blocks unsafe URLs',async()=>{
  const handler=setup('<wantedRoot><wanted><title>설비정비</title><company>A</company><wantedInfoUrl>javascript:alert(1)</wantedInfoUrl></wanted><wanted attr="x"><title>생산</title><wantedInfoUrl>https://example.org/job</wantedInfoUrl></wanted></wantedRoot>');
  const result=await handler({queryStringParameters:{keyword:'설비'}});
  assert.equal(result.statusCode,200);
  const {items}=JSON.parse(result.body);
  assert.equal(items.length,2);
  assert.equal(items[0].url,'');
  assert.equal(items[1].url,'https://example.org/job');
});
test('rejects invalid keyword before requesting upstream',async()=>{
  const handler=setup('<wantedRoot/>');
  assert.equal((await handler({queryStringParameters:{keyword:' '}})).statusCode,400);
  assert.equal((await handler({queryStringParameters:{keyword:'a'.repeat(101)}})).statusCode,400);
});
test('HTML upstream error is reported as failure',async()=>{
  const handler=setup('<html><body>Service unavailable</body></html>');
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,502);
  const body=JSON.parse(result.body);
  assert.equal(body.message,'지금은 고용24에서 공고를 가져오지 못했어요. 잠시 뒤 다시 시도하거나 고용24 사이트에서 확인해 주세요.');
  assert.match(body.detail,/HTML/,'the technical cause is kept separately');
});
