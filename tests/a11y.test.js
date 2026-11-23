const {test}=require('node:test');
const assert=require('node:assert/strict');
const {html}=require('./helpers/app-harness.js');

/* ---------- form fields have names (candidate 283) ---------- */
test('every static form field has a connected label or an aria-label',()=>{
  const body=html.split('<script>')[0];
  const labelFor=new Set([...body.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m=>m[1]));
  const missing=[];
  for(const m of body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)){
    const attrs=m[2];
    if(/type="(hidden|checkbox|file)"/.test(attrs))continue;
    const id=(attrs.match(/\bid="([^"]+)"/)||[])[1];
    if(/aria-label="[^"]+"/.test(attrs)||(id&&labelFor.has(id)))continue;
    missing.push(id||m[0].slice(0,60));
  }
  assert.deepEqual(missing,[]);
});

test('the four profile labels point at their fields',()=>{
  for(const id of ['employmentStatus','careerInput','educationInput','certOwnedInput']){
    assert.match(html,new RegExp(`<label for="${id}">[^<]+</label><(input|select) id="${id}"`));
  }
});
