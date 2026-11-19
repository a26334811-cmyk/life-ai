const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,html}=require('./helpers/app-harness.js');

/* #212: real-data screens must not look like demos, and the test-question card is gone. */
const section=id=>html.match(new RegExp('<section id="'+id+'"[\\s\\S]*?</section>'))[0];

test('the Q-Net certificate screen has no DEMO tag',()=>{
  assert.doesNotMatch(section('cert'),/DEMO/);
});

test('company choice labels the sample company as "예시", not "DEMO 선택지"',()=>{
  const company=section('company');
  assert.doesNotMatch(company,/DEMO 선택지/);
  assert.match(company,/<strong>포스코<\/strong><div class="meta">예시<\/div>/);
});

test('the MY screen no longer shows the "things to think about while testing" questions',()=>{
  const a=createApp();
  a.run('renderMy()');
  const out=a.el('myContent').innerHTML;
  assert.doesNotMatch(out,/테스트하면서 생각해볼 것/);
  assert.doesNotMatch(out,/무슨 앱인지 알겠나요/);
  assert.match(out,/처음부터 다시 시작/);
});
