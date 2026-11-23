const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

const root=path.join(__dirname,'..');
// git check-ignore exits 0 when the path is ignored, 1 when it is not.
const ignored=file=>spawnSync('git',['check-ignore','-q','--no-index',file],{cwd:root}).status===0;

test('the public repo ignores key files, install folders and personal backups',()=>{
  for(const f of ['.env','.env.local','.env.production','.netlify/state.json','node_modules/x/index.js','life-ai-backup-2026-05-10.json']){
    assert.equal(ignored(f),true,f+' should be ignored');
  }
});

test('the key guide file and the app files are not ignored',()=>{
  for(const f of ['.env.example','index.html','logic.js','tests/a11y.test.js','netlify/functions/qnet-schedule.js']){
    assert.equal(ignored(f),false,f+' should be tracked');
  }
});
