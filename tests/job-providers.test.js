const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const originalFetch=global.fetch,keys={WORK24_AUTH_KEY:process.env.WORK24_AUTH_KEY,SARAMIN_ACCESS_KEY:process.env.SARAMIN_ACCESS_KEY};
afterEach(()=>{global.fetch=originalFetch;for(const [key,value]of Object.entries(keys))if(value===undefined)delete process.env[key];else process.env[key]=value;});
function load(name){const path=require.resolve('../netlify/functions/'+name);delete require.cache[path];return require(path).handler;}
const event=keyword=>({queryStringParameters:{keyword}}),body=r=>JSON.parse(r.body),xml=text=>({ok:true,text:async()=>text});
const feed='<rss><channel><item><title><![CDATA[A&amp;B 생산직 [11월1일까지]]]></title><link>https://blog.naver.com/dodam852/123</link><pubDate>Sat, 24 Oct 2026 05:30:32 +0900</pubDate></item></channel></rss>';
test('RSS pinned fetch, cache, title filtering and no inferred deadlines',async()=>{
 let calls=0;global.fetch=async url=>{calls++;assert.equal(url,'https://rss.blog.naver.com/dodam852.xml');return xml(feed);};const handler=load('blog-jobs');
 const data=body(await handler(event('생산직')));assert.equal(data.items.length,1);assert.equal(data.items[0].closeDt,'');assert.equal(data.items[0].company,'');assert.equal(data.items[0].regDt,'');assert.match(data.items[0].publishedAt,/2026/);assert.equal(body(await handler(event('개발자'))).items.length,0);assert.equal(calls,1);
});
test('RSS malformed, HTML, DOCTYPE and unsafe links are errors',async()=>{
 for(const value of ['<rss><channel>','<html>login</html>','<!DOCTYPE rss><rss><channel/></rss>',feed.replace('https://blog.naver.com/dodam852/123','javascript:alert(1)')]){global.fetch=async()=>xml(value);assert.equal((await load('blog-jobs')(event(''))).statusCode,502);}
});
test('Work24 missing key, empty search, valid empty XML and truncated XML differ',async()=>{
 const handler=load('work24-jobs');delete process.env.WORK24_AUTH_KEY;assert.equal(body(await handler(event('정비'))).code,'NOT_CONFIGURED');process.env.WORK24_AUTH_KEY='test';assert.equal((await handler(event(''))).statusCode,400);
 global.fetch=async()=>xml('<wantedRoot><total>0</total></wantedRoot>');assert.equal((await handler(event('정비'))).statusCode,200);
 global.fetch=async()=>xml('<wantedRoot><total>1</total><wanted><title>정비</title>');assert.equal(body(await handler(event('정비'))).code,'INVALID_RESPONSE');
 global.fetch=async()=>xml('<wantedRoot><total>1</total><wanted><title><![CDATA[A&B]]></title><wantedInfoUrl>https://example.com</wantedInfoUrl></wanted></wantedRoot>');assert.equal(body(await handler(event('정비'))).items[0].title,'A&B');
});
const job={id:'1',active:1,url:'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1',company:{detail:{name:'테스트회사'}},position:{title:'정비',location:{name:'전남 > 여수시'},'experience-level':{name:'경력무관'}},'opening-timestamp':1792800000,'expiration-timestamp':1793404800,'close-type':{code:'1',name:'접수마감일'}};
test('Saramin uses keywords and normalizes official JSON; cache and rolling deadlines',async()=>{
 process.env.SARAMIN_ACCESS_KEY='test';let calls=0;global.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('keywords'),'정비');return xml(JSON.stringify({jobs:{total:'2',job:[job,{...job,id:'2','close-type':{code:'2',name:'채용시'}}]}}));};
 const handler=load('saramin-jobs'),data=body(await handler(event('정비')));assert.equal(data.items[0].company,'테스트회사');assert.match(data.items[0].closeDt,/^2026-\d\d-\d\d$/);assert.equal(data.items[1].closeDt,'');await handler(event('정비'));assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(data),/access-key/);
});
test('Saramin absent key, API errors, invalid JSON, malformed schema and timeout',async()=>{
 delete process.env.SARAMIN_ACCESS_KEY;assert.equal(body(await load('saramin-jobs')(event('정비'))).code,'NOT_CONFIGURED');process.env.SARAMIN_ACCESS_KEY='test';
 for(const value of ['<html/>',JSON.stringify({code:2,message:'secret'}),JSON.stringify({jobs:{total:'1'}})]){global.fetch=async()=>xml(value);const result=await load('saramin-jobs')(event('정비'));assert.equal(result.statusCode,502);assert.doesNotMatch(result.body,/secret/);}
 global.fetch=async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});};assert.equal(body(await load('saramin-jobs')(event('정비'))).code,'TIMEOUT');
});
