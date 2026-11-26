const CACHE='korazol-shell-v35';
const DATA_CACHE='korazol-data-v1';
const SHELL=['./','./push-client-v5.js','./notifications-custom-v1.js','./account-v1.js','./account-config.json','./match-feed-v2.js','./match-detail-feed-v2.js','./match-extras-v1.js','./match-pulse-v1.js','./match-center-v1.js','./team-feed-v1.js','./league-feed-v1.js','./index.html','./fixtures.html','./match-details.html','./team-details.html','./champions.html','./league-details.html','./lineup-v2.html','./manifest.webmanifest','./kora-zol-icon-192.png','./kora-zol-icon-512.png'];
const shellPage=path=>['match-details.html','team-details.html','champions.html','league-details.html','fixtures.html','lineup-v2.html'].find(page=>path.endsWith('/'+page))||'index.html';
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
 self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('korazol-')&&![CACHE,DATA_CACHE].includes(key)).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 // Notification scripts and configuration must not be pinned to a stale shell.
  if(/\/(?:push-client|notifications-custom|account|match-feed|match-detail-feed|match-extras|match-pulse|match-center|team-feed|league-feed)(?:-v\d+)?\.js$/.test(url.pathname)||url.pathname.endsWith('/push-config.json')){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   try{const response=await fetch(request,{cache:'no-cache'});if(response.ok){event.waitUntil(cache.put(request,response.clone()));return response;}}
   catch(e){}
   return await cache.match(request)||Response.error();
  })());
  return;
 }
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request,{cache:'no-cache'});
    if(response.ok){const cache=await caches.open(CACHE);event.waitUntil(cache.put('./'+shellPage(url.pathname),response.clone()));}
    return response;
   }catch(e){
    const cache=await caches.open(CACHE);
    const page='./'+shellPage(url.pathname);
    return await cache.match(page)||Response.error();
   }
  })());
  return;
 }
 if(url.pathname.includes('/data/')&&url.pathname.endsWith('.json')){
  event.respondWith((async()=>{
   const cache=await caches.open(DATA_CACHE);
   const key=new Request(url.origin+url.pathname);
   try{
    const response=await fetch(request);
    if(response.ok)event.waitUntil(cache.put(key,response.clone()));
    return response;
   }catch(e){return await cache.match(key)||Response.error()}
  })());
  return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const key=new Request(url.origin+url.pathname);
  const cached=await cache.match(key);
  if(cached)return cached;
  try{
   const response=await fetch(request);
   if(response.ok&&['style','script','image','font'].includes(request.destination))event.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch(e){return Response.error()}
 })());
});


// The browser starts this worker even when the installed PWA is closed.
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let message={};
  try{message=event.data?.json()||{}}catch{}
  const title=typeof message.title==='string'?message.title.slice(0,160):'كورة زول';
  const body=typeof message.body==='string'?message.body.slice(0,300):'عندك تنبيه جديد من كورة زول';
  const scope=new URL(self.registration.scope);
  let target=scope.href;
  try{const url=new URL(message.url||scope.href,scope);if(url.origin===scope.origin&&url.pathname.startsWith(scope.pathname))target=url.href}catch{}
  await self.registration.showNotification(title,{
   body,icon:typeof message.image==='string'&&message.image.length<=400&&/^https:\/\/img\.thesports\.com\/football\/(?:player|team)\/[a-z0-9._/%-]+$/i.test(message.image)?message.image:new URL('kora-zol-icon-192.png',scope).href,
   tag:typeof message.tag==='string'?message.tag.slice(0,160):'korazol-alert',
   data:{url:target},vibrate:[200,100,200],timestamp:Date.now()
  });
 })());
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=event.notification.data?.url||'./index.html';
 event.waitUntil((async()=>{
  const url=new URL(target,self.registration.scope);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>client.url===url.href);
  if(existing){await existing.focus();return}
  await clients.openWindow(url.href);
 })());
});


