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
  const raw=require(path).handler;
  // Calls look like they come from the app's own page unless a test passes its own headers.
  const handler=event=>raw({headers:{host:'app.example',referer:'https://app.example/index.html'},...event});
  handler.raw=raw;
  return handler;
}
const thisYear=String(new Date().getFullYear());
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
  assert.equal(result.statusCode,400,'a name that fits several qualifications is the user to pick one, not a server failure');
  const body=JSON.parse(result.body);
  assert.equal(body.needsPick,true);
  assert.match(body.message,/여러 종목/);
});
test('upstream repeating page is reported as incomplete',async()=>{
  const handler=setup(()=>`<response><totalCount>2</totalCount>${qual('1150','전기기사')}</response>`);
  const result=await handler({queryStringParameters:{mode:'search',q:'전기'}});
  assert.equal(result.statusCode,502);
});
test('selected code produces events and removes duplicate rounds',async()=>{
  const item=`<item><implYy>${thisYear}</implYy><description>정기 1회</description><docRegStartDt>${thisYear}0101</docRegStartDt><docRegEndDt>${thisYear}0105</docRegEndDt><docExamStartDt>${thisYear}0201</docExamStartDt></item>`;
  const handler=setup(()=>`<response><totalCount>2</totalCount>${item}${item}</response>`);
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:thisYear}});
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.rounds.length,1);
  assert.equal(data.items.length,2);
  assert.equal(data.items[0].startDate,`${thisYear}-01-01`);
});
test('dates that are not on the calendar are dropped from events',async()=>{
  const item='<item><implYy>2026</implYy><description>정기 1회</description><docRegStartDt>20260230</docRegStartDt><docRegEndDt>20260305</docRegEndDt><docExamStartDt>20261345</docExamStartDt><pracExamStartDt>20260420</pracExamStartDt><pracExamEndDt>20260431</pracExamEndDt></item>';
  const handler=setup(()=>`<response><totalCount>1</totalCount>${item}</response>`);
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}});
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.deepEqual(data.items.map(e=>e.type),['실기시험']);
  assert.equal(data.items[0].startDate,'2026-04-20');
  assert.equal(data.items[0].endDate,'2026-04-20','an impossible end date falls back to the start date');
});
test('dates that are not on the calendar are skipped',async()=>{
  const item='<item><implYy>2026</implYy><description>정기 1회</description>'
    +'<docRegStartDt>20260230</docRegStartDt><docRegEndDt>20260305</docRegEndDt>'   // 30 February start: whole event skipped
    +'<docExamStartDt>20261301</docExamStartDt><docExamEndDt>20261302</docExamEndDt>' // month 13: skipped
    +'<pracRegStartDt>20260410</pracRegStartDt><pracRegEndDt>20260431</pracRegEndDt>' // bad end: falls back to the start date
    +'<pracExamStartDt>20260229</pracExamStartDt>'                                   // 2026 is not a leap year
    +'<pracPassDt>20260520</pracPassDt></item>';
  const handler=setup(()=>`<response><totalCount>1</totalCount>${item}</response>`);
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}});
  assert.equal(result.statusCode,200);
  const events=JSON.parse(result.body).items;
  assert.deepEqual(events.map(e=>[e.label,e.startDate,e.endDate]),[
    ['실기원서접수','2026-04-10','2026-04-10'],
    ['최종합격발표','2026-05-20','2026-05-20']
  ]);
});
test('invalid year and missing service key fail clearly',async()=>{
  const handler=setup(()=>{throw Error('must not fetch');});
  assert.equal((await handler({queryStringParameters:{name:'전기기사',year:'x'}})).statusCode,400);
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  assert.equal((await handler({queryStringParameters:{name:'전기기사'}})).statusCode,503);
});

test('too-long names and search words are refused before any lookup, and errors carry a content type',async()=>{
  const handler=setup(()=>{throw Error('must not fetch');});
  const long='가'.repeat(51);
  const byName=await handler({queryStringParameters:{name:long}});
  assert.equal(byName.statusCode,400);
  assert.match(byName.headers['content-type'],/application\/json/);
  assert.ok(!byName.body.includes(long),'the long text is not echoed back');
  const bySearch=await handler({queryStringParameters:{mode:'search',q:long}});
  assert.equal(bySearch.statusCode,400);
  assert.match(bySearch.body,/50자/);
  const badYear=await handler({queryStringParameters:{name:'전기기사',year:'x'}});
  assert.match(badYear.headers['content-type'],/application\/json/);
  const ok=await setup(()=>'<response><body><items></items></body></response>')({queryStringParameters:{mode:'search',q:'가'.repeat(50)}});
  assert.notEqual(ok.statusCode,400,'exactly 50 characters is still accepted');
});

