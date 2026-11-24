const {test}=require('node:test');
const assert=require('node:assert/strict');
/* #451 */
test('links with a user/password part (https://trusted@evil) are rejected by firstUrl and safeUrl',()=>{
  const {createApp}=require('./helpers/app-harness.js');
  const L=require('../logic.js');
  const bad=['https://www.saramin.co.kr@evil.example/job/1','https://a.com@b.com/','http://user:pw@b.com/'];
  const a=createApp();
  for(const u of bad){
    assert.equal(L.firstUrl('공고 '+u+' 입니다'),'',u);
    assert.equal(a.run('safeUrl('+JSON.stringify(u)+')'),'',u);
  }
  assert.equal(L.firstUrl('보세요 https://www.saramin.co.kr/job/1'),'https://www.saramin.co.kr/job/1');
  assert.equal(a.run("safeUrl('https://example.com/job/1?a=1')"),'https://example.com/job/1?a=1');
  assert.equal(L.parseShareParams('?url='+encodeURIComponent('https://a.com@b.com/')),null);
});

