const {xmlText,decodeXml}=require('./lib/xml');
function normalizeServiceKey(raw){
  try { return decodeURIComponent(raw); } catch { return raw; }
}
// data.go.kr answers key and quota problems with an XML error code and an English message. Show plain Korean instead.
const KEY_ERROR_CODES=['20','21','30','31','32','33'];
function apiErrorFromXml(xml,label){
  const code=xmlText(xml,'returnReasonCode')||xmlText(xml,'resultCode');
  if(!code||['00','0'].includes(code)) return null;
  if(KEY_ERROR_CODES.includes(code)) return new Error('인증키를 확인해 주세요. 공공데이터포털 인증키가 만료됐거나 등록되지 않았을 수 있어요.');
  if(code==='22') return new Error('오늘 조회할 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요.');
  return new Error(`${label} 응답에 문제가 있어요(코드 ${code}). 잠시 후 다시 시도해 주세요.`);
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
/* Technical failures carry a short message for the screen (userMessage); the technical cause stays in detail and the server log. */
const SCHEDULE_FAIL='지금은 Q-Net에서 일정을 가져오지 못했어요. 잠시 뒤 다시 시도하거나 Q-Net 사이트에서 확인해 주세요.';
const LIST_FAIL='지금은 Q-Net에서 자격증 목록을 가져오지 못했어요. 잠시 뒤 다시 시도하거나 Q-Net 사이트에서 확인해 주세요.';
function upstreamError(detail,userMessage){
  const e=new Error(detail);
  e.userMessage=userMessage;
  return e;
}
function errorBody(e,fallback){
  if(e.userMessage||['TimeoutError','AbortError','TypeError'].includes(e.name)){
    console.error('[qnet-schedule]',e.message);
    return {message:e.userMessage||fallback,detail:e.message};
  }
  return {message:e.message||fallback};
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
  const promise=loadQualifications();
  catalogPending={key,promise};
  try{
    const value=await promise;
    catalogCache={key,value,expires:Date.now()+3600000};
    return value;
  }finally{ if(catalogPending?.promise===promise) catalogPending=null; }
}
async function loadQualifications(){
  // 이 종목 목록 서버는 https(443)가 닫혀 있어 http로만 부를 수 있다. 인증키를 검사하지도 않으므로(2026-11-17 확인:
  // 키가 없거나 틀려도 같은 목록을 준다) 암호화 안 된 주소에 키가 실려 가지 않도록 키를 보내지 않는다.
  const base='http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList';
  const unique=new Map();
  const readPage=async pageNo=>{
    const params=new URLSearchParams({pageNo:String(pageNo),numOfRows:'1000'});
    const r=await fetchWithTimeout(`${base}?${params}`);
    const xml=await r.text();
    if(!r.ok) throw apiErrorFromXml(xml,'Q-Net 종목 목록')||upstreamError(`Q-Net 종목 조회 오류 ${r.status}`,LIST_FAIL);
    if(/<html[\s>]/i.test(xml)) throw upstreamError('Q-Net 종목 목록 API가 HTML을 반환했어요. 인증키 또는 서비스 상태를 확인해 주세요.',LIST_FAIL);
    const apiError=apiErrorFromXml(xml,'Q-Net 종목 목록');
    if(apiError) throw apiError;
    const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi)||[];
    if(!blocks.length) throw new Error('Q-Net 종목 목록을 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
    return {blocks,total:Number(xmlText(xml,'totalCount'))};
  };
  const addPage=blocks=>{
    for(const b of blocks){
      const code=decodeXml(xmlText(b,'jmcd')),name=decodeXml(xmlText(b,'jmfldnm'));
      const qualgbCd=decodeXml(xmlText(b,'qualgbcd'));
      if(code&&name&&!unique.has(code)) unique.set(code,{code,name,qualgbCd});
    }
  };
  // Page 1 tells us the total count; the remaining pages are then requested at the same time.
  const first=await readPage(1);
  addPage(first.blocks);
  const totalCount=first.total||unique.size;
  if(unique.size<totalCount){
    const pageCount=Math.ceil(totalCount/first.blocks.length);
    if(pageCount>30) throw new Error('Q-Net 종목 목록의 일부만 조회됐어요. 다시 시도해 주세요.');
    const rest=await Promise.all(Array.from({length:pageCount-1},(_,i)=>readPage(i+2)));
    for(const page of rest) addPage(page.blocks);
    if(unique.size<totalCount) throw new Error('Q-Net 종목 목록의 일부만 조회됐어요. 다시 시도해 주세요.');
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
    if(!r.ok) throw apiErrorFromXml(xml,'Q-Net 시험일정')||upstreamError(`Q-Net 시험일정 API 오류 ${r.status}`,SCHEDULE_FAIL);
    if(/<html[\s>]/i.test(xml)) throw upstreamError('Q-Net 시험일정 API가 HTML을 반환했어요. 인증키 또는 서비스 상태를 확인해 주세요.',SCHEDULE_FAIL);
    const apiError=apiErrorFromXml(xml,'Q-Net 시험일정');
    if(apiError) throw apiError;
    const countText=xmlText(xml,'totalCount');
    const count=Number(countText);
    if(!countText||!Number.isFinite(count)||count<0) throw upstreamError('Q-Net 시험일정 XML의 전체 건수를 읽지 못했어요.',SCHEDULE_FAIL);
    totalCount=count;
    const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi)||[];
    if(!blocks.length&&totalCount>0) throw upstreamError('Q-Net 시험일정 XML에서 항목을 읽지 못했어요.',SCHEDULE_FAIL);
    for(const block of blocks){
      if(xmlText(block,'implYy')!==String(year)) continue;
      const round=xmlText(block,'description')||`${year}년 ${xmlText(block,'implSeq')}회`;
      rounds.push({round,events:scheduleEvents(block)});
    }
    if(!blocks.length||pageNo*numOfRows>=totalCount) break;
    pageNo++;
  }
  if(pageNo>20) throw upstreamError('Q-Net 시험일정 페이지 제한을 초과했어요.',SCHEDULE_FAIL);
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
/* Only pages of this same site may call this function: Origin or Referer must have the same host as the request. */
function fromOwnSite(event){
  const headers=event.headers||{};
  const host=String(headers.host||'').toLowerCase();
  const source=headers.origin||headers.referer;
  if(!host||!source) return false;
  try{ return new URL(source).host.toLowerCase()===host; }catch{ return false; }
}
// The year picker offers last year, this year and next year (Korea time).
function allowedYears(){
  const current=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
  return [current-1,current,current+1];
}
exports.handler=async(event)=>{
  if(!fromOwnSite(event)) return {statusCode:403,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'이 앱 화면에서만 사용할 수 있어요.'})};
  const rawKey=process.env.DATA_GO_KR_SERVICE_KEY;
  if(!rawKey) return {statusCode:503,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'공공데이터포털 인증키가 아직 설정되지 않았어요.'})};
  const key=normalizeServiceKey(rawKey);
  const name=(event.queryStringParameters?.name||'').trim();
  const year=String(event.queryStringParameters?.year||allowedYears()[1]);
  if(!/^20\d{2}$/.test(year)||!allowedYears().includes(Number(year))) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'시행년도를 올바르게 선택해 주세요.'})};
  if(name.length>50) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'자격증 이름은 50자 이하로 입력해 주세요.'})};
  if(event.queryStringParameters?.mode==='search'){
    const query=(event.queryStringParameters?.q||'').trim();
    if(query.length>50) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'검색어는 50자 이하로 입력해 주세요.'})};
    if(query.length<2) return {statusCode:400,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:'검색어를 두 글자 이상 입력해 주세요.'})};
    try{
      const {items,totalCount}=await listQualifications(key);
      const matches=items.filter(x=>cleanName(x.name).includes(cleanName(query))).slice(0,30);
      return {statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=3600'},body:JSON.stringify({items:matches,loadedCount:items.length,totalCount})};
    }catch(e){ return {statusCode:502,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(errorBody(e,LIST_FAIL))}; }
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
    return {statusCode:502,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(errorBody(e,SCHEDULE_FAIL))};
  }
};
