const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const toml=fs.readFileSync(path.join(__dirname,'..','netlify.toml'),'utf8');

// Minimal reader for the [[redirects]] blocks of netlify.toml.
function redirects(){
  return toml.split('[[redirects]]').slice(1).map(block=>{
    const get=key=>(block.match(new RegExp('^\\s*'+key+'\\s*=\\s*"?([^"\\r\\n]+)"?','m'))||[])[1];
    return {from:get('from'),to:get('to'),status:Number(get('status')),force:get('force')==='true'};
  });
}

test('netlify.toml hides project files that are not part of the app screen',()=>{
  const hidden=new Map(redirects().map(r=>[r.from,r]));
  for(const from of ['/tests/*','/scripts/*','/docs/*','/netlify/*','/node_modules/*','/.git/*','/.env','/.env.example','/package.json','/package-lock.json']){
    const rule=hidden.get(from);
    assert.ok(rule,from+' is blocked');
    assert.equal(rule.status,404,from);
    assert.equal(rule.force,true,from+' must be forced, because the real file exists');
  }
});

test('blocking rules do not hide the app, its icons or the server functions',()=>{
  const froms=redirects().map(r=>r.from);
  assert.ok(froms.length>0);
  for(const needed of ['/','/index.html','/logic.js','/sw.js','/manifest.json','/icons/icon-192.png','/.netlify/functions/work24-jobs']){
    for(const from of froms){
      const matches=from.endsWith('/*')?needed.startsWith(from.slice(0,-1)):needed===from;
      assert.equal(matches,false,needed+' is hidden by '+from);
    }
  }
});
