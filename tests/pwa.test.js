const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('manifest.json'));
const html=read('index.html');

function pngSize(file){
  const buf=fs.readFileSync(path.join(root,file));
  assert.equal(buf.slice(1,4).toString('ascii'),'PNG',file+' is a PNG');
  return [buf.readUInt32BE(16),buf.readUInt32BE(20)];
}

test('manifest has installable icons whose real sizes match what it declares',()=>{
  assert.equal(manifest.short_name,'life-ai');
  assert.equal(manifest.display,'standalone');
  assert.ok(manifest.icons.some(i=>i.purpose==='maskable'),'maskable icon');
  for(const icon of manifest.icons){
    const [w,h]=icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src),[w,h],icon.src);
  }
  assert.ok(manifest.icons.some(i=>i.sizes==='192x192')&&manifest.icons.some(i=>i.sizes==='512x512'));
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'),[180,180]);
});

test('theme color is the same in the page and the manifest',()=>{
  const meta=html.match(/<meta name="theme-color" content="([^"]+)"/)[1];
  assert.equal(meta,manifest.theme_color);
});

test('page links the manifest, icons and registers the service worker only on https/localhost',()=>{
  assert.match(html,/<link rel="manifest" href="manifest\.json"/);
  assert.match(html,/rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html,/navigator\.serviceWorker\.register\('sw\.js'\)/);
  assert.match(html,/location\.protocol==='https:'\|\|location\.hostname==='localhost'/);
});

function loadWorker(){
  const handlers={};
  const cache=new Map();
  const added=[];
  const self={location:{origin:'https://app.example'},addEventListener:(type,fn)=>{handlers[type]=fn;},clients:{claim:async()=>{},matchAll:async()=>self.__clients,openWindow:async url=>{self.__opened=url;}},skipWaiting:async()=>{}};
  const caches={
    open:async()=>({add:async url=>{added.push(url);cache.set(url,{url});},put:async(req,res)=>{cache.set(req.url,res);}}),
    match:async(req)=>{const key=typeof req==='string'?req:req.url;return cache.get(key)||cache.get(key.replace('https://app.example/',''))||null;},
    keys:async()=>['old-cache','life-ai-shell-v1'],
    delete:async()=>true
  };
  const context={self,caches,URL,Response:{error:()=>'ERR'},fetch:async()=>{throw new Error('offline');}};
  vm.createContext(context);
  vm.runInContext(read('sw.js'),context);
  return {handlers,cache,added,self,context};
}

test('service worker caches every file it lists and those files exist',async()=>{
  const sw=loadWorker();
  let finished;
  sw.handlers.install({waitUntil:p=>{finished=p;}});
  await finished;
  assert.ok(sw.added.length>=6);
  for(const url of sw.added){
    if(url==='./')continue;
    assert.ok(fs.existsSync(path.join(root,url)),url+' exists');
  }
  assert.ok(sw.added.includes('logic.js'),'logic.js is needed offline');
});

test('service worker ignores live data requests and other origins',()=>{
  const sw=loadWorker();
  const call=url=>{let handled=false;sw.handlers.fetch({request:{method:'GET',url,mode:'cors'},respondWith:()=>{handled=true;}});return handled;};
  assert.equal(call('https://app.example/.netlify/functions/qnet-schedule?name=x'),false);
  assert.equal(call('https://other.example/index.html'),false);
  assert.equal(call('https://app.example/index.html'),true);
  let postHandled=false;
  sw.handlers.fetch({request:{method:'POST',url:'https://app.example/index.html'},respondWith:()=>{postHandled=true;}});
  assert.equal(postHandled,false);
});

test('service worker opens the cached app when offline',async()=>{
  const sw=loadWorker();
  sw.cache.set('index.html',{marker:'cached-index'});
  let response;
  sw.handlers.fetch({request:{method:'GET',url:'https://app.example/some/page',mode:'navigate'},respondWith:p=>{response=p;}});
  assert.deepEqual(await response,{marker:'cached-index'});
});

test('tapping the notification focuses an open window or opens the calendar',async()=>{
  const sw=loadWorker();
  let focused=false,closed=false,wait;
  sw.self.__clients=[{focus:async()=>{focused=true;}}];
  sw.handlers.notificationclick({notification:{close:()=>{closed=true;}},waitUntil:p=>{wait=p;}});
  await wait;
  assert.ok(closed&&focused);
  const none=loadWorker();none.self.__clients=[];
  none.handlers.notificationclick({notification:{close(){}},waitUntil:p=>{wait=p;}});
  await wait;
  assert.equal(none.self.__opened,'./index.html?screen=calendar');
});
