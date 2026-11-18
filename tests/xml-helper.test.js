const {test}=require('node:test');
const assert=require('node:assert/strict');
const {xmlText,decodeXml}=require('../netlify/functions/lib/xml');

test('xmlText reads plain tags, tags with attributes and CDATA text',()=>{
  assert.equal(xmlText('<a><title>설비</title></a>','title'),'설비');
  assert.equal(xmlText('<a><title lang="ko">설비</title></a>','title'),'설비');
  assert.equal(xmlText('<title><![CDATA[ A & B ]]></title>','title'),'A & B');
  assert.equal(xmlText('<title> <![CDATA[A]]> </title>','title'),'A');
  assert.equal(xmlText('<a></a>','title'),'');
  assert.equal(xmlText(null,'title'),'');
});

test('xmlText does not confuse a tag with a longer tag name',()=>{
  assert.equal(xmlText('<titleExtra>x</titleExtra>','title'),'');
});

test('decodeXml decodes the common entities',()=>{
  assert.equal(decodeXml('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;'),'A & B <C> "D" \'E\'');
  assert.equal(decodeXml(undefined),'');
});

test('both server functions use the shared XML helper',()=>{
  const fs=require('node:fs');
  for(const f of ['work24-jobs.js','qnet-schedule.js']){
    const src=fs.readFileSync(require('node:path').join(__dirname,'..','netlify','functions',f),'utf8');
    assert.match(src,/require\('\.\/lib\/xml'\)/,f);
    assert.doesNotMatch(src,/function xmlText|function decodeXml/,f+' has no private copy');
  }
});
