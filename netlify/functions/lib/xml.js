// Small XML helpers shared by the server functions (work24-jobs.js, qnet-schedule.js).
// Reads the first <tag>...</tag> in `block`. The tag may carry attributes (<tag a="1">) and
// its text may be wrapped in CDATA. Returns '' when the tag is missing.
function xmlText(block, tag){
  const m = String(block||'').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`,'i'));
  return m ? m[1].trim().replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'').trim() : '';
}
function decodeXml(s){
  return String(s||'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
module.exports = { xmlText, decodeXml };
