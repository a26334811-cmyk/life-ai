function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,'i'));
  return m ? m[1].trim() : '';
}
function decodeXml(s){
  return String(s||'')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'");
}
function normalizeServiceKey(raw){
  try { return decodeURIComponent(raw); } catch { return raw; }
}
async function findQualification(key, name){
  const base='http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList';
  const qs=new URLSearchParams({serviceKey:key});
  const r=await fetch(`${base}?${qs.toString()}`);
  const xml=await r.text();
  if(!r.ok) throw new Error(`Q-Net 종목 조회 오류 ${r.status}`);

  const errCode = xmlText(xml,'returnReasonCode') || xmlText(xml,'resultCode');
  const errMsg = xmlText(xml,'returnAuthMsg') || xmlText(xml,'resultMsg');
  if(errCode && !['00','0'].includes(errCode)){
    throw new Error(`Q-Net 종목 목록 API: ${errMsg || errCode}`);
  }

  const blocks=xml.match(/<item>[\s\S]*?<\/item>/gi)||[];
  const all=blocks.map(b=>({
    code:decodeXml(xmlText(b,'jmcd')),
    name:decodeXml(xmlText(b,'jmfldnm')),
    qualgbCd:decodeXml(xmlText(b,'qualgbcd')),
    qualgbNm:decodeXml(xmlText(b,'qualgbnm')),
    seriesNm:decodeXml(xmlText(b,'seriesnm')),
    fieldNm:decodeXml(xmlText(b,'mdobligfldnm'))
  })).filter(x=>x.code&&x.name);

  const clean=s=>String(s||'')
    .replace(/\s+/g,'')
    .replace(/[()（）]/g,'')
    .toLowerCase();
  const q=clean(name);

  return all.find(x=>clean(x.name)===q)
      || all.find(x=>clean(x.name).includes(q))
      || all.find(x=>q.includes(clean(x.name)));
}
exports.handler=async(event)=>{
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY;
  if(!rawKey){
    return {
      statusCode:503,
      headers:{'content-type':'application/json; charset=utf-8'},
      body:JSON.stringify({message:'공공데이터포털 인증키가 아직 설정되지 않았어요.'})
    };
  }

  const key=normalizeServiceKey(rawKey);
  const name=(event.queryStringParameters?.name||'').trim();
  const year=String(event.queryStringParameters?.year||new Date().getFullYear());
  if(!name){
    return {
      statusCode:400,
      headers:{'content-type':'application/json; charset=utf-8'},
      body:JSON.stringify({message:'자격증 이름이 필요해요.'})
    };
  }

  try{
    const qual=await findQualification(key,name);
    if(!qual){
      return {
        statusCode:404,
        headers:{'content-type':'application/json; charset=utf-8'},
        body:JSON.stringify({message:`Q-Net 국가자격 종목 목록에서 “${name}”을 찾지 못했어요. 종목 목록 API 활용신청 여부도 확인해주세요.`})
      };
    }

    const qs=new URLSearchParams({
      serviceKey:key,
      numOfRows:'50',
      pageNo:'1',
      dataFormat:'json',
      implYy:year,
    });
    // 진단 단계: 시행년도만으로 먼저 조회합니다.
    // 일부 Q-Net 일정 데이터는 qualgbCd/jmCd를 함께 주면 0건이 반환되는 경우가 있어,
    // 우선 전체 시행계획을 받은 뒤 응답 구조를 확인합니다.
    const url=`https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList?${qs.toString()}`;
    const r=await fetch(url);
    const text=await r.text();
    if(!r.ok) throw new Error(`Q-Net 일정 조회 오류 ${r.status}`);

    let data;
    try{
      data=JSON.parse(text);
    }catch{
      const resultCode=xmlText(text,'resultCode');
      const resultMsg=xmlText(text,'resultMsg');
      throw new Error(resultMsg || `Q-Net 일정 응답을 해석하지 못했어요${resultCode ? ` (${resultCode})` : ''}.`);
    }

    const header=data?.response?.header||{};
    if(header.resultCode && header.resultCode!=='00'){
      throw new Error(header.resultMsg || `Q-Net 오류 ${header.resultCode}`);
    }

    const body=data?.response?.body||{};

    // 공공데이터포털 JSON 응답은 body.items 자체가 배열로 오는 경우가 있음.
    // 일부 API/과거 응답처럼 { item: [...] } 구조도 함께 지원한다.
    let items = body?.items ?? [];
    if (items && !Array.isArray(items) && Object.prototype.hasOwnProperty.call(items, 'item')) {
      items = items.item ?? [];
    }
    if (!Array.isArray(items)) items = items ? [items] : [];

    return {
      statusCode:200,
      headers:{
        'content-type':'application/json; charset=utf-8',
        'cache-control':'public, max-age=3600'
      },
      body:JSON.stringify({
        source:'한국산업인력공단 Q-Net / 공공데이터포털',
        year,
        qualification:qual,
        totalCount:Number(body?.totalCount || items.length || 0),
        debug: {
          resultCode: header.resultCode ?? null,
          resultMsg: header.resultMsg ?? null,
          bodyKeys: Object.keys(body || {}),
          rawItemType: typeof body?.items,
          rawItemKeys: body?.items && !Array.isArray(body.items) ? Object.keys(body.items) : [],
          responseKeys: Object.keys(data || {}),
          responseType: Array.isArray(data) ? 'array' : typeof data,
          rawResponsePreview: String(text || '').slice(0,500),
          requested: {
            implYy: year,
            qualgbCd: qual.qualgbCd || null,
            jmCd: qual.code || null
          }
        },
        items
      })
    };
  }catch(e){
    return {
      statusCode:502,
      headers:{'content-type':'application/json; charset=utf-8'},
      body:JSON.stringify({message:e.message||'Q-Net 호출에 실패했어요.'})
    };
  }
};
