const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHandler,parsePage,isPrivateIp,assertPublicUrl,decodeBytes}=require('../netlify/functions/link-preview.js');

const SAME_ORIGIN={'sec-fetch-site':'same-origin'};
const publicLookup=async()=>[{address:'93.184.216.34',family:4}];
const page=(body,{status=200,type='text/html; charset=utf-8',headers={}}={})=>({
  status,ok:status>=200&&status<300,
  headers:{get:k=>({'content-type':type,...headers}[k.toLowerCase()]??null)},
  body:undefined,
  arrayBuffer:async()=>{const b=Buffer.isBuffer(body)?body:Buffer.from(body);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
});
const call=async(url,fetchImpl,lookupImpl=publicLookup)=>{
  const handler=createHandler({fetchImpl,lookupImpl});
  const res=await handler({queryStringParameters:{url},headers:SAME_ORIGIN});
  return {status:res.statusCode,body:JSON.parse(res.body)};
};

const JSON_LD=`<html><head><title>시설관리 신입 - 사람인</title>
<meta property="og:site_name" content="사람인">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"도시가스 시설관리 &amp; 안전 신입","hiringOrganization":{"@type":"Organization","name":"삼천리"},"validThrough":"2026-12-05T23:59","jobLocation":{"address":{"addressRegion":"경기","addressLocality":"수원시"}},"description":"<p>지원 마감 12월 5일까지</p>"}</script>
</head><body></body></html>`;

test('JobPosting structured data gives title, company, deadline and region',()=>{
  const r=parsePage(JSON_LD,'https://example.com/job/1');
  assert.equal(r.source,'jobposting');
  assert.equal(r.title,'도시가스 시설관리 & 안전 신입');
  assert.equal(r.company,'삼천리');
  assert.equal(r.deadline,'2026-12-05');
  assert.equal(r.region,'경기 수원시');
  assert.equal(r.siteName,'사람인');
  assert.match(r.description,/12월 5일/);
  assert.doesNotMatch(r.description,/<p>/);
});

test('JobPosting inside @graph and with a list type is found',()=>{
  const html='<script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"x"},{"@type":["Thing","JobPosting"],"title":"정비 신입","hiringOrganization":"한국가스공사","validThrough":"not a date"}]}</script>';
  const r=parsePage(html,'https://e.com');
  assert.equal(r.source,'jobposting');assert.equal(r.title,'정비 신입');assert.equal(r.deadline,'');
  assert.equal(r.company,'한국가스공사','a company the page states itself is used as written');
});

test('without structured data only the page title and description come back (company is never guessed)',()=>{
  const html='<html><head><title>  시설관리 신입 | 원티드 </title><meta property="og:title" content="삼천리 시설관리 신입 채용"><meta name="description" content="설명 &quot;문장&quot;"></head></html>';
  const r=parsePage(html,'https://e.com');
  assert.equal(r.source,'meta');assert.equal(r.title,'삼천리 시설관리 신입 채용');
  assert.equal(r.company,'');assert.equal(r.deadline,'');assert.equal(r.description,'설명 "문장"');
});

test('broken JSON-LD does not crash',()=>{
  const r=parsePage('<title>가나다</title><script type="application/ld+json">{oops</script>','https://e.com');
  assert.equal(r.title,'가나다');
});

test('EUC-KR pages are decoded using the declared charset',()=>{
  const bytes=Buffer.concat([Buffer.from('<title>','latin1'),Buffer.from([0xc3,0xa4,0xbf,0xeb]),Buffer.from('</title>','latin1')]);
  assert.match(decodeBytes(bytes,'text/html; charset=EUC-KR'),/채용/);
  const metaBytes=Buffer.concat([Buffer.from('<meta charset="euc-kr"><title>','latin1'),Buffer.from([0xc3,0xa4,0xbf,0xeb]),Buffer.from('</title>','latin1')]);
  assert.match(decodeBytes(metaBytes,'text/html'),/채용/);
});

test('private, loopback and metadata addresses are recognised',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','172.31.255.1','192.168.0.5','169.254.169.254','0.0.0.0','100.64.0.1','::1','::','fe80::1','fc00::1','fd12::1','::ffff:127.0.0.1','::ffff:7f00:1','224.0.0.1','not-an-ip'])assert.equal(isPrivateIp(ip),true,ip);
  for(const ip of ['93.184.216.34','8.8.8.8','172.32.0.1','2606:2800:220:1:248:1893:25c8:1946'])assert.equal(isPrivateIp(ip),false,ip);
});

