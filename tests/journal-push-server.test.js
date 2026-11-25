const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=require('../netlify/functions/lib/push-core.js');

/* The reminder server: the rules (push-core.js), the function that saves a phone and the scheduled one that sends. */
const NOW=Date.parse('2026-11-25T12:30:00Z'); // 2026-11-25 (Wednesday) 21:30 Korea time
const TODAY='2026-11-25';
const dir=path.join(__dirname,'..','netlify','functions');
const load=name=>import(pathToFileURL(path.join(dir,name)).href);
const SUB=(n='a')=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+n+'-token',keys:{p256dh:'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',auth:'tBHItJI5svbpez7KI4CCXg'}});
const SETTINGS={remind:true,time:'21:00',days:[0,1,2,3,4,5,6],message:'',lastNotified:''};

function fakeStore(){
  const map=new Map();
  return {map,
    async get(key){return map.has(key)?JSON.parse(map.get(key)):null;},
    async setJSON(key,value){map.set(key,JSON.stringify(value));},
    async delete(key){map.delete(key);},
    async list(){return {blobs:[...map.keys()].map(key=>({key}))};}};
}
async function setup(extra={}){
  const runtime=await load('lib/push-runtime.mjs');
  const store=fakeStore(),sent=[];
  runtime.hooks.store=store;runtime.hooks.now=()=>NOW;
  runtime.hooks.send=extra.send||(async(subscription,payload)=>{sent.push({subscription,payload});});
  const subscribe=(await load('push-subscribe.mjs')).default;
  const send=(await load('push-send.mjs')).default;
  const call=(body,opts={})=>subscribe(new Request('https://app.example/.netlify/functions/push-subscribe',{method:opts.method||'POST',headers:{host:'app.example',origin:'https://app.example',...(opts.headers||{})},body:opts.method==='GET'?undefined:JSON.stringify(body)}));
  const save=(sub,settings,done)=>call({action:'save',subscription:sub,settings,doneDate:done});
  return {store,sent,call,save,send,runtime};
}

test('only the push services of real browsers are accepted as a push address',()=>{
  for(const ok of ['https://fcm.googleapis.com/fcm/send/abc','https://updates.push.services.mozilla.com/wpush/v2/abc','https://web.push.apple.com/QAbc','https://wns2-par02p.notify.windows.com/w/?token=abc'])assert.equal(core.validEndpoint(ok),true,ok);
  for(const bad of ['http://fcm.googleapis.com/x','https://evil.example/x','https://fcm.googleapis.com.evil.example/x','https://user:pw@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://127.0.0.1/x','https://localhost/x','javascript:alert(1)','','x'.repeat(800),null,5,'https://169.254.169.254/latest/meta-data'])assert.equal(core.validEndpoint(bad),false,String(bad).slice(0,40));
});

test('a push address needs both keys in the usual shape, and nothing else is kept',()=>{
  assert.deepEqual(core.cleanSubscription({...SUB(),extra:'x',keys:{...SUB().keys,more:1}}),SUB());
  assert.equal(core.cleanSubscription({endpoint:SUB().endpoint,keys:{p256dh:'abc',auth:'x'}}),null);
  assert.equal(core.cleanSubscription({endpoint:SUB().endpoint}),null);
  assert.equal(core.cleanSubscription({endpoint:SUB().endpoint,keys:{p256dh:'<script>alert(1)</script>',auth:SUB().keys.auth}}),null);
  assert.equal(core.cleanSubscription(null),null);
});

test('reminder settings are forced into a safe shape',()=>{
  assert.deepEqual(core.cleanSettings(undefined),{remind:false,time:'21:00',days:[0,1,2,3,4,5,6],message:'',lastNotified:''});
  const s=core.cleanSettings({remind:true,time:'7:5',days:[6,1,1,9,'x'],message:'  잠깐\n쉬어요 '+'가'.repeat(60),lastNotified:'nope'});
  assert.equal(s.time,'21:00');assert.deepEqual(s.days,[1,6]);assert.equal(s.lastNotified,'');
  assert.equal(s.message.length,40);assert.doesNotMatch(s.message,/\n/);
  assert.equal(core.cleanSettings({remind:'yes'}).remind,false);
});

