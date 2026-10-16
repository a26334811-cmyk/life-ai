function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`,'i'));
  if(!m) return '';
  return [...m[1].matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/gi)]
    .map(([,cdata,text])=>cdata!==undefined?cdata:decodeXml(text))
    .join('').trim();
}
function decodeXml(s){
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return String(s||'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(entity,reference)=>{
    if(reference[0]!=='#') return entities[reference.toLowerCase()]||entity;
    const codePoint=reference[1].toLowerCase()==='x'
      ? parseInt(reference.slice(2),16)
      : parseInt(reference.slice(1),10);
    if(codePoint>0x10ffff || (codePoint>=0xd800 && codePoint<=0xdfff)) return entity;
    return String.fromCodePoint(codePoint);
  });
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
    const r = await fetch(url,{signal:AbortSignal.timeout(8000)});
    const xml = await r.text();
    if(!r.ok) throw new Error(`고용24 응답 오류 ${r.status}`);
    const error=xmlText(xml,'errorMsg')||xmlText(xml,'message');
    if(error) throw new Error(`고용24: ${error}`);
    if(!/<(?:wantedRoot|wantedList|wanted|total)\b/i.test(xml)) throw new Error('고용24 응답을 읽지 못했어요. 인증 및 서비스 상태를 확인해 주세요.');
    const blocks = xml.match(/<wanted\b[^>]*>[\s\S]*?<\/wanted\s*>/gi) || [];
    const items = blocks.map(b=>({
      wantedAuthNo:xmlText(b,'wantedAuthNo'),
      company:xmlText(b,'company'),
      title:xmlText(b,'title'),
      region:xmlText(b,'region'),
      career:xmlText(b,'career'),
      regDt:xmlText(b,'regDt'),
      closeDt:xmlText(b,'closeDt'),
      url:xmlText(b,'wantedInfoUrl') || xmlText(b,'wantedMobileInfoUrl'),
      infoSvc:xmlText(b,'infoSvc')
    })).filter(x=>x.title);
    return {
      statusCode:200,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=600'},
      body:JSON.stringify({source:'고용노동부 고용24', keyword, items:items.slice(0,10)})
    };
  }catch(e){
    const message = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? '고용24 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.'
      : e.message||'고용24 호출에 실패했어요.';
    return {statusCode:502,headers:{'content-type':'application/json'},body:JSON.stringify({message})};
  }
};