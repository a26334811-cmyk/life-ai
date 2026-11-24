const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app-harness.js');

const status=a=>a.el('postingFetchStatus').textContent;
const unreadable=/이 링크는 읽지 못했어요/;
const offlineText=/지금은 링크를 읽을 수 없어요/;

/* A fetch whose answers are handed out later by the test, one per call. */
function manualFetch(){
  const pending=[];
  const fetch=url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}));
  return {fetch,pending};
}
const json=body=>({ok:true,json:async()=>body});
const tick=()=>new Promise(r=>setImmediate(r));

test('an error page that is not JSON gives the plain "could not read" message and frees the button',async()=>{
  const badGateway=createApp(undefined,{fetch:async()=>({ok:false,status:502,json:async()=>{throw new SyntaxError('Unexpected token < in JSON');}})});
  badGateway.el('postingUrl').value='https://example.com/a';badGateway.el('postingTitle').value='내 제목';
  await badGateway.run('fillPostingFromUrl()');
  assert.match(status(badGateway),unreadable);
  assert.doesNotMatch(status(badGateway),/SyntaxError|Unexpected token/);
  assert.equal(badGateway.el('postingTitle').value,'내 제목');
  assert.equal(badGateway.el('postingFetch').disabled,false);
  // A 200 response whose body is HTML is the same failure.
  const htmlOk=createApp(undefined,{fetch:async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token <');}})});
  htmlOk.el('postingUrl').value='https://example.com/b';
  await htmlOk.run('fillPostingFromUrl()');
  assert.match(status(htmlOk),unreadable);
  assert.equal(htmlOk.el('postingFetch').disabled,false);
  assert.equal(htmlOk.el('postingTitle').value,'');
});

test('a timeout or an aborted request tells the user to check the connection and frees the button',async()=>{
  for(const name of ['TimeoutError','AbortError']){
    const a=createApp(undefined,{fetch:async()=>{const e=new Error('The operation timed out');e.name=name;throw e;}});
    a.el('postingUrl').value='https://example.com/slow';
    await a.run('fillPostingFromUrl()');
    assert.match(status(a),offlineText,name);
    assert.equal(a.el('postingFetch').disabled,false,name);
  }
});

test('the link request carries an abort signal so it can time out',async()=>{
  let options;
  const a=createApp(undefined,{fetch:async(url,o)=>{options=o;return json({ok:true,title:'정비',description:''});}});
  a.el('postingUrl').value='https://example.com/c';
  await a.run('fillPostingFromUrl()');
  assert.ok(options&&options.signal instanceof AbortSignal);
});

test('an older answer that arrives after the link was changed does not touch the form',async()=>{
  const {fetch,pending}=manualFetch();
  const a=createApp(undefined,{fetch});
  const run=()=>a.run('fillPostingFromUrl()');
  a.el('postingUrl').value='https://example.com/first';
  const first=run();
  a.el('postingUrl').value='https://example.com/second';
  const second=run();
  assert.equal(pending.length,2);
  assert.equal(a.el('postingFetch').disabled,true);
  // The second request finishes first.
  pending[1].resolve(json({ok:true,title:'두번째 공고',deadline:'2099-01-01',description:''}));
  await second;
  assert.equal(a.el('postingTitle').value,'두번째 공고');
  assert.equal(a.el('postingFetch').disabled,false,'button is usable again');
  const message=status(a);
  // The first one arrives late, with a company the second one did not have.
  pending[0].resolve(json({ok:true,title:'첫번째 공고',company:'옛 회사',region:'옛 지역',description:''}));
  await first;
  assert.equal(a.el('postingTitle').value,'두번째 공고');
  assert.equal(a.el('postingCompany').value,'','late answer must not fill the form');
  assert.equal(a.el('postingRegion').value,'');
  assert.equal(status(a),message,'late answer must not replace the message');
  assert.equal(a.el('postingFetch').disabled,false);
});

test('a late failure of an older request does not replace the newer result or lock the button',async()=>{
  const {fetch,pending}=manualFetch();
  const a=createApp(undefined,{fetch});
  a.el('postingUrl').value='https://example.com/first';
  const first=a.run('fillPostingFromUrl()');
  a.el('postingUrl').value='https://example.com/second';
  const second=a.run('fillPostingFromUrl()');
  pending[1].resolve(json({ok:true,title:'새 공고',description:''}));
  await second;
  const message=status(a);
  const timeout=new Error('timed out');timeout.name='TimeoutError';
  pending[0].reject(timeout);
  await first;
  assert.equal(status(a),message);
  assert.doesNotMatch(status(a),offlineText);
  assert.equal(a.el('postingFetch').disabled,false);
});

test('while the newer request is still running, an older answer neither fills the form nor frees the button',async()=>{
  const {fetch,pending}=manualFetch();
  const a=createApp(undefined,{fetch});
  a.el('postingUrl').value='https://example.com/first';
  const first=a.run('fillPostingFromUrl()');
  a.el('postingUrl').value='https://example.com/second';
  const second=a.run('fillPostingFromUrl()');
  pending[0].resolve(json({ok:true,title:'옛 공고',company:'옛 회사',description:''}));
  await first;await tick();
  assert.equal(a.el('postingTitle').value,'');
  assert.equal(a.el('postingCompany').value,'');
  assert.equal(a.el('postingFetch').disabled,true,'the newer request is still running');
  assert.match(status(a),/읽는 중/);
  pending[1].resolve(json({ok:true,title:'새 공고',description:''}));
  await second;
  assert.equal(a.el('postingTitle').value,'새 공고');
  assert.equal(a.el('postingFetch').disabled,false);
});