test('unsafe links are refused before any request is made',async()=>{
  let fetched=0;
  const fetchImpl=async()=>{fetched++;return page('x');};
  for(const url of ['http://localhost/a','http://127.0.0.1/','http://[::1]/','http://169.254.169.254/latest/meta-data/','http://10.0.0.1/','https://user:pw@example.com/','ftp://example.com/','javascript:alert(1)','http://example.com:8080/','https://printer.local/','https://db.internal/','not a url']){
    const r=await call(url,fetchImpl);
    assert.equal(r.body.ok,false,url);assert.ok(r.status>=400,url);
  }
  assert.equal(fetched,0);
});

test('a public-looking name that resolves to a private address is refused',async()=>{
  let fetched=0;
  const r=await call('https://evil.example.com/',async()=>{fetched++;return page('x');},async()=>[{address:'93.184.216.34'},{address:'10.0.0.8'}]);
  assert.equal(r.body.ok,false);assert.equal(fetched,0);
  const nxdomain=await call('https://nope.example.com/',async()=>page('x'),async()=>{throw new Error('ENOTFOUND');});
  assert.match(nxdomain.body.message,/주소를 찾지 못했어요/);
});

test('a redirect to an internal address is refused and redirects are limited',async()=>{
  const toInternal=async url=>url.startsWith('https://a.example.com')?{status:302,ok:false,headers:{get:()=>'http://169.254.169.254/'}}:page('secret');
  const r=await call('https://a.example.com/x',toInternal);
  assert.equal(r.body.ok,false);
  const loop=async()=>({status:302,ok:false,headers:{get:()=>'https://a.example.com/again'}});
  const l=await call('https://a.example.com/x',loop);
  assert.match(l.body.message,/여러 번/);
});

test('a normal page is read through one safe redirect',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url==='https://short.example.com/x')return {status:301,ok:false,headers:{get:k=>k==='location'?'/job/1':null}};
    return page(JSON_LD);
  };
  const r=await call('https://short.example.com/x',fetchImpl);
  assert.equal(r.status,200);assert.equal(r.body.ok,true);
  assert.equal(r.body.company,'삼천리');assert.equal(r.body.url,'https://short.example.com/job/1');
  assert.equal(calls[0].options.redirect,'manual');
  assert.match(calls[0].options.headers['user-agent'],/life-ai-link-preview/);
});

test('blocked, missing, non-HTML and failing pages give friendly messages',async()=>{
  assert.match((await call('https://e.com/a',async()=>page('',{status:403}))).body.message,/막혀 있어요/);
  assert.match((await call('https://e.com/a',async()=>page('',{status:404}))).body.message,/불러오지 못했어요/);
  assert.match((await call('https://e.com/a',async()=>page('%PDF',{type:'application/pdf'}))).body.message,/웹 페이지가 아니라서/);
  const down=await call('https://e.com/a',async()=>{throw new Error('timeout');});
  assert.equal(down.status,504);
});

test('a page with nothing useful reports ok:false so the app can ask for manual entry',async()=>{
  const r=await call('https://e.com/a',async()=>page('<html><body>hello</body></html>'));
  assert.equal(r.body.ok,false);assert.match(r.body.message,/찾지 못했어요/);
});

test('missing or overlong url is rejected',async()=>{
  const handler=createHandler({fetchImpl:async()=>page('x'),lookupImpl:publicLookup});
  assert.equal((await handler({queryStringParameters:{},headers:SAME_ORIGIN})).statusCode,400);
  assert.equal((await handler({headers:SAME_ORIGIN})).statusCode,400);
  assert.equal((await handler({queryStringParameters:{url:'https://e.com/'+'a'.repeat(2100)},headers:SAME_ORIGIN})).statusCode,400);
});

