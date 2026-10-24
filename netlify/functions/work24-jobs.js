const {parseXml,text,reply,readText,failure,safeUrl}=require('./lib/job-data');
exports.handler=async event=>{
  const key=process.env.WORK24_AUTH_KEY;
  if(!key)return reply(503,{code:'NOT_CONFIGURED',message:'고용24 직접 연결은 승인된 기업회원 인증키가 필요해요. 블로그 새 글이나 외부 검색을 이용해 주세요.'});
  const keyword=(event.queryStringParameters?.keyword||'').trim();
  if(!keyword || keyword.length>120)return reply(400,{code:'INVALID_QUERY',message:'검색어를 1~120자로 입력해 주세요.'});
  try{
    const qs=new URLSearchParams({authKey:key,callTp:'L',returnType:'XML',startPage:'1',display:'20',keyword,sortOrderBy:'DESC'});
    const response=await fetch('https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?'+qs,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('UPSTREAM_ERROR');
    const root=parseXml(await readText(response),'wantedRoot');
    if(root.errorMsg||root.message)throw new Error('UPSTREAM_ERROR');
    if(root.total===undefined || !/^\d+$/.test(text(root.total)))throw new Error('INVALID_RESPONSE');
    const blocks=root.wanted===undefined?[]:Array.isArray(root.wanted)?root.wanted:[root.wanted];
    const items=blocks.map(x=>({id:text(x.wantedAuthNo),wantedAuthNo:text(x.wantedAuthNo),company:text(x.company),title:text(x.title),region:text(x.region),career:text(x.career),regDt:text(x.regDt),closeDt:text(x.closeDt),url:safeUrl(text(x.wantedInfoUrl)||text(x.wantedMobileInfoUrl)),source:'고용노동부 고용24',kind:'job'})).filter(x=>x.title);
    if(Number(root.total)>0&&!items.length)throw new Error('INVALID_RESPONSE');
    return reply(200,{source:'고용노동부 고용24',mode:'live',keyword,fetchedAt:new Date().toISOString(),items:items.slice(0,10)});
  }catch(error){return failure(error);}
};
