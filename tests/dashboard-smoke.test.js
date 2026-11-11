const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
test('inline application JavaScript parses',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
  assert.ok(scripts.length>0,'expected inline app script');
  scripts.forEach((script,i)=>assert.doesNotThrow(()=>new vm.Script(script,{filename:'index-script-'+i+'.js'})));
});
test('modern blue dashboard and navigation targets exist',()=>{
  for(const id of ['home','my','goals','calendar','jobHub','cert','liveJobs','bottomnav']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const marker of ['dashboard-stats','dashboard-grid','exportLifeAIBackup','importLifeAIBackup','liveJobsRequestVersion']){
    assert.ok(html.includes(marker),marker);
  }
});
