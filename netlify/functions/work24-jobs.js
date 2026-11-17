
const {xmlText,decodeXml}=require('./lib/xml');
/* The screen gets a short message; the technical cause goes to detail and the server log. */
const WORK24_FAIL='지금은 고용24에서 공고를 가져오지 못했어요. 잠시 뒤 다시 시도하거나 고용24 사이트에서 확인해 주세요.';
function upstreamError(detail){
  const e=new Error(detail);
  e.userMessage=WORK24_FAIL;
  return e;
}
function errorBody(e){
  if(e.userMessage||['TimeoutError','AbortError','TypeError'].includes(e.name)){
    console.error('[work24-jobs]',e.message);
    return {message:WORK24_FAIL,detail:e.message};
  }
  return {message:e.message||WORK24_FAIL};
}
exports.handler = async (event) => {
  const key = process.env.WORK24_AUTH_KEY;
  if(!key) return {statusCode:503,headers:{'content-type':'application/json'},body:JSON.stringify({message:'고용24 인증키가 아직 설정되지 않았어요.'})};
  const keyword = (event.queryStringParameters?.keyword||'').trim();
  if(!keyword || keyword.length>100) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'검색어는 1~100자로 입력해 주세요.'})};
  const qs = new URLSearchParams({
    authKey:key, callTp:'L', returnType:'XML', startPage:'1', display:'20',
    keyword, sortOrderBy:'DESC'
  });
  const url = `https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?${qs}`;
  try{
    const r = await fetch(url,{signal:AbortSignal.timeout(8000)});
    const xml = await r.text();
    if(!r.ok) throw upstreamError(`고용24 응답 오류 ${r.status}`);
    if(/<html[\s>]/i.test(xml)) throw upstreamError('고용24에서 XML 대신 HTML을 반환했어요. 인증 및 서비스 상태를 확인해 주세요.');
    const error=xmlText(xml,'errorMsg')||xmlText(xml,'message');
    if(error) throw upstreamError(`고용24: ${decodeXml(error)}`);
    if(!/<(?:wantedRoot|wantedList|wanted|total)\b/i.test(xml)) throw upstreamError('고용24 응답을 읽지 못했어요. 인증 및 서비스 상태를 확인해 주세요.');
    const blocks = xml.match(/<wanted(?:\s[^>]*)?>[\s\S]*?<\/wanted\s*>/gi) || [];
    const items = blocks.map(b=>({
      wantedAuthNo:decodeXml(xmlText(b,'wantedAuthNo')),
      company:decodeXml(xmlText(b,'company')),
      title:decodeXml(xmlText(b,'title')),
      region:decodeXml(xmlText(b,'region')),
      career:decodeXml(xmlText(b,'career')),
      regDt:decodeXml(xmlText(b,'regDt')),
      closeDt:decodeXml(xmlText(b,'closeDt')),
      url:(()=>{const candidate=decodeXml(xmlText(b,'wantedInfoUrl') || xmlText(b,'wantedMobileInfoUrl'));try{const parsed=new URL(candidate);return ['https:','http:'].includes(parsed.protocol)?candidate:'';}catch{return '';}})(),
      infoSvc:decodeXml(xmlText(b,'infoSvc'))
    })).filter(x=>x.title);
    return {
      statusCode:200,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=600'},
      body:JSON.stringify({source:'고용노동부 고용24', keyword, items:items.slice(0,10)})
    };
  }catch(e){
    return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify(errorBody(e))};
  }
};
