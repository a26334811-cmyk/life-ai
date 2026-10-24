const {text,safeUrl,reply,readText,failure}=require('./lib/job-data');
const cache=new Map();
function dateOf(value){const stamp=Number(value);return stamp>0&&Number.isFinite(stamp)&&Number.isFinite(new Date(stamp*1000).getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000)):'';}
exports.handler=async event=>{
  const key=process.env.SARAMIN_ACCESS_KEY;
  if(!key)return reply(503,{code:'NOT_CONFIGURED',message:'사람인 API 승인 및 연결을 기다리고 있어요. 블로그 새 글이나 외부 검색을 이용해 주세요.'});
  const keyword=(event.queryStringParameters?.keyword||'').trim();
  if(!keyword || keyword.length>120)return reply(400,{code:'INVALID_QUERY',message:'검색어를 1~120자로 입력해 주세요.'});
  if(cache.get(keyword)?.expires>Date.now())return reply(200,cache.get(keyword).data);
  try {
    const qs=new URLSearchParams({'access-key':key,keywords:keyword,count:'20',start:'0',sort:'pd',sr:'directhire'});
    const response=await fetch('https://oapi.saramin.co.kr/job-search?'+qs,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('UPSTREAM_ERROR');
    let data;try{data=JSON.parse(await readText(response));}catch{throw new Error('INVALID_RESPONSE');}
    if(data.code || data.result?.code)return reply(502,{code:'UPSTREAM_ERROR',message:'사람인 인증 또는 호출 한도를 확인해 주세요.'});
    if(!data.jobs || !Number.isFinite(Number(data.jobs.total)) || Number(data.jobs.total)<0 || (data.jobs.job!==undefined && !Array.isArray(data.jobs.job)))throw new Error('INVALID_RESPONSE');
    const jobs=data.jobs.job||[];
    if(Number(data.jobs.total)>0 && !jobs.length)throw new Error('INVALID_RESPONSE');
    const items=jobs.filter(x=>String(x.active)==='1').map(x=>({id:'saramin-'+x.id,title:text(x.position?.title),company:text(x.company?.detail?.name||x.company?.name),region:text(x.position?.location?.name),career:text(x.position?.['experience-level']?.name),regDt:dateOf(x['opening-timestamp']),closeDt:String(x['close-type']?.code)==='1'?dateOf(x['expiration-timestamp']):'',closeLabel:text(x['close-type']?.name),url:safeUrl(x.url),source:'사람인',kind:'job'})).filter(x=>x.title&&x.url);
    const result={source:'사람인',mode:'live',fetchedAt:new Date().toISOString(),items};
    if(cache.size>=100)cache.delete(cache.keys().next().value);
    cache.set(keyword,{expires:Date.now()+600000,data:result});
    return reply(200,result);
  }catch(error){return failure(error);}
};