test('requests that do not come from this app are refused before any page is read',async()=>{
  let fetched=0;
  const handler=createHandler({fetchImpl:async()=>{fetched++;return page('<html><head><title>t</title></head></html>');},lookupImpl:publicLookup});
  const q={url:'https://e.com/a'};
  const refused=[
    {queryStringParameters:q},
    {queryStringParameters:q,headers:{}},
    {queryStringParameters:q,headers:{'sec-fetch-site':'cross-site'}},
    {queryStringParameters:q,headers:{'sec-fetch-site':'same-site'}},
    {queryStringParameters:q,headers:{'Sec-Fetch-Site':'none'}},
    {queryStringParameters:q,headers:{host:'app.example',origin:'https://evil.example'}},
    {queryStringParameters:q,headers:{host:'app.example',referer:'https://evil.example/page'}},
    {queryStringParameters:q,headers:{host:'app.example'}}
  ];
  for(const event of refused) assert.equal((await handler(event)).statusCode,403,JSON.stringify(event.headers));
  assert.equal(fetched,0);
  const ok=[
    {queryStringParameters:q,headers:{'Sec-Fetch-Site':'same-origin'}},
    {queryStringParameters:q,headers:{host:'app.example',referer:'https://app.example/index.html'}},
    {queryStringParameters:q,headers:{'x-forwarded-host':'app.example',host:'internal',origin:'https://app.example'}}
  ];
  for(const event of ok) assert.equal((await handler(event)).statusCode,200,JSON.stringify(event.headers));
});

test('assertPublicUrl allows normal public links',async()=>{
  assert.equal((await assertPublicUrl('https://www.saramin.co.kr/zf_user/jobs/1',publicLookup)).hostname,'www.saramin.co.kr');
  assert.equal((await assertPublicUrl('http://example.com',publicLookup)).protocol,'http:');
});

test('a huge page is cut at 1.5 MB and the information at the top is still used',async()=>{
  const head=Buffer.from('<html><head><title>큰 페이지 공고</title></head><body>');
  const body=Buffer.concat([head,Buffer.alloc(3*1024*1024,97)]);
  const r=await call('https://e.com/big',async()=>page(body));
  assert.equal(r.body.ok,true);assert.equal(r.body.title,'큰 페이지 공고');
});

test('a streamed huge page stops reading after the limit',async()=>{
  let pulled=0;
  const chunk=new Uint8Array(256*1024).fill(97);
  const stream={getReader:()=>({read:async()=>{pulled++;return pulled>100?{done:true}:{done:false,value:pulled===1?Buffer.concat([Buffer.from('<title>스트림 공고</title>'),Buffer.from(chunk)]):chunk};},cancel:async()=>{}})};
  const response={status:200,ok:true,headers:{get:k=>k.toLowerCase()==='content-type'?'text/html; charset=utf-8':null},body:stream};
  const r=await call('https://e.com/stream',async()=>response);
  assert.equal(r.body.title,'스트림 공고');
  assert.ok(pulled<=8,'stopped early, read '+pulled+' chunks');
});

/* ---------- company career sites (real page shape: hyundai-steel.recruiter.co.kr) ---------- */
const CAREER_SITE=`<!DOCTYPE html><html lang="ko"><head><meta charSet="utf-8"/>
<meta name="description" content="현대제철에서 현대제철 포항공장 기술직(계약) 채용 지원자를 모집하고 있어요."/>
<meta name="author" content="현대제철"/>
<meta property="og:title" content="26.11 현대제철 포항공장 기술직(계약) 채용"/>
<meta property="og:description" content="Start your MOVE with Hyundai Steel"/>
<meta property="og:site_name" content="현대제철 채용"/>
<title>현대제철 채용 | 현대제철 포항공장 기술직(계약) 채용</title></head>
<body><script id="structuredData-script" type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"현대제철 채용","publisher":{"@type":"Organization","name":"현대제철"}}]}</script></body></html>`;

test('a company career site names the employer through its author tag, marked as inferred',()=>{
  const r=parsePage(CAREER_SITE,'https://hyundai-steel.recruiter.co.kr/career/jobs/133809');
  assert.equal(r.title,'26.11 현대제철 포항공장 기술직(계약) 채용');
  assert.equal(r.company,'현대제철');
  assert.equal(r.companyInferred,true);
  assert.equal(r.deadline,'','a deadline drawn by JavaScript is not in the HTML and is never invented');
});

test('a job board name is never taken as the employer',()=>{
  const board='<meta name="author" content="사람인"><meta property="og:site_name" content="사람인"><title>시설관리 신입 - 사람인</title>';
  const r=parsePage(board,'https://www.saramin.co.kr/x');
  assert.equal(r.company,'');assert.equal(r.companyInferred,false);
  const other='<meta name="author" content="어떤회사"><meta property="og:site_name" content="어떤 채용"><title>시설관리 신입 | 어떤 채용</title>';
  assert.equal(parsePage(other,'https://e.com').company,'','author that is not in the posting title is ignored');
});

test('a company stated by JobPosting data is used as written and not marked inferred',()=>{
  const r=parsePage(JSON_LD,'https://example.com/job/1');
  assert.equal(r.company,'삼천리');assert.equal(r.companyInferred,false);
});