test('isDue: on, chosen weekday, time reached but not too long ago, not sent today, day not written',()=>{
  const rec=(extra={})=>({remind:true,time:'21:00',days:[3],lastSent:'',doneDate:'',...extra});
  assert.equal(core.isDue(rec(),NOW),true);
  assert.equal(core.isDue(rec({remind:false}),NOW),false);
  assert.equal(core.isDue(rec({days:[1,2]}),NOW),false,'not a chosen weekday');
  assert.equal(core.isDue(rec({time:'22:00'}),NOW),false,'the time has not come');
  assert.equal(core.isDue(rec({time:'21:30'}),NOW),true,'exactly on time');
  assert.equal(core.isDue(rec({time:'18:00'}),NOW),false,'3.5 hours late: a stale reminder is not sent');
  assert.equal(core.isDue(rec({time:'18:30'}),NOW),true,'exactly 3 hours late is still fine');
  assert.equal(core.isDue(rec({lastSent:TODAY}),NOW),false,'already sent today');
  assert.equal(core.isDue(rec({lastSent:'2026-11-24'}),NOW),true);
  assert.equal(core.isDue(rec({doneDate:TODAY}),NOW),false,'today is already written');
  assert.equal(core.isDue(rec({doneDate:'2026-11-24'}),NOW),true);
  assert.equal(core.isDue(null,NOW),false);assert.equal(core.isDue(rec({time:'bad'}),NOW),false);
  assert.equal(core.isDue({remind:true,time:'00:10',days:[4],lastSent:'',doneDate:''},Date.parse('2026-11-25T15:30:00Z')),true,'Korea is already Thursday at 15:30 UTC');
});

test('the message the phone shows never carries record text',()=>{
  assert.deepEqual(core.buildPayload({message:''}),{title:'오늘 하루는 어땠나요?',body:core.BODY_TEXT,screen:'journal'});
  assert.equal(core.buildPayload({message:'오늘 한 줄만 써 볼까요?'}).title,'오늘 한 줄만 써 볼까요?');
});

test('buildRecord keeps only what is needed, and the "sent" date only moves forward',()=>{
  const first=core.buildRecord(SUB(),{...SETTINGS,lastNotified:'2026-11-25',text:'비밀 일기',journal:[1]},TODAY,null,NOW);
  assert.deepEqual(Object.keys(first).sort(),['createdAt','days','doneDate','endpoint','keys','lastSent','message','remind','time','updatedAt']);
  assert.equal(first.lastSent,'2026-11-25');assert.equal(first.doneDate,TODAY);
  assert.doesNotMatch(JSON.stringify(first),/비밀 일기/);
  const again=core.buildRecord(SUB(),{...SETTINGS,lastNotified:'2026-11-20'},'',first,NOW+1000);
  assert.equal(again.lastSent,'2026-11-25','an older date from the phone never moves it back');
  assert.equal(again.createdAt,first.createdAt);assert.equal(again.doneDate,'');
});

test('saving a phone: only from the app\'s own page, with a good address, and the stored record has no record text',async()=>{
  const {call,save,store}=await setup();
  assert.equal((await call({action:'save'},{headers:{origin:'https://other.example'}})).status,403);
  assert.equal((await save({endpoint:'https://evil.example/x',keys:SUB().keys},SETTINGS,'')).status,400);
  assert.equal((await save(SUB(),SETTINGS,'')).status,200);
  assert.equal(store.map.size,1);
  const saved=JSON.parse([...store.map.values()][0]);
  assert.equal(saved.endpoint,SUB().endpoint);assert.equal(saved.time,'21:00');assert.equal(saved.remind,true);
  assert.equal((await save(SUB(),{...SETTINGS,time:'20:00'},TODAY)).status,200);
  assert.equal(store.map.size,1,'the same phone is one record');
  assert.equal(JSON.parse([...store.map.values()][0]).time,'20:00');
  assert.equal(JSON.parse([...store.map.values()][0]).doneDate,TODAY);
  assert.equal((await call({action:'nope'})).status,400);
  assert.equal((await call('x',{method:'PUT'})).status,405);
});

