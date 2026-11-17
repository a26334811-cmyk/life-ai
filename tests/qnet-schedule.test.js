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
test('종목 목록 요청(http)에는 인증키를 싣지 않고, 시험일정(https) 요청에만 싣는다',async()=>{
  const seen=[];
  const handler=setup(url=>{seen.push(url);return url.hostname==='openapi.q-net.or.kr'
    ?`<response><totalCount>1</totalCount>${qual('1150','전기기사')}</response>`
    :`<response><header><resultCode>00</resultCode></header><body><totalCount>0</totalCount></body></response>`;});
  await handler({queryStringParameters:{mode:'search',q:'전기'}});
  await handler({queryStringParameters:{name:'전기기사',year:'2026'}});
  const list=seen.filter(u=>u.hostname==='openapi.q-net.or.kr');
  const sched=seen.filter(u=>u.hostname==='apis.data.go.kr');
  assert.ok(list.length>=1&&sched.length>=1);
  for(const u of list) assert.equal(u.searchParams.has('serviceKey'),false);
  for(const u of sched){ assert.equal(u.protocol,'https:'); assert.equal(u.searchParams.has('serviceKey'),true); }
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

/* ---------- merging extra registrations and other years (#57) ---------- */
const exam=({year='2026',round='정기 1회',reg=['20260101','20260105'],written='20260201',pass='20260220'}={})=>
  `<item><implYy>${year}</implYy><description>${round}</description><docRegStartDt>${reg[0]}</docRegStartDt><docRegEndDt>${reg[1]}</docRegEndDt><docExamStartDt>${written}</docExamStartDt><docPassDt>${pass}</docPassDt></item>`;
const roundsFor=async items=>{
  const result=await setup(()=>`<response><totalCount>${items.length}</totalCount>${items.join('')}</response>`)(scheduleQuery);
  assert.equal(result.statusCode,200);
  return JSON.parse(result.body).rounds;
};
test('a second written-exam registration of the same round is added as an extra registration',async()=>{
  const rounds=await roundsFor([exam(),exam({reg:['20260110','20260112']})]);
  assert.equal(rounds.length,1,'one round, not two');
  const regs=rounds[0].events.filter(e=>e.type.includes('필기원서접수'));
  assert.equal(regs.length,2);
  assert.equal(regs[0].type,'필기원서접수');
  assert.equal(regs[0].startDate,'2026-01-01');
  assert.equal(regs[1].type,'추가필기원서접수');
  assert.equal(regs[1].label,'추가 필기원서접수');
  assert.equal(regs[1].startDate,'2026-01-10');
  assert.equal(regs[1].endDate,'2026-01-12');
  assert.equal(rounds[0].events.filter(e=>e.type==='필기시험').length,1,'exam day is not repeated');
});
test('the extra registration is kept whichever order the servers list the two items',async()=>{
  const rounds=await roundsFor([exam({reg:['20260110','20260112']}),exam()]);
  assert.equal(rounds.length,1);
  const regs=rounds[0].events.filter(e=>e.type.includes('필기원서접수'));
  assert.equal(regs.length,2);
  assert.deepEqual(regs.map(e=>e.startDate).sort(),['2026-01-01','2026-01-10']);
});
test('items from another year are left out',async()=>{
  const rounds=await roundsFor([exam(),exam({year:'2025',round:'정기 3회',reg:['20250601','20250605'],written:'20250701',pass:'20250720'})]);
  assert.equal(rounds.length,1);
  assert.equal(rounds[0].round,'정기 1회');
  const none=await roundsFor([exam({year:'2025'})]);
  assert.deepEqual(none,[]);
});
test('the same round name with a different exam day is not merged',async()=>{
  const rounds=await roundsFor([exam(),exam({reg:['20260301','20260305'],written:'20260401',pass:'20260420'})]);
  assert.equal(rounds.length,2);
  for(const r of rounds) assert.equal(r.events.filter(e=>e.type==='추가필기원서접수').length,0);
  assert.deepEqual(rounds.map(r=>r.events.find(e=>e.type==='필기시험').startDate),['2026-02-01','2026-04-01']);
});
test('different round names stay separate even when the dates are identical',async()=>{
  const rounds=await roundsFor([exam(),exam({round:'정기 2회'})]);
  assert.equal(rounds.length,2);
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
