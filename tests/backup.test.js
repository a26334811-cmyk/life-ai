const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

/* Backup file creation and restore, run through the real app code (not just text searches). */

const KEY='lifeAIPrototypeV5';
const fileOf=text=>({files:[{size:Buffer.byteLength(text),text:async()=>text}]});
const fillForm=(a,v)=>{
  a.el('plannerTitle').value=v.title;a.el('plannerDate').value=v.date;a.el('plannerTime').value=v.time||'';
  a.el('plannerCategory').value='personal';a.el('plannerRepeat').value=v.repeat||'none';
  a.el('plannerUntil').value='';a.el('plannerPriority').value='normal';
};

/* An app that holds a goal and one record of each kind, all created through the app's own functions. */
async function appWithRecords(opts={}){
  const a=createApp(undefined,{downloads:true,search:'',...opts});
  a.run("state.mainGoal='전기기사 준비';state.nickname='지훈';state.goalType='cert'");
  a.run('plannerOpenForm()');
  fillForm(a,{title:'스터디',date:'2026-05-12',time:'19:00',repeat:'weekly'});
  await a.run('plannerSave()');
  a.el('habitName').value='물 마시기';a.run('habitAdd()');
  a.el('watchCompany').value='삼천리';a.el('watchUrl').value='https://example.com/careers';a.run('addWatchCompany()');
  a.el('postingCompany').value='한전KPS';a.el('postingTitle').value='정비';a.el('postingUrl').value='https://example.com/jobs/1';a.el('postingDeadline').value='2026-06-01';
  a.run('savePosting()');
  a.run("focusRecordCompletion({minutes:25,category:'study',completedAt:'2026-05-10T03:25:00.000Z',date:'2026-05-10'})");
  a.run("addActivity('테스트 활동')");
  return a;
}
const RECORD_KEYS=['mainGoal','nickname','goalType','plannerEntries','habits','watchCompanies','jobPostings','focusHistory','activity'];
const pick=(state,keys=RECORD_KEYS)=>JSON.parse(JSON.stringify(Object.fromEntries(keys.map(k=>[k,state[k]]))));