test('a request that is too big or not JSON is refused',async()=>{
  const {call}=await setup();
  assert.equal((await call({action:'save',subscription:SUB(),settings:{...SETTINGS,message:'x'.repeat(core.MAX_BODY_CHARS)}})).status,413);
  const runtime=await load('lib/push-runtime.mjs');
  const subscribe=(await load('push-subscribe.mjs')).default;
  const res=await subscribe(new Request('https://app.example/f',{method:'POST',headers:{host:'app.example',origin:'https://app.example'},body:'{not json'}));
  assert.equal(res.status,400);void runtime;
});

test('the server key is handed out only when it is set',async()=>{
  const {call}=await setup();
  delete process.env.VAPID_PUBLIC_KEY;
  assert.equal((await call(null,{method:'GET'})).status,503);
  process.env.VAPID_PUBLIC_KEY='BPublicKeyForTheTest';
  const ok=await call(null,{method:'GET'});
  assert.equal(ok.status,200);assert.equal((await ok.json()).publicKey,'BPublicKeyForTheTest');
  delete process.env.VAPID_PUBLIC_KEY;
});

test('removing a phone forgets it, and the number of phones is capped',async()=>{
  const {call,save,store}=await setup();
  await save(SUB('one'),SETTINGS,'');
  assert.equal(store.map.size,1);
  assert.equal((await call({action:'remove',endpoint:SUB('one').endpoint})).status,200);
  assert.equal(store.map.size,0);
  assert.equal((await call({action:'remove',endpoint:'https://evil.example/x'})).status,400);
  for(let i=0;i<core.MAX_RECORDS;i++)store.map.set('k'+i,'{}');
  assert.equal((await save(SUB('new'),SETTINGS,'')).status,429,'a stranger cannot fill the storage');
  store.map.clear();await save(SUB('known'),SETTINGS,'');
  for(let i=0;i<core.MAX_RECORDS-1;i++)store.map.set('k'+i,'{}');
  assert.equal((await save(SUB('known'),{...SETTINGS,time:'20:00'},'')).status,200,'a phone already kept can still change its settings');
});

test('the scheduled run sends to a phone whose time has come, once a day, and tells the phone what to open',async()=>{
  const {save,send,sent,runtime}=await setup();
  await save(SUB('a'),{...SETTINGS,time:'21:00',message:'오늘 한 줄만 써 볼까요?'},'');
  await save(SUB('late'),{...SETTINGS,time:'23:00'},'');          // not yet
  await save(SUB('off'),{...SETTINGS,remind:false},'');           // switched off
  await save(SUB('done'),{...SETTINGS},TODAY);                    // already written today
  await save(SUB('skip'),{...SETTINGS,lastNotified:TODAY},'');    // the phone said today is settled
  const result=await (await send()).json();
  assert.deepEqual(result,{checked:5,sent:1,removed:0,failed:0});
  assert.equal(sent.length,1);
  assert.equal(sent[0].subscription.endpoint,SUB('a').endpoint);
  assert.deepEqual(sent[0].payload,{title:'오늘 한 줄만 써 볼까요?',body:core.BODY_TEXT,screen:'journal'});
  assert.equal((await (await send()).json()).sent,0,'the next run does not send it again');
  runtime.hooks.now=()=>NOW+24*3600*1000; // the next day at 21:30
  assert.equal((await (await send()).json()).sent,3,'every phone that is on and not written gets the next day\'s reminder');
});

test('a phone that is gone is forgotten; a temporary problem is tried again on the next run',async()=>{
  let mode='gone';
  const {save,send,store}=await setup({send:async()=>{if(mode==='gone')throw Object.assign(new Error('gone'),{statusCode:410});if(mode==='busy')throw Object.assign(new Error('busy'),{statusCode:503});}});
  await save(SUB('x'),SETTINGS,'');
  assert.deepEqual(await (await send()).json(),{checked:1,sent:0,removed:1,failed:0});
  assert.equal(store.map.size,0);
  mode='busy';
  await save(SUB('y'),SETTINGS,'');
  assert.deepEqual(await (await send()).json(),{checked:1,sent:0,removed:0,failed:1});
  assert.equal(JSON.parse([...store.map.values()][0]).lastSent,'','the day is not marked as sent after a failure');
  mode='ok';
  assert.equal((await (await send()).json()).sent,1);
});

