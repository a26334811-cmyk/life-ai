const {test}=require('node:test');
const assert=require('node:assert/strict');
const {check,sharedFiles}=require('../scripts/sync-nested.js');

test('nested deployment folder is an exact copy of the root app (run: node scripts/sync-nested.js)',()=>{
  assert.deepEqual(check(),[],'nested copy is stale; run "node scripts/sync-nested.js" and commit the result');
});

test('every file the app needs offline is part of the synced set',()=>{
  const shared=sharedFiles();
  for(const needed of ['index.html','logic.js','sw.js','manifest.json','netlify.toml','icons/icon-192.png','icons/icon-512.png','netlify/functions/qnet-schedule.js','netlify/functions/work24-jobs.js']){
    assert.ok(shared.includes(needed),needed);
  }
});
