const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {check,sharedFiles}=require('../scripts/sync-nested.js');

const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
// Turns a link found in a file into a path inside the app folder, or null when it points somewhere else.
const local=link=>{
  const clean=String(link).split(/[?#]/)[0].replace(/^\.\//,'');
  if(!clean||/^([a-z]+:|\/\/)/i.test(clean)||clean.startsWith('/')) return null;
  return clean;
};
// Every file the running app asks for, read from the app's own files instead of a hand-written list.
function neededFiles(){
  const html=read('index.html');
  const needed=new Map(); // file -> where it is mentioned
  const add=(file,where)=>{const rel=local(file);if(rel&&!needed.has(rel))needed.set(rel,where);};
  for(const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) add(m[1],'index.html <script src>');
  for(const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) add(m[1],'index.html <link href>');
  for(const m of html.matchAll(/serviceWorker\.register\('([^']+)'/g)) add(m[1],'index.html serviceWorker.register');
  for(const m of html.matchAll(/\/\.netlify\/functions\/([\w-]+)/g)){const ext=['.js','.mjs'].find(e=>fs.existsSync(path.join(root,'netlify/functions/'+m[1]+e)))||'.js';add('netlify/functions/'+m[1]+ext,'index.html fetch of /.netlify/functions/'+m[1]);}
  const sw=read('sw.js');
  for(const name of ['CORE','OPTIONAL']){
    const list=sw.match(new RegExp('const '+name+'\\s*=\\s*\\[([^\\]]*)\\]'));
    assert.ok(list,'sw.js '+name+' list was not found; update this test if the list was renamed');
    for(const m of list[1].matchAll(/'([^']+)'/g)) add(m[1],'sw.js '+name);
  }
  const manifest=JSON.parse(read('manifest.json'));
  add(manifest.start_url,'manifest.json start_url');
  for(const icon of manifest.icons||[]) add(icon.src,'manifest.json icons');
  for(const shortcut of manifest.shortcuts||[]) add(shortcut.url,'manifest.json shortcuts');
  if(manifest.share_target) add(manifest.share_target.action,'manifest.json share_target');
  return needed;
}

test('nested deployment folder is an exact copy of the root app (run: node scripts/sync-nested.js)',()=>{
  assert.deepEqual(check(),[],'nested copy is stale; run "node scripts/sync-nested.js" and commit the result');
});

test('every file the app asks for is part of the synced set (read from the app, not a typed list)',()=>{
  const shared=sharedFiles();
  const needed=neededFiles();
  // Guard against the readers above silently finding nothing.
  for(const must of ['index.html','logic.js','sw.js','manifest.json']) assert.ok(needed.has(must),'reader did not find '+must);
  assert.ok([...needed.keys()].some(f=>f.startsWith('icons/')),'reader did not find any icon');
  assert.ok([...needed.keys()].some(f=>f.startsWith('netlify/functions/')),'reader did not find any function');
  const missing=[...needed].filter(([file])=>!shared.includes(file)).map(([file,where])=>file+'  (used by '+where+')');
  assert.deepEqual(missing,[],'these files are used by the app but missing from the copy to Netlify - add them to scripts/sync-nested.js (or create the file):');
});

test('files inside sub-folders of icons/ and netlify/functions/ (such as lib/xml.js) are copied too',()=>{
  // sync-nested.js copies sub-folders; a file that sits there but is missing from the copy would not reach Netlify.
  const shared=sharedFiles();
  const lost=[];
  for(const dir of ['icons','netlify/functions']){
    const walk=rel=>{
      for(const entry of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){
        if(entry.isDirectory()) walk(rel+'/'+entry.name);
        else if(rel!==dir&&!entry.name.endsWith('.test.js')&&!shared.includes(rel+'/'+entry.name)) lost.push(rel+'/'+entry.name);
      }
    };
    walk(dir);
  }
  assert.ok(shared.includes('netlify/functions/lib/xml.js'),'lib/xml.js is part of the copy');
  assert.deepEqual(lost,[],'these sub-folder files are not copied to the deployed copy; check scripts/sync-nested.js');
});
