const {test}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../netlify/functions/work24-jobs').handler;

function restoreGlobals(t){
  const originalFetch=global.fetch;
  const originalKey=process.env.WORK24_AUTH_KEY;
  t.after(()=>{
    global.fetch=originalFetch;
    if(originalKey===undefined) delete process.env.WORK24_AUTH_KEY;
    else process.env.WORK24_AUTH_KEY=originalKey;
  });
}

test('maps a Work24 wanted XML item including CDATA and XML entities',async t=>{
  restoreGlobals(t);
  process.env.WORK24_AUTH_KEY='test-key';
  const xml='<wantedRoot><wanted><wantedAuthNo>W-123</wantedAuthNo><company><![CDATA[광양 &amp; 정비]]></company><title><![CDATA[설비 정비 &amp; 보전]]></title><region>전남 광양</region><career>경력무관</career><regDt>20261001</regDt><closeDt>20261031</closeDt><wantedInfoUrl>https://example.com/jobs/123</wantedInfoUrl><infoSvc>고용24</infoSvc></wanted></wantedRoot>';
  let requestedUrl;
  global.fetch=async url=>{requestedUrl=url;return {ok:true,text:async()=>xml};};

  const result=await handler({queryStringParameters:{keyword:'설비 정비'}});
  assert.equal(result.statusCode,200);
  assert.equal(new URL(requestedUrl).searchParams.get('authKey'),'test-key');
  const data=JSON.parse(result.body);
  assert.equal(data.source,'고용노동부 고용24');
  assert.equal(data.keyword,'설비 정비');
  assert.deepEqual(data.items,[{
    wantedAuthNo:'W-123',
    company:'광양 & 정비',
    title:'설비 정비 & 보전',
    region:'전남 광양',
    career:'경력무관',
    regDt:'20261001',
    closeDt:'20261031',
    url:'https://example.com/jobs/123',
    infoSvc:'고용24'
  }]);
});

test('returns an empty item list for a valid no-results XML response',async t=>{
  restoreGlobals(t);
  process.env.WORK24_AUTH_KEY='test-key';
  global.fetch=async()=>({ok:true,text:async()=>'<wantedRoot><total>0</total></wantedRoot>'});

  const result=await handler({queryStringParameters:{keyword:'희귀 검색어'}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(JSON.parse(result.body).items,[]);
});

test('reports missing key, upstream HTTP errors, and Work24 error XML',async t=>{
  restoreGlobals(t);
  let fetched=false;
  global.fetch=async()=>{fetched=true;return {ok:true,text:async()=>''};};
  delete process.env.WORK24_AUTH_KEY;
  const missingKey=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(missingKey.statusCode,503);
  assert.equal(fetched,false);

  process.env.WORK24_AUTH_KEY='test-key';
  global.fetch=async()=>({ok:false,status:503,text:async()=>'잠시 후 다시 시도'});
  const httpError=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(httpError.statusCode,502);
  assert.match(JSON.parse(httpError.body).message,/503/);

  global.fetch=async()=>({ok:true,text:async()=>'<response><errorMsg>인증키 오류</errorMsg></response>'});
  const xmlError=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(xmlError.statusCode,502);
  assert.match(JSON.parse(xmlError.body).message,/인증키 오류/);
});

test('parses wanted and field tags when XML attributes are present',async t=>{
  restoreGlobals(t);
  process.env.WORK24_AUTH_KEY='test-key';
  const xml='<wantedRoot version="1"><wanted seq="1"><wantedAuthNo>W-456</wantedAuthNo><company lang="ko"><![CDATA[광양 정비]]></company><title category="공고"><![CDATA[설비 정비원]]></title><region>전남 광양</region><wantedMobileInfoUrl>https://example.com/mobile/456</wantedMobileInfoUrl></wanted></wantedRoot>';
  global.fetch=async()=>({ok:true,text:async()=>xml});

  const result=await handler({queryStringParameters:{keyword:'정비'}});
  assert.equal(result.statusCode,200);
  const data=JSON.parse(result.body);
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].company,'광양 정비');
  assert.equal(data.items[0].title,'설비 정비원');
  assert.equal(data.items[0].url,'https://example.com/mobile/456');
});

test('parses the documented Work24 210L01 wanted response shape',async t=>{
  restoreGlobals(t);
  process.env.WORK24_AUTH_KEY='test-key';
  const xml='<wantedRoot><total>1</total><startPage>1</startPage><display>10</display><wanted><wantedAuthNo>W-789</wantedAuthNo><company>광양기계</company><busino>1234567890</busino><indTpNm>기계설비</indTpNm><title>기계 설비 유지보수</title><salTpNm>연봉</salTpNm><sal>5000만원</sal><minSal>5000</minSal><maxSal>6000</maxSal><region>전남 광양시</region><holidayTpNm>주 5일 근무</holidayTpNm><minEdubg>학력무관</minEdubg><maxEdubg>학력무관</maxEdubg><career>경력</career><regDt>20261015</regDt><closeDt>20261031</closeDt><infoSvc>VALIDATION</infoSvc><wantedInfoUrl>https://example.com/jobs/789</wantedInfoUrl><wantedMobileInfoUrl>https://m.example.com/jobs/789</wantedMobileInfoUrl><zipCd>57700</zipCd><strtnmCd>전남 광양시 산업로</strtnmCd><basicAddr>전남 광양시</basicAddr><detailAddr>산업단지</detailAddr><empTpCd>10</empTpCd><jobsCd>158</jobsCd><smodifyDtm>20261015120000</smodifyDtm></wanted></wantedRoot>';
  global.fetch=async()=>({ok:true,text:async()=>xml});

  const result=await handler({queryStringParameters:{keyword:'기계 설비'}});
  assert.equal(result.statusCode,200);
  assert.deepEqual(JSON.parse(result.body).items,[{
    wantedAuthNo:'W-789',
    company:'광양기계',
    title:'기계 설비 유지보수',
    region:'전남 광양시',
    career:'경력',
    regDt:'20261015',
    closeDt:'20261031',
    url:'https://example.com/jobs/789',
    infoSvc:'VALIDATION'
  }]);
});

test('returns a retryable Korean message when Work24 request times out',async t=>{
  restoreGlobals(t);
  process.env.WORK24_AUTH_KEY='test-key';
  global.fetch=async()=>{
    const error=new Error('The operation was aborted due to timeout');
    error.name='TimeoutError';
    throw error;
  };

  const result=await handler({queryStringParameters:{keyword:'기계 설비'}});
  assert.equal(result.statusCode,502);
  assert.match(JSON.parse(result.body).message,/응답 시간이 초과/);
  assert.match(JSON.parse(result.body).message,/다시 시도/);
});
