import {buildPushPayload} from '@block65/webcrypto-web-push';
import {fromFixture, transitions, preferenceAllows, notificationFor} from './events.mjs';

const MINUTE = 60000, EVENT_TTL = 10 * MINUTE;
const eventTypes = ['goal','kickoff','fulltime'];
const tokenPattern = /^[a-f0-9-]{72}$/i;
const base64Pattern = /^[A-Za-z0-9_-]+$/;
const pushHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const encoder = new TextEncoder();
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const configured = env => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.DB);
async function feedHealthy(env){
  if(!env.API_FOOTBALL_KEY||!env.DB)return false;
  const record=await env.DB.prepare("SELECT value FROM service_state WHERE key='last_success'").first();
  return Boolean(record&&Date.now()-record.value<3*MINUTE);
}
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0,max) : ''; }
function validSubscription(sub) {
  try {
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return false;
    const url = new URL(sub.endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !pushHosts.has(url.hostname)) return false;
    const p = sub.keys?.p256dh, a = sub.keys?.auth;
    return typeof p === 'string' && p.length === 87 && base64Pattern.test(p) && typeof a === 'string' && a.length === 22 && base64Pattern.test(a);
  } catch { return false; }
}
function cleanPreferences(raw) {
  const teams = Array.isArray(raw?.teams) ? [...new Set(raw.teams.slice(0,100).map(x=>cleanText(x,100)).filter(Boolean))] : [];
  const matches = Array.isArray(raw?.matches) ? raw.matches.slice(0,100).flatMap(x=>{
    const id=cleanText(x?.id,100),home=cleanText(x?.home,100),away=cleanText(x?.away,100),date=cleanText(x?.date,45);
    return id && home && away && Number.isFinite(Date.parse(date)) ? [{id,home,away,date}] : [];
  }) : [];
  const types = Array.isArray(raw?.types) ? eventTypes.filter(t=>raw.types.includes(t)) : [];
  return {teams,matches,types,language:raw?.language === 'en'?'en':'ar'};
}
async function parseRequest(request) {
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>32768) throw Error('too_large');
  const reader=request.body?.getReader();
  if(!reader) throw Error('invalid_json');
  const chunks=[];let total=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>32768){await reader.cancel();throw Error('too_large')}chunks.push(value)}
  } finally {reader.releaseLock()}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function sendPush(env, subscription, message) {
  const payload = await buildPushPayload({data:JSON.stringify(message),options:{ttl:300}},subscription,{
    subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY
  });
  const response = await fetch(subscription.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(12000)});
  return response.status;
}
async function route(request, env) {
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
  if(origin!==env.APP_ORIGIN) return json({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS') return new Response(null,{status:204});
  if(path==='/config' && request.method==='GET') return json({enabled:configured(env),publicKey:configured(env)?env.VAPID_PUBLIC_KEY:null,liveEnabled:await feedHealthy(env)});
  if(request.method!=='POST' || !['/subscribe','/unsubscribe','/test'].includes(path)) return json({error:'not_found'},404);
  if(!configured(env)) return json({error:'not_configured'},503);
  let data;try{data=await parseRequest(request)}catch(e){return json({error:e.message==='too_large'?'too_large':'invalid_json'},400)}
  if(!data || !tokenPattern.test(data.token||'') || !validSubscription(data.subscription)) return json({error:'invalid_subscription'},400);
  const sub={endpoint:data.subscription.endpoint,expirationTime:null,keys:{p256dh:data.subscription.keys.p256dh,auth:data.subscription.keys.auth}};
  const id=await digest(sub.endpoint),tokenHash=await digest(data.token);
  const existing=await env.DB.prepare('SELECT token_hash, subscription, last_test FROM devices WHERE id=?').bind(id).first();
  if(existing && existing.token_hash!==tokenHash) return json({error:'device_conflict'},409);
  const now=Date.now();
  if(path==='/subscribe'){
    const preferences=cleanPreferences(data.preferences);
    const result=await env.DB.prepare('INSERT INTO devices(id,token_hash,subscription,preferences,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,preferences=excluded.preferences,updated=excluded.updated WHERE devices.token_hash=excluded.token_hash').bind(id,tokenHash,JSON.stringify(sub),JSON.stringify(preferences),now).run();
    if(result.meta?.changes===0) return json({error:'device_conflict'},409);
    return json({subscribed:true,liveEnabled:await feedHealthy(env)});
  }
  if(path==='/unsubscribe'){
    await env.DB.prepare('DELETE FROM devices WHERE id=? AND token_hash=?').bind(id,tokenHash).run();
    return json({subscribed:false});
  }
  if(!existing) return json({error:'not_subscribed'},404);
  const reserved=await env.DB.prepare('UPDATE devices SET last_test=?,test_due=? WHERE id=? AND token_hash=? AND last_test<?').bind(now,now+8000,id,tokenHash,now-MINUTE).run();
  if(!reserved.meta?.changes) return json({error:'test_rate_limited'},429);
  return json({scheduled:true},202);
}
async function sendTests(env,now){
  const {results}=await env.DB.prepare('SELECT id,subscription,preferences,test_due FROM devices WHERE test_due>0 AND test_due<=?').bind(now).all();
  for(const row of results){
    if(now-row.test_due>EVENT_TTL){await env.DB.prepare('UPDATE devices SET test_due=0 WHERE id=? AND test_due=?').bind(row.id,row.test_due).run();continue}
    const ar=JSON.parse(row.preferences).language!=='en';
    const message={title:ar?'⚽ كورة زول | تجربة الإشعار':'⚽ Kora Zol | Test notification',body:ar?'دا إشعار تجريبي من سيرفر كورة زول.':'This is a test notification from the Kora Zol server.',tag:'korazol-test-'+row.test_due,url:env.APP_URL};
    try{
      const status=await sendPush(env,JSON.parse(row.subscription),message);
      if(status>=200&&status<300)await env.DB.prepare('UPDATE devices SET test_due=0 WHERE id=? AND test_due=?').bind(row.id,row.test_due).run();
      else if(status===404||status===410)await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(row.id).run();
    }catch{console.warn('Test push not accepted; it will retry.')}
  }
}
async function fixtures(env, day) {
  const url=new URL('https://v3.football.api-sports.io/fixtures');
  url.searchParams.set('date',day);url.searchParams.set('timezone','UTC');
  const response=await fetch(url,{headers:{'x-apisports-key':env.API_FOOTBALL_KEY,'Accept':'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw Error('football_http_'+response.status);
  const data=await response.json();
  if(!Array.isArray(data.response)||Object.keys(data.errors||{}).length)throw Error('football_provider_error');
  return data.response.map(fromFixture).filter(Boolean);
}
async function pollMatches(env, now) {
  const devices=await env.DB.prepare('SELECT id,subscription,preferences,updated FROM devices').all();
  const active=devices.results.map(row=>({...row,preferences:JSON.parse(row.preferences)})).filter(d=>d.preferences.types.length&&(d.preferences.teams.length||d.preferences.matches.length));
  if(!active.length) return;
  if(env.API_FOOTBALL_KEY){
    const current=new Date(now),dates=[current.toISOString().slice(0,10)];
    if(current.getUTCHours()<4)dates.push(new Date(now-86400000).toISOString().slice(0,10));
    const results=await Promise.allSettled(dates.map(day=>fixtures(env,day)));
    const matches=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    if(results.every(r=>r.status==='rejected'))console.warn('Football provider is unavailable; existing state retained.');
    else await env.DB.prepare("INSERT INTO service_state(key,value) VALUES('last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now).run();
    // Only monitor matches relevant to subscribers. Comparing the old state prevents
    // replaying historical scores on the first poll or after a long provider outage.
    const {results:previous}=await env.DB.prepare('SELECT fixture_id,match_json,revision,updated FROM match_state WHERE updated>?').bind(now-86400000).all();
    const old=new Map(previous.map(r=>[r.fixture_id,r]));
    for(const match of matches){
      if(!active.some(d=>preferenceAllows(d.preferences,{type:'goal-home',match})||preferenceAllows(d.preferences,{type:'kickoff',match})||preferenceAllows(d.preferences,{type:'fulltime',match})))continue;
      const row=old.get(match.id),prior=row?JSON.parse(row.match_json):null;
      const kinds=row&&now-row.updated<=EVENT_TTL?transitions(prior,match):[];
      const revision=(row?.revision||0)+(kinds.length?1:0);
      const statements=[env.DB.prepare('INSERT INTO match_state(fixture_id,match_json,revision,updated) VALUES(?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET match_json=excluded.match_json,revision=excluded.revision,updated=excluded.updated WHERE match_state.updated<excluded.updated').bind(match.id,JSON.stringify(match),revision,now)];
      for(const kind of kinds){const event={id:match.id+':'+revision+':'+kind,type:kind,match};statements.push(env.DB.prepare('INSERT OR IGNORE INTO events(id,event_json,created) VALUES(?,?,?)').bind(event.id,JSON.stringify(event),now))}
      await env.DB.batch(statements);
    }
  }
  const {results:events}=await env.DB.prepare('SELECT id,event_json,created FROM events WHERE created>? ORDER BY created').bind(now-EVENT_TTL).all();
  for(const row of events){
    const event=JSON.parse(row.event_json);
    const {results:sent}=await env.DB.prepare('SELECT device_id FROM deliveries WHERE event_id=?').bind(row.id).all();
    const delivered=new Set(sent.map(d=>d.device_id));
    for(const d of active){
      if(d.updated>row.created||delivered.has(d.id)||!preferenceAllows(d.preferences,event))continue;
      try{
        const status=await sendPush(env,JSON.parse(d.subscription),notificationFor(event,d.preferences.language,env.APP_URL));
        if(status>=200&&status<300)await env.DB.prepare('INSERT OR IGNORE INTO deliveries(event_id,device_id,sent) VALUES(?,?,?)').bind(row.id,d.id,now).run();
        else if(status===404||status===410)await env.DB.prepare('DELETE FROM devices WHERE id=?').bind(d.id).run();
      }catch{console.warn('Push provider unavailable; event will retry.')}
    }
  }
  if(new Date(now).getUTCMinutes()===0)await env.DB.batch([
    env.DB.prepare('DELETE FROM deliveries WHERE sent<?').bind(now-86400000),
    env.DB.prepare('DELETE FROM events WHERE created<?').bind(now-86400000),
    env.DB.prepare('DELETE FROM match_state WHERE updated<?').bind(now-3*86400000)
  ]);
}
export default {
  async fetch(request,env){
    let response;
    try{response=await route(request,env)}catch{response=json({error:'server_error'},500)}
    if(request.headers.get('origin')===env.APP_ORIGIN){
      response.headers.set('access-control-allow-origin',env.APP_ORIGIN);
      response.headers.set('access-control-allow-methods','GET, POST, OPTIONS');
      response.headers.set('access-control-allow-headers','content-type');
      response.headers.set('vary','Origin');
    }
    return response;
  },
  scheduled(controller,env,ctx){if(configured(env))ctx.waitUntil((async()=>{await sendTests(env,controller.scheduledTime);await pollMatches(env,controller.scheduledTime)})().catch(()=>console.error('Push poll failed; saved state retained.')));}
};
