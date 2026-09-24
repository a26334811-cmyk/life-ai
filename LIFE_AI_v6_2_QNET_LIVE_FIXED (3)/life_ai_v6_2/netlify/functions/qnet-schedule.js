function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,'i'));
  return m ? m[1].trim() : '';
}
function decodeXml(s){
  return String(s||'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function normalizeServiceKey(raw){
  try { return decodeURIComponent(raw); } catch { return raw; }
}
function stripHtml(s){
  return decodeXml(String(s||'').replace(/<br\\s*\\/?\\s*>/gi,'\\n').replace(/<[^>]+>/g,' '))
    .replace(/\\u00a0/g,' ').replace(/[ \\t]+/g,' ').replace(/\\n\\s+/g,'\\n').trim();
}
function toIsoDate(s){
  const m=String(s||'').match(/(20\\d{2})[.\\/-](\\d{1,2})[.\\/-](\\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}` : null;
}
function parseDateRange(text){
  const dates=[...String(text||'').matchAll(/(20\\d{2})[.\\/-](\\d{1,2})[.\\/-](\\d{1,2})/g)]
    .map(m=>`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`);
  return {startDate:dates[0]||null,endDate:dates[1]||dates[0]||null};
}
function parseScheduleTable(html, year){
  const tables=[...String(html||'').matchAll(/<table[\\s\\S]*?<\\/table>/gi)].map(m=>m[0]);
  let table=tables.find(t=>/필기원서접수/.test(t)&&/실기원서접수/.test(t)&&/최종합격자/.test(t));
  if(!table) return [];
  const rows=[...table.matchAll(/<tr[\\s\\S]*?<\\/tr>/gi)].map(m=>m[0]);
  const out=[];
  for(const row of rows){
    const cells=[...row.matchAll(/<t[dh][^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)].map(m=>stripHtml(m[1]));
    if(cells.length<6 || !cells[0].includes(String(year))) continue;
    const round=cells[0].replace(/\\s+/g,' ').trim();
    const labels=['필기원서접수','필기시험','필기합격발표','실기원서접수','실기시험','최종합격발표'];
    const values=cells.slice(1,7);
    const events=[];
    for(let i=0;i<Math.min(labels.length,values.length);i++){
      const range=parseDateRange(values[i]);
      if(!range.startDate) continue;
      events.push({type:labels[i],label:labels[i],startDate:range.startDate,endDate:range.endDate,raw:values[i]});
    }
    out.push({round,events});
  }
  return out;
}
async function findQualification(key, name){
  const base='http://openapi.q-net.or.kr/api/service/rest/InquiryListNationalQualifcationSVC/getList';
  const qs=new URLSearchParams({serviceKey:key});
  const r=await fetch(`${base}?${qs.toString()}`);
  const xml=await r.text();
  if(!r.ok) throw new Error(`Q-Net 종목 조회 오류 ${r.status}`);
  const errCode=xmlText(xml,'returnReasonCode')||xmlText(xml,'resultCode');
  const errMsg=xmlText(xml,'returnAuthMsg')||xmlText(xml,'resultMsg');
  if(errCode&&!['00','0'].includes(errCode)) throw new Error(`Q-Net 종목 목록 API: ${errMsg||errCode}`);
  const blocks=xml.match(/<item>[\\s\\S]*?<\\/item>/gi)||[];
  const all=blocks.map(b=>({
    code:decodeXml(xmlText(b,'jmcd')),name:decodeXml(xmlText(b,'jmfldnm')),
    qualgbCd:decodeXml(xmlText(b,'qualgbcd')),qualgbNm:decodeXml(xmlText(b,'qualgbnm')),
    seriesNm:decodeXml(xmlText(b,'seriesnm')),fieldNm:decodeXml(xmlText(b,'mdobligfldnm'))
  })).filter(x=>x.code&&x.name);
  const clean=s=>String(s||'').replace(/\\s+/g,'').replace(/[()（）]/g,'').toLowerCase();
  const q=clean(name);
  return all.find(x=>clean(x.name)===q)||all.find(x=>clean(x.name).includes(q))||all.find(x=>q.includes(clean(x.name)));
}
async function fetchOfficialSchedule(qual, year){
  const params=new URLSearchParams({
    id:'crf00503s02',jmCd:qual.code,jmInfoDivCcd:'B0',jmNm:qual.name
  });
  const url=`https://www.q-net.or.kr/crf005.do?${params.toString()}`;
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 LIFE-AI/6.2'}});
  const html=await r.text();
  if(!r.ok) throw new Error(`Q-Net 공식 시험일정 페이지 오류 ${r.status}`);
  return {url,rounds:parseScheduleTable(html,year)};
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
    const official=await fetchOfficialSchedule(qual,year);
    const items=official.rounds.flatMap(r=>r.events.map(e=>({
      qualificationName:qual.name,qualificationCode:qual.code,round:r.round,
      type:e.type,label:e.label,startDate:e.startDate,endDate:e.endDate,raw:e.raw
    })));
    return {statusCode:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=3600'},body:JSON.stringify({
      source:'한국산업인력공단 Q-Net 공식 종목별 시험일정',year,qualification:qual,
      totalCount:items.length,rounds:official.rounds,items,
      officialUrl:official.url,
      message:items.length?'Q-Net 공식 시험일정을 불러왔어요.':'해당 연도의 종목별 시험일정을 찾지 못했어요. 상시검정 종목은 별도 일정 연동이 필요할 수 있어요.'
    })};
  }catch(e){
    return {statusCode:502,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({message:e.message||'Q-Net 호출에 실패했어요.'})};
  }
};