test('a broken stored record is cleaned away and never stops the others',async()=>{
  const {send,save,store,sent}=await setup();
  store.map.set('broken',JSON.stringify({endpoint:'https://evil.example/x',keys:{}}));
  await save(SUB('good'),SETTINGS,'');
  const result=await (await send()).json();
  assert.equal(result.removed,1);assert.equal(result.sent,1);assert.equal(sent.length,1);
  assert.equal(store.map.has('broken'),false);
});

test('the sender asks for the keys and the schedule is every 10 minutes',async()=>{
  const runtime=await load('lib/push-runtime.mjs');
  runtime.hooks.send=null;
  delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;
  await assert.rejects(()=>runtime.sendPush(SUB(),{title:'x'}),/VAPID keys are not set/);
  assert.equal((await load('push-send.mjs')).config.schedule,'*/10 * * * *');
});

test('a real push request is built with the real library: encrypted body, VAPID header, the right service',async()=>{
  const webpush=require('web-push');
  const keys=webpush.generateVAPIDKeys();
  webpush.setVapidDetails('https://app.example',keys.publicKey,keys.privateKey);
  const sub=SUB();
  const request=webpush.generateRequestDetails(sub,JSON.stringify(core.buildPayload({message:''})),{TTL:3600});
  assert.equal(new URL(request.endpoint).host,'fcm.googleapis.com');
  assert.match(request.headers.Authorization,/^vapid t=/);
  assert.equal(request.headers['Content-Encoding'],'aes128gcm');
  assert.ok(Buffer.isBuffer(request.body)&&request.body.length>20);
  assert.doesNotMatch(request.body.toString('utf8'),/오늘 하루는/,'the message travels encrypted');
});

test('every outside part the server functions load is listed in package.json, also in the folder that is deployed, and Node 22 is asked for',()=>{
  const fs=require('node:fs');
  const root=path.join(__dirname,'..');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const nested=path.join(root,'LIFE_AI_v6_2_QNET_LIVE_FIXED (3)','life_ai_v6_2');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(nested,'package.json'),'utf8')),pkg,'the deployed folder installs the same parts');
  assert.equal(fs.readFileSync(path.join(nested,'package-lock.json'),'utf8'),fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  const used=new Set();
  const scan=file=>{
    const text=fs.readFileSync(file,'utf8');
    for(const m of text.matchAll(/(?:import\(|from\s+|require\()\s*['"]([^'".\/][^'"]*)['"]/g))used.add(m[1]);
  };
  for(const name of ['push-subscribe.mjs','push-send.mjs','lib/push-runtime.mjs','lib/push-core.js'])scan(path.join(dir,name));
  for(const part of [...used].filter(x=>!x.startsWith('node:')))assert.ok(pkg.dependencies&&pkg.dependencies[part],part+' must be in package.json dependencies');
  assert.ok(used.has('web-push')&&used.has('@netlify/blobs'),'the scan found the two parts');
  const toml=fs.readFileSync(path.join(root,'netlify.toml'),'utf8');
  assert.match(toml,/\[build\.environment\][\s\S]*NODE_VERSION = "22"/);
  assert.ok(Number(require('@netlify/blobs/package.json').engines.node.match(/(\d+)/)[1])<=22,'Node 22 is enough for the storage part');
});

test('the reminder functions are real function files, and a schedule is only set where it should be',()=>{
  const fs=require('node:fs');
  for(const f of ['push-subscribe.mjs','push-send.mjs'])assert.ok(fs.existsSync(path.join(dir,f)),f);
  const nested=path.join(__dirname,'..','LIFE_AI_v6_2_QNET_LIVE_FIXED (3)','life_ai_v6_2','netlify','functions');
  for(const f of ['push-subscribe.mjs','push-send.mjs','lib/push-core.js','lib/push-runtime.mjs'])assert.ok(fs.existsSync(path.join(nested,f)),'deployed copy has '+f);
  assert.doesNotMatch(fs.readFileSync(path.join(dir,'push-subscribe.mjs'),'utf8'),/schedule/,'only the sender runs on a schedule');
});
