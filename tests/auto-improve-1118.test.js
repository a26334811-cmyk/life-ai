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
