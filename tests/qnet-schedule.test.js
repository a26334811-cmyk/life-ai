const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require.resolve('../netlify/functions/qnet-schedule');
function setup(responder){
  delete require.cache[path];
  process.env.DATA_GO_KR_SERVICE_KEY='test';
  // A responder may return plain text (a normal 200 answer) or {status,body} to fake a failed HTTP answer.
  global.fetch=async(url)=>{
    const out=responder(new URL(url));
    if(out&&typeof out==='object') return {ok:out.status>=200&&out.status<300,status:out.status,text:async()=>out.body};
    return {ok:true,status:200,text:async()=>out};
  };
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

test('Q-Net qualification endpoint rejects HTML error pages',async()=>{
  const handler=setup(()=>'<html><body>Gateway unavailable</body></html>');
  const result=await handler({queryStringParameters:{mode:'search',q:'설비보전'}});
  assert.equal(result.statusCode,502);
  assert.match(JSON.parse(result.body).message,/HTML/);
});
test('Q-Net schedule endpoint rejects HTML error pages',async()=>{
  const handler=setup(()=>'<html><body>Gateway unavailable</body></html>');
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}});
  assert.equal(result.statusCode,502);
  assert.match(JSON.parse(result.body).message,/HTML/);
});

/* ---------- key, quota and server errors (#56) ---------- */
const errorXml=(code,msg)=>`<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${msg}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
const scheduleQuery={queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}};
const searchQuery={queryStringParameters:{mode:'search',q:'전기'}};
const failure=async(handler,query)=>{
  const result=await handler(query);
  assert.equal(result.statusCode,502);
  return JSON.parse(result.body).message;
};
test('expired or unregistered key codes become an easy Korean message (schedule and search)',async()=>{
  for(const [code,msg] of [['30','SERVICE_KEY_IS_NOT_REGISTERED_ERROR'],['31','DEADLINE_HAS_EXPIRED_ERROR'],['32','UNREGISTERED_IP_ERROR'],['20','SERVICE_ACCESS_DENIED_ERROR'],['21','TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR'],['33','UNSIGNED_CALL_ERROR']]){
    for(const query of [scheduleQuery,searchQuery]){
      const message=await failure(setup(()=>errorXml(code,msg)),query);
      assert.match(message,/인증키를 확인해 주세요/,code);
      assert.doesNotMatch(message,/[A-Z]{4,}_/,'no English error code is shown');
    }
  }
});
test('quota exceeded gets its own message',async()=>{
  for(const query of [scheduleQuery,searchQuery]){
    const message=await failure(setup(()=>errorXml('22','LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR')),query);
    assert.match(message,/횟수를 넘었어요/);
    assert.doesNotMatch(message,/LIMITED/);
  }
});
test('other error codes mention the code but not the English text',async()=>{
  const message=await failure(setup(()=>errorXml('99','SOMETHING_ELSE_ERROR')),scheduleQuery);
  assert.match(message,/코드 99/);
  assert.doesNotMatch(message,/SOMETHING_ELSE/);
  const viaResultCode=await failure(setup(()=>'<response><header><resultCode>05</resultCode><resultMsg>SERVICETIME_OUT</resultMsg></header></response>'),scheduleQuery);
  assert.match(viaResultCode,/코드 05/);
  assert.doesNotMatch(viaResultCode,/SERVICETIME_OUT/);
});
test('success codes 00 and 0 are not treated as errors',async()=>{
  for(const code of ['00','0']){
    const ok=`<response><header><resultCode>${code}</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><totalCount>0</totalCount></body></response>`;
    const result=await setup(()=>ok)(scheduleQuery);
    assert.equal(result.statusCode,200,code);
  }
});
test('HTTP 500 from the exam servers returns 502 with the status number',async()=>{
  const schedule=await failure(setup(()=>({status:500,body:'Internal Server Error'})),scheduleQuery);
  assert.match(schedule,/오류 500/);
  const search=await failure(setup(()=>({status:500,body:''})),searchQuery);
  assert.match(search,/오류 500/);
});
test('a failed HTTP answer that carries a key error still gives the key message',async()=>{
  const message=await failure(setup(()=>({status:401,body:errorXml('30','SERVICE_KEY_IS_NOT_REGISTERED_ERROR')})),scheduleQuery);
  assert.match(message,/인증키를 확인해 주세요/);
});