test('making a backup downloads a json file and remembers the backup date',async()=>{
  const a=await appWithRecords();
  const before=pick(a.saved());
  assert.ok(before.plannerEntries.length&&before.habits.length&&before.watchCompanies.length&&before.jobPostings.length&&before.focusHistory.length,'test data exists');

  a.run('exportLifeAIBackup()');
  assert.equal(a.downloads.length,1);
  assert.match(a.downloads[0].filename,/^life-ai-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(a.downloads[0].type,/application\/json/);
  assert.match(a.toasts.at(-1),/백업 파일을 만들었어요/);
  assert.ok(a.saved().lastBackupAt,'the date of the last backup is remembered');
  a.flushTimeouts();
  assert.equal(a.revokedUrls.length,1,'the temporary download address is released');
  assert.deepEqual(pick(JSON.parse(a.downloads[0].text).state),before,'the file holds the current records');
});

test('restoring the file from the app\'s own backup returns the same records',async()=>{
  const a=await appWithRecords();
  const before=pick(a.saved());
  a.run('exportLifeAIBackup()');
  const file=a.downloads[0].text;
  const payload=JSON.parse(file);
  assert.equal(payload.format,'life-ai-backup');assert.equal(payload.version,1);

  const b=createApp(undefined,{search:''});
  b.context.__input=fileOf(file);
  await b.run('importLifeAIBackup(__input)');
  assert.equal(b.reloads,1,'the app reloads after a restore');
  assert.ok(b.dialogs.some(d=>d.kind==='confirm'&&/교체/.test(d.message)),'asks before replacing');
  assert.deepEqual(pick(b.saved()),before);

  // The restored storage opens normally in a fresh app with nothing dropped or damaged.
  const c=createApp(b.storage.get(KEY),{search:''});
  assert.deepEqual(pick(JSON.parse(JSON.stringify(c.run('state')))),before);
  assert.equal(c.storage.has(KEY+'.damaged'),false);
  assert.equal(c.run('startupNotice'),'');
});

test('a backup made by an empty app can also be restored',async()=>{
  const a=createApp(undefined,{downloads:true,search:''});
  a.run('exportLifeAIBackup()');
  const b=createApp(undefined,{search:''});
  b.context.__input=fileOf(a.downloads[0].text);
  await b.run('importLifeAIBackup(__input)');
  assert.equal(b.reloads,1);
  assert.deepEqual(b.toasts.filter(t=>/않/.test(t)),[]);
});

/* ---------- files that must be refused, leaving the current records untouched ---------- */
async function refuses(text,{size,confirm,expectToast,expectConfirm=false}={}){
  const b=await appWithRecords({confirm});
  const original=b.storage.get(KEY);
  const input=text===null?{files:[]}:{files:[{size:size??Buffer.byteLength(text),text:async()=>text}]};
  b.context.__input=input;
  const toastsBefore=b.toasts.length;
  await b.run('importLifeAIBackup(__input)');
  assert.equal(b.storage.get(KEY),original,'stored records are unchanged');
  assert.equal(b.reloads,0,'no reload');
  assert.equal(b.dialogs.some(d=>d.kind==='confirm'),expectConfirm);
  if(expectToast)assert.match(b.toasts.slice(toastsBefore).join('|'),expectToast);
  return b;
}
const goodPayload=state=>({format:'life-ai-backup',version:1,exportedAt:'2026-05-10T00:00:00.000Z',state});
const baseState={mainGoal:'목표',nickname:'나',activity:[],completedTasks:[false,false,false,false,false]};

test('restore refuses broken files and keeps the current records',async()=>{
  await refuses('이건 JSON이 아니에요',{expectToast:/./});
  await refuses(JSON.stringify({format:'other',version:1,state:baseState}),{expectToast:/올바른 life-ai 백업 파일이 아니에요/});
  await refuses(JSON.stringify({format:'life-ai-backup',version:2,state:baseState}),{expectToast:/더 새로운 버전에서 만든 백업/});
  await refuses(JSON.stringify({format:'life-ai-backup',version:1}),{expectToast:/올바른 life-ai 백업 파일이 아니에요/});
  // 활동 기록이 배열이 아닌 것은 "구조가 올바르지 않아요"로 안내된다(백업 검사를 logic.js 한 곳으로 모은 뒤의 문구)
  await refuses(JSON.stringify(goodPayload({...baseState,activity:'x'})),{expectToast:/올바른 life-ai 백업 파일이 아니에요|구조가 올바르지 않아요/});
  // right outline, but a record inside is malformed
  await refuses(JSON.stringify(goodPayload({...baseState,plannerEntries:[{title:'x',date:'nope'}]})),{expectToast:/구조가 올바르지 않아요/});
});

test('restore refuses a file over 2MB without reading it',async()=>{
  const b=await appWithRecords();
  const original=b.storage.get(KEY);
  let read=false;
  b.context.__input={files:[{size:2*1024*1024+1,text:async()=>{read=true;return '';}}]};
  await b.run('importLifeAIBackup(__input)');
  assert.equal(read,false);
  assert.match(b.toasts.at(-1),/2MB 이하/);
  assert.equal(b.storage.get(KEY),original);assert.equal(b.reloads,0);
});

test('restore does nothing when no file is picked or the user cancels the question',async()=>{
  await refuses(null);
  const valid=JSON.stringify(goodPayload(baseState));
  const b=await refuses(valid,{confirm:false,expectConfirm:true});
  assert.equal(b.dialogs.some(d=>d.kind==='alert'),false,'no "restore complete" message');
});

/* ---------- full storage ---------- */
test('when storage is full, restore keeps the old records and does not reload',async()=>{
  const restored=JSON.stringify(goodPayload({...baseState,mainGoal:'복원될 목표'}));
  const full=await appWithRecords();
  const oldRaw=full.storage.get(KEY);
  // the write of the restored records is refused outright
  const b=createApp(oldRaw,{search:'',failSave:(k,v)=>k===KEY&&v.includes('복원될 목표')});
  b.context.__input=fileOf(restored);
  await b.run('importLifeAIBackup(__input)');
  assert.equal(b.storage.get(KEY),oldRaw);
  assert.equal(b.reloads,0);
  assert.equal(b.dialogs.some(d=>d.kind==='alert'),false,'no "restore complete" message');
  assert.match(b.toasts.at(-1),/복원 데이터를 저장하지 못했어요/);
});

test('when a failed restore write leaves junk behind, the old records are written back',async()=>{
  const full=await appWithRecords();
  const oldRaw=full.storage.get(KEY);
  const restored=JSON.stringify(goodPayload({...baseState,mainGoal:'복원될 목표'}));
  // The first write of the new records fails after damaging the stored value; the rollback write is allowed.
  let failed=false;
  const b=createApp(oldRaw,{search:'',failSave:(k,v,storage)=>{
    if(!failed&&k===KEY&&v.includes('복원될 목표')){failed=true;storage.set(k,'{broken');return true;}
    return false;
  }});
  b.context.__input=fileOf(restored);
  await b.run('importLifeAIBackup(__input)');
  assert.equal(failed,true);
  assert.equal(b.storage.get(KEY),oldRaw,'rolled back to the snapshot');
  assert.equal(b.reloads,0);
  assert.match(b.toasts.at(-1),/복원 데이터를 저장하지 못했어요/);
});

test('making a backup file still works, and tells the truth, when saving the backup date fails',async()=>{
  const a=createApp(undefined,{downloads:true,search:'',failSave:true});
  a.run('exportLifeAIBackup()');
  assert.equal(a.downloads.length,1,'the file is still downloaded');
  assert.ok(JSON.parse(a.downloads[0].text).state);
});