test('Q-Net qualification endpoint rejects HTML error pages',async()=>{
  const handler=setup(()=>'<html><body>Gateway unavailable</body></html>');
  const result=await handler({queryStringParameters:{mode:'search',q:'설비보전'}});
  assert.equal(result.statusCode,502);
  const body=JSON.parse(result.body);
  assert.match(body.message,/Q-Net에서 자격증 목록을 가져오지 못했어요.*잠시 뒤 다시/);
  assert.doesNotMatch(body.message,/HTML|인증키|API/,'the screen text has no developer words');
  assert.match(body.detail,/HTML/,'the technical cause is kept separately');
});
test('Q-Net schedule endpoint rejects HTML error pages',async()=>{
  const handler=setup(()=>'<html><body>Gateway unavailable</body></html>');
  const result=await handler({queryStringParameters:{name:'전기기사',code:'1150',year:thisYear}});
  assert.equal(result.statusCode,502);
  const body=JSON.parse(result.body);
  assert.equal(body.message,'지금은 Q-Net에서 일정을 가져오지 못했어요. 잠시 뒤 다시 시도하거나 Q-Net 사이트에서 확인해 주세요.');
  assert.match(body.detail,/HTML/);
});
test('Q-Net HTTP errors and network failures also get the short screen message',async()=>{
  delete require.cache[path];
  process.env.DATA_GO_KR_SERVICE_KEY='test';
  global.fetch=async()=>({ok:false,status:500,text:async()=>'boom'});
  let handler=require(path).handler;
  let body=JSON.parse((await handler({headers:{host:'app.example',referer:'https://app.example/'},queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}})).body);
  assert.match(body.message,/잠시 뒤 다시 시도/);
  assert.doesNotMatch(body.message,/500/);
  assert.match(body.detail,/500/);
  delete require.cache[path];
  global.fetch=async()=>{throw new TypeError('fetch failed');};
  handler=require(path).handler;
  body=JSON.parse((await handler({headers:{host:'app.example',referer:'https://app.example/'},queryStringParameters:{name:'전기기사',code:'1150',year:'2026'}})).body);
  assert.match(body.message,/잠시 뒤 다시 시도/);
  assert.doesNotMatch(body.message,/fetch failed/);
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
test('HTTP 500 from the exam servers returns 502 with a short message and the status number in detail',async()=>{
  const detailOf=async(handler,query)=>{const r=await handler(query);assert.equal(r.statusCode,502);return JSON.parse(r.body);};
  const schedule=await detailOf(setup(()=>({status:500,body:'Internal Server Error'})),scheduleQuery);
  assert.match(schedule.message,/지금은 Q-Net에서 일정을 가져오지 못했어요/);
  assert.match(schedule.detail,/오류 500/);
  const search=await detailOf(setup(()=>({status:500,body:''})),searchQuery);
  assert.match(search.message,/자격증 목록을 가져오지 못했어요/);
  assert.match(search.detail,/오류 500/);
});
test('a failed HTTP answer that carries a key error still gives the key message',async()=>{
  const message=await failure(setup(()=>({status:401,body:errorXml('30','SERVICE_KEY_IS_NOT_REGISTERED_ERROR')})),scheduleQuery);
  assert.match(message,/인증키를 확인해 주세요/);
});

test('after page 1 the remaining qualification pages are requested at the same time',async()=>{
  const handler=setup(()=>'');
  let inFlight=0,maxInFlight=0;
  const requested=[];
  global.fetch=async(url)=>{
    const page=Number(new URL(url).searchParams.get('pageNo'));
    requested.push(page);
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    await new Promise(r=>setTimeout(r,20));
    inFlight--;
    const first=(page-1)*2;
    return {ok:true,text:async()=>`<response><totalCount>6</totalCount>${qual(String(1000+first),'종목'+first)}${qual(String(1001+first),'종목'+(first+1))}</response>`};
  };
  const result=await handler({queryStringParameters:{mode:'search',q:'종목'}});
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).loadedCount,6);
  assert.equal(requested[0],1,'page 1 first');
  assert.deepEqual([...requested].sort(),[1,2,3]);
  assert.equal(maxInFlight,2,'pages 2 and 3 were in flight together');
});

test('calls that do not come from the same site are refused before the key is used',async()=>{
  let fetched=0;
  const handler=setup(()=>{fetched++;return `<response><totalCount>1</totalCount>${qual('1150','전기기사')}</response>`;});
  const query={queryStringParameters:{mode:'search',q:'전기'}};
  assert.equal((await handler.raw(query)).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example'}})).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',origin:'https://evil.example'}})).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',referer:'https://app.example.evil.com/'}})).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',origin:'null'}})).statusCode,403);
  assert.equal(fetched,0);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',origin:'https://app.example'}})).statusCode,200);
});

test('only last year, this year and next year are accepted',async()=>{
  const handler=setup(()=>'<response><totalCount>0</totalCount></response>');
  const year=Number(thisYear);
  for(const y of [year-1,year,year+1]) assert.notEqual((await handler({queryStringParameters:{name:'전기기사',code:'1150',year:String(y)}})).statusCode,400);
  for(const y of [year-2,year+2,2000,2099]) assert.equal((await handler({queryStringParameters:{name:'전기기사',code:'1150',year:String(y)}})).statusCode,400);
});
