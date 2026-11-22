const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../logic.js');
const {createApp}=require('./helpers/app-harness.js');

/* Closing time of a posting, and "found automatically - please check" marks (ideas 1 and 6 of the job-seeker review). */
const NOV=Date.parse('2026-11-16T03:00:00Z'); // 2026-11-16 12:00 Korea time
const PASTE='접수기간 2026.11.10 ~ 2026.11.30(일) 18:00까지';
let counter=0;
const fill=(a,deadline,time)=>{
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/'+(++counter);
  a.el('postingDeadline').value=deadline||'';a.el('postingDeadlineTime').value=time||'';
};
const posting=a=>a.saved().jobPostings[0];

test('extractDeadline reads a closing time right after the date, and ignores look-alikes',()=>{
  const t=text=>L.extractDeadline(text,'2026-11-16')?.time;
  assert.equal(t('접수기간 2026.11.10 ~ 2026.11.30(일) 18:00까지'),'18:00');
  assert.equal(t('마감 11월 30일 오후 6시'),'18:00');
  assert.equal(t('마감 11월 30일 오전 9시 30분'),'09:30');
  assert.equal(t('서류 마감 2026.11.30 24:00'),'23:59','24:00 means the end of that day');
  assert.equal(t('마감 2026.11.30 1시간 이내'),'','"1시간" is a length of time, not a closing time');
  assert.equal(t('마감 2026.11.30 25:00'),'');
  assert.equal(t('마감 2026.11.30'),'');
  assert.equal(L.validTime('18:00'),true);
  for(const bad of ['24:00','1:00','18:60','','abc',null,1800])assert.equal(L.validTime(bad),false,String(bad));
});

test('pasted text fills the date and time, marks them as found automatically, and the card asks for a check',()=>{
  const a=createApp(undefined,{now:NOV});
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';a.el('postingUrl').value='https://example.com/jobs/1';
  a.el('postingPaste').value=PASTE;
  a.run('fillPostingFromPaste()');
  assert.equal(a.el('postingDeadline').value,'2026-11-30');
  assert.equal(a.el('postingDeadlineTime').value,'18:00');
  assert.match(a.el('postingFetchStatus').textContent,/마감 시각\(18:00\)/);
  a.run('savePosting()');
  const p=posting(a);
  assert.equal(p.deadlineTime,'18:00');assert.equal(p.deadlineGuess,true);assert.equal(p.deadlineChecked,false);
  a.run('renderJobHub()');
  const card=a.el('savedPostings').innerHTML;
  assert.match(card,/D-14 18:00/);
  assert.match(card,/마감일을 자동으로 찾았어요. 공식 공고에서 확인해 주세요/);
  a.run(`confirmPostingDeadline('${p.id}')`);
  assert.equal(posting(a).deadlineGuess,false);assert.equal(posting(a).deadlineChecked,true);
  const after=a.el('savedPostings').innerHTML;
  assert.doesNotMatch(after,/자동으로 찾았어요/);assert.match(after,/✓ 공식 공고에서 마감일을 확인했어요/);
});

test('a date the user typed is not marked, and changing a found date clears the mark',()=>{
  const a=createApp(undefined,{now:NOV});
  a.el('postingUrl').value='https://example.com/jobs/2';a.el('postingPaste').value=PASTE;
  a.run('fillPostingFromPaste()');
  a.run('postingDeadlineAuto=false'); // the oninput of the date/time boxes
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';
  a.run('savePosting()');
  assert.equal(posting(a).deadlineGuess,false);
  assert.equal(posting(a).deadlineChecked,false);
  a.run('renderJobHub()');
  assert.doesNotMatch(a.el('savedPostings').innerHTML,/자동으로 찾았어요|확인했어요/);
});

test('editing keeps the mark until the date or time is changed; a changed time loses the "checked" mark',()=>{
  const a=createApp(undefined,{now:NOV});
  a.el('postingForm').scrollIntoView=()=>{}; // the fake page has no scrolling
  fill(a,'2026-11-30','18:00');a.run('postingDeadlineAuto=true');a.run('savePosting()');
  const id=posting(a).id;
  a.run(`editPosting('${id}')`);
  assert.equal(a.el('postingDeadlineTime').value,'18:00');
  a.run('savePosting()');
  assert.equal(posting(a).deadlineGuess,true,'saved again without changes');
  a.run(`confirmPostingDeadline('${id}')`);
  a.run(`editPosting('${id}')`);a.run('savePosting()');
  assert.equal(posting(a).deadlineChecked,true,'an unchanged date stays checked');
  a.run(`editPosting('${id}')`);
  a.el('postingDeadlineTime').value='17:00';a.run('postingDeadlineAuto=false');a.run('savePosting()');
  assert.equal(posting(a).deadlineChecked,false,'a changed time must be checked again');
  assert.equal(posting(a).deadlineTime,'17:00');
});

