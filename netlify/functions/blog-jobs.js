const {parseXml,text,safeUrl,reply,readText,failure}=require('./lib/job-data');
const FEED='https://rss.blog.naver.com/dodam852.xml';
let cached;
exports.handler=async event=>{
  const keyword=(event.queryStringParameters?.keyword||'').trim().slice(0,120);
  try {
    if(!cached || cached.expires<Date.now()) {
      const response=await fetch(FEED,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('UPSTREAM_ERROR');
      const rss=parseXml(await readText(response),'rss');
      if(!rss.channel || typeof rss.channel!=='object')throw new Error('INVALID_RESPONSE');
      const raw=rss.channel.item;
      const posts=raw===undefined?[]:Array.isArray(raw)?raw:[raw];
      const items=posts.map(post=>{
        const url=safeUrl(text(post.link));
        if(!url || !/^https:\/\/(?:m\.)?blog\.naver\.com\/dodam852\/\d+(?:\?|$)/.test(url))return null;
        const date=new Date(text(post.pubDate));
        return {id:url.split('?')[0],title:text(post.title),company:'',region:'',career:'',regDt:'',closeDt:'',publishedAt:Number.isFinite(date.getTime())?date.toISOString():'',url,source:'취업왕김백수 · 네이버 블로그',kind:'blog'};
      }).filter(item=>item?.title).slice(0,50);
      if(posts.length && !items.length)throw new Error('INVALID_RESPONSE');
      cached={expires:Date.now()+600000,data:{source:'취업왕김백수 · 네이버 블로그',mode:'rss',fetchedAt:new Date().toISOString(),items}};
    }
    const words=keyword.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return reply(200,{...cached.data,items:cached.data.items.filter(x=>words.every(word=>x.title.toLocaleLowerCase().includes(word)))});
  }catch(error){return failure(error);}
};
