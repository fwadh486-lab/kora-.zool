const CACHE='korazol-shell-v9';
const DATA_CACHE='korazol-data-v1';
const SHELL=['./','./index.html','./fixtures.html','./match-details.html','./manifest.webmanifest','./kora-zol-icon-192.png','./kora-zol-icon-512.png'];
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
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    if(response.ok){const cache=await caches.open(CACHE);event.waitUntil(cache.put(url.pathname.endsWith('/match-details.html')?'./match-details.html':url.pathname.endsWith('/fixtures.html')?'./fixtures.html':'./index.html',response.clone()));}
    return response;
   }catch(e){
    const cache=await caches.open(CACHE);
    const page=url.pathname.endsWith('/match-details.html')?'./match-details.html':url.pathname.endsWith('/fixtures.html')?'./fixtures.html':'./index.html';
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

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=event.notification.data?.url||'./index.html';
 event.waitUntil((async()=>{
  const url=new URL(target,self.registration.scope);
  if(url.origin!==self.location.origin)return;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>client.url===url.href);
  if(existing){await existing.focus();return}
  await clients.openWindow(url.href);
 })());
});
