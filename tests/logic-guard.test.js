const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const real=require('../logic.js');
const later=()=>new Promise(r=>setImmediate(r));

/* Old saved logic.js + new page (bad network during an update): the page must repair itself instead of crashing. */
function runLogicGuard(logicApi,opts={}){
  const guard=html.match(/<script id="logic-guard">([\s\S]*?)<\/script>/)[1];
  const store=new Map(opts.reloadedBefore?[['lifeAILogicReload','1']]:[]);
  const log={reloads:0,deleted:[]};
  const context={
    sessionStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    location:{reload:()=>{log.reloads++;}},
    caches:{
      keys:async()=>{if(opts.failCaches)throw new Error('no caches');return ['life-ai-shell-v1','other'];},
      open:async name=>({delete:async(url,o)=>{log.deleted.push([name,url,o.ignoreSearch]);return true;}})
    }
  };
  if(logicApi!==undefined)context.LifeLogic=logicApi;
  vm.createContext(context);
  vm.runInContext(guard,context);
  return {log,store};
}
const usedLogic=[...new Set([...html.matchAll(/LifeLogic\.([A-Za-z_]+)/g)].map(m=>m[1]))];
const oldLogic=()=>{const old={...real};delete old.backupNudge;return old;};

test('logic guard lists every LifeLogic function the page uses, and the real logic.js has them all',()=>{
  const guard=html.match(/<script id="logic-guard">([\s\S]*?)<\/script>/)[1];
  const listed=[...guard.match(/var need=\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  assert.deepEqual([...listed].sort(),[...usedLogic].sort());
  for(const name of listed)assert.notEqual(real[name],undefined,name);
});

test('logic guard does nothing when logic.js matches the page',async()=>{
  const {log}=runLogicGuard(real);
  await later();
  assert.equal(log.reloads,0);
  assert.deepEqual(log.deleted,[]);
});

test('old saved logic.js: guard drops the saved copy and reloads once',async()=>{
  const {log,store}=runLogicGuard(oldLogic());
  await later();
  assert.equal(log.reloads,1);
  assert.deepEqual(log.deleted,[['life-ai-shell-v1','logic.js',true],['other','logic.js',true]]);
  assert.equal(store.get('lifeAILogicReload'),'1');
});

test('guard still reloads when the cache cannot be read, and never loops',async()=>{
  const first=runLogicGuard(oldLogic(),{failCaches:true});
  await later();
  assert.equal(first.log.reloads,1);
  const second=runLogicGuard(oldLogic(),{reloadedBefore:true});
  await later();
  assert.equal(second.log.reloads,0,'already retried in this tab');
  const missing=runLogicGuard(undefined);
  await later();
  assert.equal(missing.log.reloads,1,'logic.js absent entirely');
});

test('a matching logic.js clears the retry flag so a later update can repair again',()=>{
  const {store}=runLogicGuard(real,{reloadedBefore:true});
  assert.equal(store.has('lifeAILogicReload'),false);
});

test('guard sits between logic.js and the app script',()=>{
  const a=html.indexOf('<script src="logic.js"></script>'),b=html.indexOf('<script id="logic-guard">'),c=html.indexOf('<script>\n');
  assert.ok(a>=0&&a<b&&b<c);
});
