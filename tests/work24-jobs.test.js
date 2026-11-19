const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require.resolve('../netlify/functions/work24-jobs');
function setup(xml,status=200){
  delete require.cache[path];
  process.env.WORK24_AUTH_KEY='test-key';
  global.fetch=async()=>({ok:status>=200&&status<300,status,text:async()=>xml});
  const raw=require(path).handler;
  // Calls look like they come from the app's own page unless a test passes its own headers.
  const handler=event=>raw({headers:{host:'app.example',referer:'https://app.example/index.html'},...event});
  handler.raw=raw;
  return handler;
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
test('reads fields that carry attributes and CDATA text (shared XML helper)',async()=>{
  const handler=setup('<wantedRoot><wanted><title lang="ko"><![CDATA[설비 &amp; 정비]]></title><company type="x">A</company></wanted></wantedRoot>');
  const result=await handler({queryStringParameters:{keyword:'설비'}});
  const {items}=JSON.parse(result.body);
  assert.equal(items[0].title,'설비 & 정비');
  assert.equal(items[0].company,'A');
});
test('rejects invalid keyword before requesting upstream',async()=>{
  const handler=setup('<wantedRoot/>');
  assert.equal((await handler({queryStringParameters:{keyword:' '}})).statusCode,400);
  assert.equal((await handler({queryStringParameters:{keyword:'a'.repeat(101)}})).statusCode,400);
});
test('calls that do not come from the same site are refused without requesting upstream',async()=>{
  let fetched=0;
  const handler=setup('<wantedRoot/>');
  global.fetch=async()=>{fetched++;return {ok:true,status:200,text:async()=>'<wantedRoot/>'};};
  const query={queryStringParameters:{keyword:'설비'}};
  assert.equal((await handler.raw(query)).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',origin:'https://evil.example'}})).statusCode,403);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',referer:'https://evil.example/app.example'}})).statusCode,403);
  assert.equal(fetched,0);
  assert.equal((await handler.raw({...query,headers:{host:'app.example',origin:'https://app.example'}})).statusCode,200);
});
test('HTML upstream error is reported as failure',async()=>{
  const handler=setup('<html><body>Service unavailable</body></html>');
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,502);
  const body=JSON.parse(result.body);
  assert.equal(body.message,'지금은 고용24에서 공고를 가져오지 못했어요. 잠시 뒤 다시 시도하거나 고용24 사이트에서 확인해 주세요.');
  assert.match(body.detail,/HTML/,'the technical cause is kept separately');
});
test('missing auth key returns 503 without calling upstream',async()=>{
  const handler=setup('<wantedRoot/>');
  delete process.env.WORK24_AUTH_KEY;
  let called=false;global.fetch=async()=>{called=true;return {ok:true,status:200,text:async()=>''};};
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,503);assert.match(JSON.parse(result.body).message,/인증키/);assert.equal(called,false);
});
test('errorMsg in XML is reported as 502 with the message',async()=>{
  const handler=setup('<result><errorMsg>인증키가 올바르지 않습니다 &amp; 확인</errorMsg></result>');
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,502);assert.match(JSON.parse(result.body).detail,/고용24: 인증키가 올바르지 않습니다 & 확인/,'the server message is kept in detail, the screen gets the short message');
});
test('upstream 500 status is reported as 502',async()=>{
  const handler=setup('<wantedRoot/>',500);
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,502);assert.match(JSON.parse(result.body).detail,/500/);
});
test('zero results is an empty list, not an error',async()=>{
  const handler=setup('<wantedRoot><total>0</total></wantedRoot>');
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,200);assert.deepEqual(JSON.parse(result.body).items,[]);
});
test('more than 10 results are cut to 10',async()=>{
  const xml='<wantedRoot>'+Array.from({length:15},(_,i)=>`<wanted><title>공고${i}</title><wantedInfoUrl>https://example.org/${i}</wantedInfoUrl></wanted>`).join('')+'</wantedRoot>';
  const handler=setup(xml);
  const result=await handler({queryStringParameters:{keyword:'정비'}});
  const {items}=JSON.parse(result.body);
  assert.equal(result.statusCode,200);assert.equal(items.length,10);assert.equal(items[0].title,'공고0');assert.equal(items[9].title,'공고9');
});
const sampleWanted=(n)=>`<wanted><wantedAuthNo>K${n}</wantedAuthNo><company><![CDATA[(주)에이&비 설비 ${n}]]></company><title><![CDATA[설비정비 & 안전관리 ${n}]]></title><region>서울 &amp; 경기</region><career>경력무관</career><regDt>2026-11-0${n%9}</regDt><closeDt>2026-12-31</closeDt><wantedInfoUrl><![CDATA[https://www.work24.go.kr/job?id=${n}&amp;type=a]]></wantedInfoUrl><infoSvc>VALIDATION</infoSvc></wanted>`;
test('decodes CDATA text and &amp; from a realistic response',async()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8"?><wantedRoot><total>1</total><startPage>1</startPage><display>20</display>${sampleWanted(1)}</wantedRoot>`;
  const result=await setup(xml)({queryStringParameters:{keyword:'설비'}});
  assert.equal(result.statusCode,200);
  const {items}=JSON.parse(result.body);
  assert.equal(items.length,1);
  assert.equal(items[0].title,'설비정비 & 안전관리 1');
  assert.equal(items[0].company,'(주)에이&비 설비 1');
  assert.equal(items[0].region,'서울 & 경기');
  assert.equal(items[0].url,'https://www.work24.go.kr/job?id=1&type=a');
  assert.equal(items[0].wantedAuthNo,'K1');
  assert.ok(!/CDATA|&amp;/.test(JSON.stringify(items)),'no leftover markup');
});
test('returns only the first 10 when the response has 15 items',async()=>{
  const xml=`<wantedRoot><total>15</total>${Array.from({length:15},(_,i)=>sampleWanted(i+1)).join('')}</wantedRoot>`;
  const result=await setup(xml)({queryStringParameters:{keyword:'설비'}});
  const {items}=JSON.parse(result.body);
  assert.equal(items.length,10);
  assert.equal(items[0].wantedAuthNo,'K1');
  assert.equal(items[9].wantedAuthNo,'K10');
});
test('drops items with an empty title before applying the 10-item limit',async()=>{
  const empty='<wanted><wantedAuthNo>EMPTY</wantedAuthNo><company>X</company><title></title></wanted>';
  const blank='<wanted><wantedAuthNo>BLANK</wantedAuthNo><title><![CDATA[   ]]></title></wanted>';
  const xml=`<wantedRoot>${empty}${blank}${Array.from({length:11},(_,i)=>sampleWanted(i+1)).join('')}</wantedRoot>`;
  const result=await setup(xml)({queryStringParameters:{keyword:'설비'}});
  const {items}=JSON.parse(result.body);
  assert.equal(items.length,10);
  assert.ok(items.every(x=>x.title&&x.wantedAuthNo!=='EMPTY'&&x.wantedAuthNo!=='BLANK'));
  assert.equal(items[0].wantedAuthNo,'K1');
});
