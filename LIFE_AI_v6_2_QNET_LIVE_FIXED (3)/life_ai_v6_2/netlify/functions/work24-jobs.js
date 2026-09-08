
function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,'i'));
  return m ? m[1].trim() : '';
}
function decodeXml(s){
  return String(s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
exports.handler = async (event) => {
  const key = process.env.WORK24_AUTH_KEY;
  if(!key) return {statusCode:503,headers:{'content-type':'application/json'},body:JSON.stringify({message:'고용24 인증키가 아직 설정되지 않았어요.'})};
  const keyword = (event.queryStringParameters?.keyword||'').trim();
  if(!keyword) return {statusCode:400,headers:{'content-type':'application/json'},body:JSON.stringify({message:'검색어가 필요해요.'})};
  const qs = new URLSearchParams({
    authKey:key, callTp:'L', returnType:'XML', startPage:'1', display:'20',
    keyword, sortOrderBy:'DESC'
  });
  const url = `https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?${qs}`;
  try{
    const r = await fetch(url);
    const xml = await r.text();
    if(!r.ok) throw new Error(`고용24 응답 오류 ${r.status}`);
    const blocks = xml.match(/<wanted>[\s\S]*?<\/wanted>/gi) || [];
    const items = blocks.map(b=>({
      wantedAuthNo:decodeXml(xmlText(b,'wantedAuthNo')),
      company:decodeXml(xmlText(b,'company')),
      title:decodeXml(xmlText(b,'title')),
      region:decodeXml(xmlText(b,'region')),
      career:decodeXml(xmlText(b,'career')),
      regDt:decodeXml(xmlText(b,'regDt')),
      closeDt:decodeXml(xmlText(b,'closeDt')),
      url:decodeXml(xmlText(b,'wantedInfoUrl') || xmlText(b,'wantedMobileInfoUrl')),
      infoSvc:decodeXml(xmlText(b,'infoSvc'))
    })).filter(x=>x.title);
    return {
      statusCode:200,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=600'},
      body:JSON.stringify({source:'고용노동부 고용24', keyword, items:items.slice(0,10)})
    };
  }catch(e){
    return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message:e.message||'고용24 호출에 실패했어요.'})};
  }
};