test('a bad time is refused, and a time without a date is dropped',()=>{
  const a=createApp(undefined,{now:NOV});
  fill(a,'2026-11-30','25:99');a.run('savePosting()');
  assert.equal(a.run('state.jobPostings.length'),0);
  assert.match(a.toasts.at(-1),/마감 시각을 올바르게/);
  fill(a,'','18:00');a.run('savePosting()');
  assert.equal(posting(a).deadline,'');assert.equal(posting(a).deadlineTime,'');
});

test('on the closing day the card says the time, and says when it has passed',()=>{
  const noon=createApp(undefined,{now:Date.parse('2026-11-16T03:00:00Z')}); // 12:00 Korea
  fill(noon,'2026-11-16','18:00');noon.run('savePosting()');noon.run('renderJobHub()');
  assert.match(noon.el('savedPostings').innerHTML,/오늘 18:00 마감/);
  const evening=createApp(undefined,{now:Date.parse('2026-11-16T10:30:00Z')}); // 19:30 Korea
  fill(evening,'2026-11-16','18:00');evening.run('savePosting()');evening.run('renderJobHub()');
  assert.match(evening.el('savedPostings').innerHTML,/마감 시각 지남 \(18:00\)/);
  const noTime=createApp(undefined,{now:Date.parse('2026-11-16T10:30:00Z')});
  fill(noTime,'2026-11-16','');noTime.run('savePosting()');noTime.run('renderJobHub()');
  assert.match(noTime.el('savedPostings').innerHTML,/오늘 마감/);
});

test('the planner day list, the upcoming banner and alerts show the time and the "check" note',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x',goalType:'job',jobPostings:[
    {id:'p1',company:'삼천리',title:'시설',url:'https://e.com/1',deadline:'2026-11-17',deadlineTime:'18:00',deadlineGuess:true,stage:'관심',tasks:[false,false,false,false]},
    {id:'p2',company:'한전',title:'정비',url:'https://e.com/2',deadline:'2026-11-17',deadlineTime:'bad',stage:'관심',tasks:[false,false,false,false]}]}),{now:NOV});
  const day=JSON.parse(a.run("JSON.stringify(plannerForDate('2026-11-17'))"));
  const one=day.find(e=>e.postingId==='p1'),two=day.find(e=>e.postingId==='p2');
  assert.equal(one.time,'18:00');assert.match(one.title,/마감 \(확인 필요\)$/);
  assert.equal(two.time,'','a broken time is ignored');
  const alerts=L.upcomingAlerts(a.saved(),'2026-11-16',3);
  assert.equal(alerts.find(x=>x.title.includes('삼천리')).label,'마감 18:00');
  assert.equal(alerts.find(x=>x.title.includes('삼천리')).guess,true);
  assert.equal(alerts.find(x=>x.title.includes('한전')).label,'마감');
  const banner=a.run('upcomingBannerHTML()');
  assert.match(banner,/마감 18:00 · [^<]*확인 필요/);
});

test('the calendar file has a timed event when there is a closing time, an all-day event otherwise',()=>{
  const a=createApp();
  const ics=a.run(`buildDeadlineICS([{id:'a',company:'삼천리',title:'시설',url:'https://e.com/1',deadline:'2026-05-20',deadlineTime:'18:00',deadlineGuess:true},{id:'b',company:'한전',title:'정비',url:'https://e.com/2',deadline:'2026-05-21'}],0)`);
  assert.match(ics,/DTSTART:20260520T083000Z/);   // 18:00 Korea = 09:00 UTC, a 30-minute slot before it
  assert.match(ics,/DTEND:20260520T090000Z/);
  assert.match(ics,/\[마감·확인 필요\] 삼천리 · 시설 \(18:00\)/);
  assert.match(ics,/DTSTART;VALUE=DATE:20260521/);
  assert.match(ics,/SUMMARY:\[마감\] 한전/);
});

test('postings with a closing time and mark survive a backup check and reload',()=>{
  const state={nickname:'a',mainGoal:'b',activity:[],completedTasks:[false,false,false,false,false],
    jobPostings:[{id:'p1',company:'a',title:'b',url:'https://e.com',deadline:'2026-11-30',deadlineTime:'18:00',deadlineGuess:true,deadlineChecked:false,tasks:[false,false,false,false]}]};
  assert.equal(L.validateBackupState(state),true);
  const a=createApp(JSON.stringify(state),{now:NOV});
  assert.equal(a.run('state.jobPostings[0].deadlineTime'),'18:00');
});
