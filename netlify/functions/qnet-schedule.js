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
function cleanName(s){ return String(s||'').replace(/\s+/g,'').replace(/[()（）]/g,'').toLowerCase(); }
async function fetchWithTimeout(url){
  return fetch(url,{signal:AbortSignal.timeout(8000)});
}
let catalogCache;
let catalogPending;
async function listQualifications(key){
  if(catalogCache?.key===key&&catalogCache.expires>Date.now()) return catalogCache.value;
  if(catalogPending?.key===key) return catalogPending.promise;
  const promise=loadQualifications(key);
  catalogPending={key,promise};
  try{
    const value=await promise;
    catalogCache={key,value,expires:Date.now()+3600000};
    return value;
  }finally{ if(catalogPending?.promise===promise) catalogPending=null; }
}
async function loadQualifications(key){
  const base='http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList';
  const unique=new Map();
  let totalCount=0;
  for(let pageNo=1;pageNo<=30;pageNo++){
    const params=new URLSearchParams({serviceKey:key,pageNo:String(pageNo),numOfRows:'1000'});
    const r=await fetchWithTimeout(`${base}?${params}`);
    const xml=await r.text();
    if(!r.ok) throw new Error(`Q-Net 종목 조회 오류 ${r.status}`);
    const errCode=xmlText(xml,'returnReasonCode')||xmlText(xml,'resultCode');
    if(errCode&&!['00','0'].includes(errCode)) throw new Error(`Q-Net 종목 목록 API: ${xmlText(xml,'returnAuthMsg')||xmlText(xml,'resultMsg')||errCode}`);
    const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi)||[];
    if(!blocks.length) throw new Error('Q-Net 종목 목록을 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
    let added=0;
    for(const b of blocks){
      const code=decodeXml(xmlText(b,'jmcd')),name=decodeXml(xmlText(b,'jmfldnm'));
      const qualgbCd=decodeXml(xmlText(b,'qualgbcd'));
      if(code&&name&&!unique.has(code)){unique.set(code,{code,name,qualgbCd});added++;}
    }
    totalCount=Number(xmlText(xml,'totalCount'))||unique.size;
    if(unique.size>=totalCount) break;
    if(!added||pageNo===30) throw new Error('Q-Net 종목 목록의 일부만 조회됐어요. 다시 시도해 주세요.');
  }
  const items=[...unique.values()].filter(x=>x.qualgbCd==='T');
  if(!items.length) throw new Error('조회 가능한 국가기술자격 종목이 없어요.');
  return {items,totalCount};
}
async function findQualification(key,name){
  const q=cleanName(name);
  const {items}=await listQualifications(key);
  const exact=items.find(x=>cleanName(x.name)===q);
  if(exact) return exact;
  const matches=items.filter(x=>cleanName(x.name).includes(q));
  if(matches.length>1) throw new Error('여러 종목이 검색됐어요. 검색 목록에서 정확한 자격증을 선택해 주세요.');
  return matches[0]||null;
}
async function fetchOfficialSchedule(key, qual, year){
  const base='https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList';
  const numOfRows=50;
  const rounds=[];
  let pageNo=1;
  let totalCount=null;
  while(pageNo<=20){
    const params=new URLSearchParams({
      serviceKey:key,numOfRows:String(numOfRows),pageNo:String(pageNo),
      dataFormat:'xml',implYy:String(year),qualgbCd:'T',jmCd:qual.code
    });
    const r=await fetchWithTimeout(`${base}?${params.toString()}`);
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
  const grouped=new Map();
  for(const entry of rounds.sort((a,b)=>(a.events[0]?.startDate||'').localeCompare(b.events[0]?.startDate||''))){
    const key=entry.round+JSON.stringify(entry.events.filter(e=>e.type!=='필기원서접수'));
    const existing=grouped.get(key);
    if(!existing){ grouped.set(key,entry); continue; }
    const extra=entry.events.find(e=>e.type==='필기원서접수');
    if(extra&&!existing.events.some(e=>e.startDate===extra.startDate&&e.endDate===extra.endDate&&e.type===extra.type)) existing.events.push({...extra,type:'추가필기원서접수',label:'추가 필기원서접수'});
  }
  return {url:base,rounds:[...grouped.values()]};
}
exports.handler=async(event)=>{
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY;
  if(!rawKey) return {statusCode:503,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'공공데이터포털 인증키가 아직 설정되지 않았어요.'})};
  const key=normalizeServiceKey(rawKey);
  const name=(event.queryStringParameters?.name||'').trim();
  const year=String(event.queryStringParameters?.year||new Date().getFullYear());
  if(!/^20\d{2}$/.test(year)) return {statusCode:400,body:JSON.stringify({message:'시행년도를 올바르게 선택해 주세요.'})};
  if(event.queryStringParameters?.mode==='search'){
    const query=(event.queryStringParameters?.q||'').trim();
    if(query.length<2) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'검색어를 두 글자 이상 입력해 주세요.'})};
    try{
      const {items,totalCount}=await listQualifications(key);
      const matches=items.filter(x=>cleanName(x.name).includes(cleanName(query))).slice(0,30);
      return {statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=3600'},body:JSON.stringify({items:matches,loadedCount:items.length,totalCount})};
    }catch(e){ return {statusCode:502,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:e.message})}; }
  }

  if(!name&&event.queryStringParameters?.mode!=='search') return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'자격증 이름이 필요해요.'})};
  try{
    const selectedCode=String(event.queryStringParameters?.code||'');
    const qual=/^\d{4}$/.test(selectedCode)&&name?{code:selectedCode,name}:await findQualification(key,name);
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
