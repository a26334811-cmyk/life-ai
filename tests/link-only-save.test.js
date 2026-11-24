const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* Saving a posting with only its link (idea 3 of the job-seeker review). */
const NOW=Date.parse('2026-11-16T03:00:00Z'); // 2026-11-16 12:00 Korea time
const ok=data=>async()=>({ok:true,status:200,json:async()=>({ok:true,...data})});
const flush=()=>new Promise(r=>setImmediate(r));
const list=a=>a.saved().jobPostings;

test('only the link is needed: saving the form without company and title keeps stand-ins and asks to fill them',()=>{
  const a=createApp(undefined,{now:NOW});
  a.el('postingUrl').value='https://www.example.com/jobs/1';
  a.run('savePosting()');
  assert.equal(list(a).length,1);
  const p=list(a)[0];
  assert.equal(p.company,'example.com');assert.equal(p.title,'공고 이름 미입력');assert.equal(p.needsInfo,true);
  a.run('renderJobHub()');
  assert.match(a.el('savedPostings').innerHTML,/회사명·공고명을 아직 못 채웠어요/);
  a.el('postingUrl').value='';a.run('savePosting()');
  assert.match(a.toasts.at(-1),/올바른 공고 링크/);
  assert.equal(list(a).length,1,'a missing link is still refused');
});

test('the form shows blanks for the stand-ins, and filling them clears the reminder',()=>{
  const a=createApp(undefined,{now:NOW});
  a.el('postingForm').scrollIntoView=()=>{};
  a.el('postingUrl').value='https://example.com/jobs/2';a.run('savePosting()');
  a.run(`editPosting('${list(a)[0].id}')`);
  assert.equal(a.el('postingCompany').value,'');assert.equal(a.el('postingTitle').value,'');
  a.el('postingCompany').value='삼천리';a.el('postingTitle').value='시설관리';
  a.run('savePosting()');
  assert.equal(list(a)[0].needsInfo,false);
  a.run('renderJobHub()');
  assert.doesNotMatch(a.el('savedPostings').innerHTML,/아직 못 채웠어요/);
});

test('"링크만 저장" saves the link at once and then fills company, title, region and the found deadline',async()=>{
  const a=createApp(undefined,{now:NOW,fetch:ok({title:'시설관리 신입 - 사람인',siteName:'사람인',company:'삼천리',region:'경기 수원시',deadline:'2026-12-05',description:''})});
  a.el('quickPostingUrl').value='https://example.com/jobs/3';
  const done=a.run('savePostingLinkOnly()');
  assert.equal(list(a).length,1,'saved before the page is read');
  assert.equal(list(a)[0].title,'공고 이름 미입력');
  assert.equal(a.el('quickPostingUrl').value,'','the box is emptied for the next link');
  await done;
  const p=list(a)[0];
  assert.equal(p.company,'삼천리');assert.equal(p.title,'시설관리 신입');assert.equal(p.region,'경기 수원시');
  assert.equal(p.deadline,'2026-12-05');assert.equal(p.deadlineGuess,true,'a deadline found by the app is marked for checking');
  assert.equal(p.needsInfo,false);
  assert.match(a.toasts.at(-1),/공고명.*회사명.*마감일/);
});

test('when the page cannot be read the link stays saved and the user is told',async()=>{
  const a=createApp(undefined,{now:NOW,fetch:async()=>{throw new TypeError('network');}});
  a.el('quickPostingUrl').value='https://example.com/jobs/4';
  await a.run('savePostingLinkOnly()');
  assert.equal(list(a).length,1);
  assert.equal(list(a)[0].needsInfo,true);
  assert.match(a.toasts.at(-1),/링크는 저장돼 있어요/);
  const refused=createApp(undefined,{now:NOW,fetch:async()=>({ok:false,status:422,json:async()=>({ok:false,message:'x'})})});
  refused.el('quickPostingUrl').value='https://example.com/jobs/5';
  await refused.run('savePostingLinkOnly()');
  assert.equal(list(refused).length,1);
});

test('"링크만 저장" refuses a bad or already saved link, and a past deadline is not filled',async()=>{
  const a=createApp(undefined,{now:NOW,fetch:ok({title:'정비',company:'한전',deadline:'2026-11-01',description:''})});
  a.el('quickPostingUrl').value='javascript:alert(1)';
  assert.equal(a.run('savePostingLinkOnly()'),undefined);
  assert.equal(a.run('state.jobPostings.length'),0,'a bad link is refused');
  a.el('quickPostingUrl').value='https://example.com/jobs/6';
  await a.run('savePostingLinkOnly()');
  assert.equal(list(a)[0].deadline,'','a deadline that is already over is not filled in');
  a.el('quickPostingUrl').value='https://example.com/jobs/6';
  a.run('savePostingLinkOnly()');
  assert.equal(list(a).length,1);
  assert.match(a.toasts.at(-1),/이미 저장한 공고/);
});

test('what the user typed while the page was being read is not overwritten',async()=>{
  let release;
  const a=createApp(undefined,{now:NOW,fetch:()=>new Promise(r=>{release=()=>r({ok:true,status:200,json:async()=>({ok:true,title:'읽은 제목',company:'읽은 회사',region:'읽은 지역',deadline:'2026-12-05',description:''})});})});
  a.el('quickPostingUrl').value='https://example.com/jobs/7';
  const done=a.run('savePostingLinkOnly()');
  await flush();
  const p=a.run('state.jobPostings[0]');
  p.title='내가 쓴 제목';p.region='내가 쓴 지역'; // edited by the user in the meantime
  release();await done;
  assert.equal(list(a)[0].title,'내가 쓴 제목');assert.equal(list(a)[0].region,'내가 쓴 지역');
  assert.equal(list(a)[0].company,'읽은 회사');
});

test('a posting deleted while its page is being read does not come back',async()=>{
  let release;
  const a=createApp(undefined,{now:NOW,fetch:()=>new Promise(r=>{release=()=>r({ok:true,status:200,json:async()=>({ok:true,title:'제목',company:'회사',description:''})});})});
  a.el('quickPostingUrl').value='https://example.com/jobs/8';
  const done=a.run('savePostingLinkOnly()');
  await flush();
  a.run('state.jobPostings=[]');
  release();await done;
  assert.equal(a.run('state.jobPostings.length'),0);
});
