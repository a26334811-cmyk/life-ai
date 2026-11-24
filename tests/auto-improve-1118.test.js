const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* #111 backup: the app cannot know the file was saved, so the message must not claim it */
test('backup message does not claim the file was saved',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x'}));
  const d=a.context.document;
  d.createElement=()=>({click(){},remove(){}});
  d.body={appendChild(){}};
  a.context.Blob=Blob;
  a.run('exportLifeAIBackup()');
  assert.equal(a.toasts.length,1);
  assert.match(a.toasts[0],/만들었어요/);
  assert.match(a.toasts[0],/확인해 주세요/);
  assert.doesNotMatch(a.toasts[0],/저장했어요/);
  assert.ok(a.saved().lastBackupAt,'backup date is still recorded');
});

/* #126 posting links are tidied before saving / comparing */
test('cleanPostingUrl removes credentials, fragment and tracking values but keeps real parameters',()=>{
  const L=require('../logic.js');
  assert.equal(L.cleanPostingUrl('https://user:pw@example.com/job?id=7&utm_source=x&fbclid=abc&gclid=1&utm_medium=m#apply'),'https://example.com/job?id=7');
  assert.equal(L.cleanPostingUrl('https://example.com/job?utm_source=x#top'),'https://example.com/job');
  assert.equal(L.cleanPostingUrl('https://example.com/job?q=%EC%8B%9C%EC%84%A4&id=1'),'https://example.com/job?q=%EC%8B%9C%EC%84%A4&id=1','untouched query is not re-encoded');
  assert.equal(L.cleanPostingUrl('javascript:alert(1)'),'');
  assert.equal(L.cleanPostingUrl('ftp://example.com/a'),'');
  assert.equal(L.cleanPostingUrl('not a url'),'');
});

test('saving a posting stores the cleaned link and treats tracking-only differences as duplicates',()=>{
  const a=createApp();
  const fill=u=>{a.el('postingId').value='';a.el('postingCompany').value='A';a.el('postingTitle').value='T';a.el('postingUrl').value=u;};
  fill('https://me:secret@example.com/job/1?utm_source=kakao#x');
  a.run('savePosting()');
  assert.equal(a.saved().jobPostings.length,1);
  assert.equal(a.saved().jobPostings[0].url,'https://example.com/job/1');
  fill('https://example.com/job/1?fbclid=zzz');
  a.run('savePosting()');
  assert.equal(a.saved().jobPostings.length,1,'duplicate is caught');
  assert.match(a.toasts[a.toasts.length-1],/이미 저장한 공고/);
});

test('a shared link is cleaned and matched against already saved (older, unclean) links',()=>{
  const old=JSON.stringify({mainGoal:'x',jobPostings:[{id:'p1',company:'A',title:'T',url:'https://example.com/job/9?utm_source=a',deadline:'',stage:'관심',tasks:[false,false,false,false]}]});
  const a=createApp(old,{search:'?url='+encodeURIComponent('https://example.com/job/9?fbclid=1#z')});
  assert.match(a.el('toast').textContent,/이미 저장한 공고/,'startup toast goes through the real toast element');
  const b=createApp(undefined,{search:'?url='+encodeURIComponent('https://example.com/job/10?fbclid=1#z'),fetch:async()=>({ok:true,json:async()=>({ok:false})})});
  assert.equal(b.el('postingUrl').value,'https://example.com/job/10');
});
/* #121 the home header had a bell that looked clickable but did nothing */
test('home header has no decorative bell',()=>{
  const {html}=require('./helpers/app-harness.js');
  const header=html.match(/<div class="topbar"><div><div class="logo"[^\n]*<\/div>/)[0];
  assert.ok(header.includes('id="hello"'));
  assert.ok(!header.includes('🔔'));
});

/* #119 weekly bars must be readable by screen readers: no img role on the whole group, a sentence per bar */
test('weekly focus bars give each day a readable label',()=>{
  const a=createApp(JSON.stringify({mainGoal:'x'}));
  const out=a.run('progressInsightsHTML()');
  assert.doesNotMatch(out,/role="img" aria-label="이번 주/);
  assert.match(out,/class="insights-bars" role="group"/);
  for(const d of ['일','월','화','수','목','금','토']) assert.ok(out.includes('role="img" aria-label="'+d+' 0분"'),d);
});

/* #112 unfavorite asks first */
test('removing a watched company or favorite cert asks first and keeps it when declined',async()=>{
  const data=JSON.stringify({mainGoal:'x',watchCompanies:[{id:'w1',name:'A회사',url:'https://a.example/jobs'}],favoriteCerts:[{name:'정보처리기사',code:'1'}]});
  const no=createApp(data,{confirm:false});
  await no.run("removeWatchCompany('w1')");
  await no.run("removeFavoriteCert('1')");
  assert.equal(no.dialogs.filter(d=>d.kind==='confirm').length,2);
  assert.equal(no.saved().watchCompanies.length,1);
  assert.equal(no.saved().favoriteCerts.length,1);
  const yes=createApp(data,{confirm:true});
  await yes.run("removeWatchCompany('w1')");
  await yes.run("removeFavoriteCert('1')");
  assert.equal(yes.saved().watchCompanies.length,0);
  assert.equal(yes.saved().favoriteCerts.length,0);
});
