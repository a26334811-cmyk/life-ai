function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`,'i'));
  return m ? m[1].replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'').trim() : '';
}
function decodeXml(s){
  return String(s||'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function normalizeServiceKey(raw){
  try { return decodeURIComponent(raw); } catch { return raw; }
}
function toIsoDate(s){
  const m=String(s||'').match(/^(20\d{2})[.\/-]?(\d{2})[.\/-]?(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function scheduleEvents(block){
  const fields=[
    ['필기원서접수','docRegStartDt','docRegEndDt'],
    ['필기시험','docExamStartDt','docExamEndDt'],
    ['필기합격발표','docPassDt','docPassDt'],
    ['실기원서접수','pracRegStartDt','pracRegEndDt'],
    ['실기시험','pracExamStartDt','pracExamEndDt'],
    ['최종합격발표','pracPassDt','pracPassDt']
  ];
  return fields.flatMap(([label,startTag,endTag])=>{
    const startDate=toIsoDate(xmlText(block,startTag));
    if(!startDate) return [];
    const endDate=toIsoDate(xmlText(block,endTag))||startDate;
    return [{type:label,label,startDate,endDate,raw:startDate===endDate?startDate:`${startDate} ~ ${endDate}`}];
  });
}
async function findQualification(key, name){
  const base='http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList';
  const clean=s=>String(s||'').replace(/\s+/g,'').replace(/[()（）]/g,'').toLowerCase();
  const q=clean(name);
  // Q-Net lists only serviceKey as an input for this endpoint. Use its official
  // qualification code for the known item instead of relying on undocumented paging.
  if(q==='설비보전산업기사') return {code:'2035',name:'설비보전산업기사'};

  const qs=new URLSearchParams({serviceKey:key});
  const r=await fetch(`${base}?${qs.toString()}`);
  const xml=await r.text();
  if(!r.ok) throw new Error(`Q-Net 종목 조회 오류 ${r.status}`);
  const errCode=xmlText(xml,'returnReasonCode')||xmlText(xml,'resultCode');
  const errMsg=xmlText(xml,'returnAuthMsg')||xmlText(xml,'resultMsg');
  if(errCode&&!['00','0'].includes(errCode)) {
    throw new Error(`Q-Net 종목 목록 API: ${errMsg||errCode}`);
  }
  const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi)||[];
  if(!blocks.length) throw new Error('Q-Net 종목 목록 XML에서 항목을 읽지 못했어요.');
  const items=blocks.map(b=>({
    code:decodeXml(xmlText(b,'jmcd')),
    name:decodeXml(xmlText(b,'jmfldnm')),
    qualgbCd:decodeXml(xmlText(b,'qualgbcd')),
    qualgbNm:decodeXml(xmlText(b,'qualgbnm')),
    seriesNm:decodeXml(xmlText(b,'seriesnm')),
    fieldNm:decodeXml(xmlText(b,'mdobligfldnm'))
  })).filter(x=>x.code&&x.name);
  if(!items.length) throw new Error('Q-Net 종목 목록 XML의 종목코드 또는 종목명을 읽지 못했어요.');
  return items.find(x=>clean(x.name)===q)||
    items.find(x=>clean(x.name).includes(q))||
    items.find(x=>q.includes(clean(x.name)))||null;
}
async function fetchOfficialSchedule(key, qual, year){
  const base='https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList';
  const numOfRows=100;
  const rounds=[];
  let pageNo=1;
  let totalCount=null;
  while(pageNo<=20){
    const params=new URLSearchParams({
      serviceKey:key,numOfRows:String(numOfRows),pageNo:String(pageNo),
      dataFormat:'xml',implYy:String(year),qualgbCd:'T',jmCd:qual.code
    });
    const r=await fetch(`${base}?${params.toString()}`);
    const xml=await r.text();
    if(!r.ok) throw new Error(`Q-Net 시험일정 API 오류 ${r.status}`);
    const errCode=xmlText(xml,'returnReasonCode')||xmlText(xml,'resultCode');
    const errMsg=xmlText(xml,'returnAuthMsg')||xmlText(xml,'resultMsg');
    if(errCode&&!['00','0'].includes(errCode)) throw new Error(`Q-Net 시험일정 API: ${errMsg||errCode}`);
    const countText=xmlText(xml,'totalCount');
    const count=Number(countText);
    if(!countText||!Number.isFinite(count)||count<0) throw new Error('Q-Net 시험일정 XML의 전체 건수를 읽지 못했어요.');
    totalCount=count;
    const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi)||[];
    if(!blocks.length&&totalCount>0) throw new Error('Q-Net 시험일정 XML에서 항목을 읽지 못했어요.');
    for(const block of blocks){
      if(xmlText(block,'implYy')!==String(year)) continue;
      const round=xmlText(block,'description')||`${year}년 ${xmlText(block,'implSeq')}회`;
      rounds.push({round,events:scheduleEvents(block)});
    }
    if(!blocks.length||pageNo*numOfRows>=totalCount) break;
    pageNo++;
  }
  if(pageNo>20) throw new Error('Q-Net 시험일정 페이지 제한을 초과했어요.');
  return {url:base,rounds};
}
exports.handler=async(event)=>{
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY;
  if(!rawKey) return {statusCode:503,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'공공데이터포털 인증키가 아직 설정되지 않았어요.'})};
  const key=normalizeServiceKey(rawKey);
  const name=(event.queryStringParameters?.name||'').trim();
  const year=String(event.queryStringParameters?.year||new Date().getFullYear());
  if(!name) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'자격증 이름이 필요해요.'})};
  try{
    const qual=await findQualification(key,name);
    if(!qual) return {statusCode:404,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:`Q-Net 국가자격 종목 목록에서 “${name}”을 찾지 못했어요.`})};
    const official=await fetchOfficialSchedule(key,qual,year);
    const items=official.rounds.flatMap(r=>r.events.map(e=>({
      qualificationName:qual.name,qualificationCode:qual.code,round:r.round,
      type:e.type,label:e.label,startDate:e.startDate,endDate:e.endDate,raw:e.raw
    })));
    return {statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=3600'},body:JSON.stringify({
      source:'한국산업인력공단 국가자격 시험일정 조회 API',year,qualification:qual,
      totalCount:items.length,rounds:official.rounds,items,
      officialUrl:official.url,
      message:items.length?'Q-Net 공식 시험일정을 불러왔어요.':'해당 연도의 종목별 시험일정을 찾지 못했어요. 상시검정 종목은 별도 일정 연동이 필요할 수 있어요.'
    })};
  }catch(e){
    return {statusCode:502,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:e.message||'Q-Net 호출에 실패했어요.'})};
  }
};
