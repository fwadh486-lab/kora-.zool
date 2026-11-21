import {buildPushPayload} from '@block65/webcrypto-web-push';
import {fromFixture, transitions, newCards, selectedBy, preferenceAllows, notificationFor} from './events.mjs';
import {collectSportScore,publicFixtures,publicMatchDetails,publicPlayerPhoto} from './sportscore.mjs';
import {nativeConfigured,nativeConfigStatus,probeNativeAuthorization,sendNative} from './fcm.mjs';

const MINUTE = 60000, EVENT_TTL = 10 * MINUTE;
const eventTypes = ['goal','kickoff','halftime','fulltime','yellow','red'];
const tokenPattern = /^[a-f0-9-]{72}$/i;
const base64Pattern = /^[A-Za-z0-9_-]+$/;
const pushHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const encoder = new TextEncoder();
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const configured = env => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.DB);
const appOrigin = 'https://fwadh486-lab.github.io';
const appUrl = appOrigin+'/kora-.zool/';
function withAppDefaults(env){return {...env,APP_ORIGIN:env.APP_ORIGIN||appOrigin,APP_URL:env.APP_URL||appUrl}}
// The dashboard-only deployment cannot provision secrets from its code editor.
// Generate the signing key once inside the Worker; store it only in the private D1 database.
// Existing secret bindings always take precedence and are never rotated.
async function withSigningKeys(env){
  if(configured(env)||!env.DB)return env;
  if(env.VAPID_PUBLIC_KEY||env.VAPID_PRIVATE_KEY)throw Error('partial_vapid_configuration');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY CHECK(id=1), public_key TEXT NOT NULL, private_key TEXT NOT NULL)').run();
  let row=await env.DB.prepare('SELECT public_key,private_key FROM push_keys WHERE id=1').first();
  if(!row){
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const raw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
    const publicKey=btoa(String.fromCharCode(...raw)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const privateKey=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d;
    await env.DB.prepare('INSERT OR IGNORE INTO push_keys(id,public_key,private_key) VALUES(1,?,?)').bind(publicKey,privateKey).run();
    row=await env.DB.prepare('SELECT public_key,private_key FROM push_keys WHERE id=1').first();
  }
  return {...env,VAPID_PUBLIC_KEY:row.public_key,VAPID_PRIVATE_KEY:row.private_key,VAPID_SUBJECT:env.VAPID_SUBJECT||env.APP_URL};
}
async function feedHealthy(env){
  if((!env.API_FOOTBALL_KEY&&env.SPORTSCORE_ENABLED!=='true')||!env.DB)return false;
  const record=await env.DB.prepare('SELECT value FROM service_state WHERE key=?').bind(env.SPORTSCORE_ENABLED==='true'?'sportscore_last_success':'last_success').first();
  return Boolean(record&&Date.now()-record.value<3*MINUTE);
}
async function feedStatus(env){
  const liveEnabled=await feedHealthy(env);
  if(env.SPORTSCORE_ENABLED!=='true'||!env.DB)return {liveEnabled};
  const row=await env.DB.prepare("SELECT value FROM service_state WHERE key='sportscore_last_success'").first();
  const count=await env.DB.prepare("SELECT value FROM service_state WHERE key='sportscore_live_count'").first();
  const detail=await env.DB.prepare("SELECT value FROM service_state WHERE key='sportscore_detail_count'").first();
  return {liveEnabled,liveSource:'SportScore',liveCount:liveEnabled?Number(count?.value||0):null,liveDetailCount:liveEnabled?Number(detail?.value||0):null,lastLiveCheck:row?Number(row.value):null};
}
async function diagnoseNativeOnce(env){
  if(!nativeConfigured(env)||!env.DB)return;
  const prior=await env.DB.prepare("SELECT value FROM service_state WHERE key='native_auth_probe_v2'").first();
  if(prior)return;
  const status=await probeNativeAuthorization(env,'kora-zol','id-korazol-push-70@kora-zol.iam.gserviceaccount.com');
  await env.DB.prepare("INSERT OR IGNORE INTO service_state(key,value) VALUES('native_auth_probe_v2',?)").bind(status).run();
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
  return {teams,matches,types,allLive:raw?.allLive===true,language:raw?.language === 'en'?'en':'ar'};
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
  if(subscription?.nativeToken)return sendNative(env,subscription.nativeToken,message,subscription.richNotifications===true);
  let payload;
  try{
    payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:300,urgency:'high'}},subscription,{
      subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY
    });
  }catch(error){console.warn('Push encryption failed: '+(error?.name||'Error'));return 591}
  try{
    // Workers derives Content-Length from the byte array; do not override it.
    const headers=new Headers(payload.headers);headers.delete('content-length');
    // Cloudflare Workers supports manual and follow, not Fetch's error mode.
    // Never follow a redirect carrying a device's encrypted push credentials.
    const response=await fetch(subscription.endpoint,{...payload,headers,method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000)});
    return response.status;
  }catch(error){console.warn('Push network request failed: '+(error?.name||'Error'));return 592}
}
async function ensureTestResults(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS push_test_results (id TEXT PRIMARY KEY, requested INTEGER NOT NULL, status INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
}
async function recordTest(env,id,requested,status){
  await env.DB.prepare('INSERT INTO push_test_results(id,requested,status,updated) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET requested=excluded.requested,status=excluded.status,updated=excluded.updated WHERE push_test_results.requested<=excluded.requested').bind(id,requested,status,Date.now()).run();
}
function testState(status){
  if(status===0)return 'pending';
  if(status>=200&&status<300)return 'accepted';
  if(status===404||status===410)return 'expired';
  if(status===408)return 'timed_out';
  if((status>=300&&status<400)||status===400||status===401||status===403||status===413||[460,461,462].includes(status))return 'rejected';
  return 'retrying';
}
async function route(request, env, ctx) {
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
  if(origin!==env.APP_ORIGIN) return json({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS') return new Response(null,{status:204});
  if(path==='/config' && request.method==='GET') {
    const diagnostic=url.searchParams.get('check')==='native';
    const probe=diagnostic&&env.DB?await env.DB.prepare("SELECT value FROM service_state WHERE key='native_auth_probe_v2'").first():null;
    return json({enabled:configured(env),nativeEnabled:nativeConfigured(env),...(diagnostic?{nativeStatus:nativeConfigStatus(env),nativeAuthorization:probe?.value||'pending'}:{}),publicKey:configured(env)?env.VAPID_PUBLIC_KEY:null,...await feedStatus(env)});
  }
  if(path==='/fixtures'&&request.method==='GET'&&env.SPORTSCORE_ENABLED==='true'){
    const date=url.searchParams.get('date')||'';
    const stamp=Date.parse(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date||Math.abs(Date.now()-stamp)>31*86400000)return json({error:'invalid_date'},400);
    try{return json(await publicFixtures(date))}catch{return json({error:'fixtures_unavailable'},503)}
  }
  if(path==='/match'&&request.method==='GET'&&env.SPORTSCORE_ENABLED==='true'){
    const id=url.searchParams.get('id')||'',slug=url.searchParams.get('slug')||'';
    if(!/^ss:[a-z0-9]{1,64}$/i.test(id)||!/^[a-z0-9-]{1,200}$/i.test(slug))return json({error:'invalid_match'},400);
    try{return json(await publicMatchDetails(id,slug))}catch{return json({error:'match_details_unavailable'},503)}
  }
  if(path==='/player-photo'&&request.method==='GET'&&env.SPORTSCORE_ENABLED==='true'){
    const name=url.searchParams.get('name')||'',team=url.searchParams.get('team')||'';
    if(name.length<2||name.length>100||team.length<2||team.length>100)return json({error:'invalid_player'},400);
    try{return json(await publicPlayerPhoto(name,team))}catch{return json({error:'player_photo_unavailable'},503)}
  }
  if(request.method!=='POST' || !['/subscribe','/unsubscribe','/test','/test-status'].includes(path)) return json({error:'not_found'},404);
  if(!configured(env)) return json({error:'not_configured'},503);
  let data;try{data=await parseRequest(request)}catch(e){return json({error:e.message==='too_large'?'too_large':'invalid_json'},400)}
  const native=typeof data?.nativeToken==='string'&&data.nativeToken.length>=20&&data.nativeToken.length<=4096&&/^[A-Za-z0-9_:\-.]+$/.test(data.nativeToken);
  if(!data || !tokenPattern.test(data.token||'') || (!native&&!validSubscription(data.subscription))) return json({error:'invalid_subscription'},400);
  if(native&&path==='/subscribe'&&!nativeConfigured(env))return json({error:'native_not_configured'},503);
  const sub=native?{nativeToken:data.nativeToken,richNotifications:data.richNotifications===true}:{endpoint:data.subscription.endpoint,expirationTime:null,keys:{p256dh:data.subscription.keys.p256dh,auth:data.subscription.keys.auth}};
  const id=await digest(native?'native:'+data.token:sub.endpoint),tokenHash=await digest(data.token);
  const existing=await env.DB.prepare('SELECT token_hash, subscription, last_test, test_due FROM devices WHERE id=?').bind(id).first();
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
  await ensureTestResults(env);
  if(path==='/test-status'){
    const result=await env.DB.prepare('SELECT requested,status,updated FROM push_test_results WHERE id=?').bind(id).first();
    if(!result||result.requested!==existing.last_test)return json({state:existing.test_due?'pending':'unknown'});
    return json({state:testState(result.status),providerStatus:result.status,requested:result.requested,updated:result.updated});
  }
  // Deliver after the HTTP response, independently of the first cron tick.
  // Cron remains a durable fallback at one minute if the immediate attempt fails.
  const due=now+MINUTE;
  const reserved=await env.DB.prepare('UPDATE devices SET last_test=?,test_due=? WHERE id=? AND token_hash=? AND last_test<?').bind(now,due,id,tokenHash,now-MINUTE).run();
  if(!reserved.meta?.changes) return json({error:'test_rate_limited'},429);
  await recordTest(env,id,now,0);
  if(ctx?.waitUntil)ctx.waitUntil((async()=>{
    await new Promise(resolve=>setTimeout(resolve,8000));
    const row=await env.DB.prepare('SELECT id,subscription,preferences,test_due,last_test FROM devices WHERE id=? AND test_due=?').bind(id,due).first();
    if(row)await sendOneTest(env,row,Date.now());
  })().catch(()=>console.warn('Immediate test attempt failed; cron will retry.')));
  return json({scheduled:true,requested:now},202);
}
async function sendOneTest(env,row,now){
    if(now-row.test_due>EVENT_TTL){await recordTest(env,row.id,row.last_test,408);await env.DB.prepare('UPDATE devices SET test_due=0 WHERE id=? AND test_due=?').bind(row.id,row.test_due).run();return}
    const ar=JSON.parse(row.preferences).language!=='en';
    const message={title:ar?'⚽ كورة زول | تجربة الإشعار':'⚽ Kora Zol | Test notification',body:ar?'دا إشعار تجريبي من سيرفر كورة زول.':'This is a test notification from the Kora Zol server.',tag:'korazol-test-'+row.test_due,url:env.APP_URL};
    let status=599;
    try{
      status=await sendPush(env,JSON.parse(row.subscription),message);
    }catch{console.warn('Test push not accepted; it will retry.')}
    const state=testState(status);
    await recordTest(env,row.id,row.last_test,status);
    console.info('Test push provider status: '+status);
    if(['accepted','expired','rejected'].includes(state))await env.DB.prepare('UPDATE devices SET test_due=0 WHERE id=? AND test_due=?').bind(row.id,row.test_due).run();
}
async function sendTests(env,now){
  const {results}=await env.DB.prepare('SELECT id,subscription,preferences,test_due,last_test FROM devices WHERE test_due>0 AND test_due<=?').bind(now).all();
  if(results.length)await ensureTestResults(env);
  for(const row of results)await sendOneTest(env,row,now);
}
async function fixtures(env, day) {
  const url=new URL('https://v3.football.api-sports.io/fixtures');
  url.searchParams.set(day==='live'?'live':'date',day==='live'?'all':day);url.searchParams.set('timezone','UTC');
  const response=await fetch(url,{headers:{'x-apisports-key':env.API_FOOTBALL_KEY,'Accept':'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw Error('football_http_'+response.status);
  const data=await response.json();
  if(!Array.isArray(data.response)||Object.keys(data.errors||{}).length)throw Error('football_provider_error');
  return data.response.map(fromFixture).filter(Boolean);
}
async function pollMatches(env, now) {
  const devices=await env.DB.prepare('SELECT id,subscription,preferences,updated FROM devices').all();
  const active=devices.results.map(row=>({...row,preferences:JSON.parse(row.preferences)})).filter(d=>d.preferences.types.length&&(d.preferences.allLive||d.preferences.teams.length||d.preferences.matches.length));
  const useFree=env.SPORTSCORE_ENABLED==='true';
  if(!active.length&&!useFree) return;
  if(env.API_FOOTBALL_KEY||useFree){
    const {results:previous}=await env.DB.prepare('SELECT fixture_id,match_json,revision,updated FROM match_state WHERE updated>?').bind(now-86400000).all();
    const old=new Map(previous.map(r=>[r.fixture_id,r]));
    let matches=new Map(),priorFeed=null;
    if(useFree){
      priorFeed=await env.DB.prepare("SELECT value FROM service_state WHERE key='sportscore_last_success'").first();
      try{
        const result=await collectSportScore(now,old,active);matches=result.matches;
        await env.DB.batch([['sportscore_last_success',now],['sportscore_live_count',result.liveCount],['sportscore_detail_count',result.detailCount]].map(([key,value])=>env.DB.prepare('INSERT INTO service_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value)));
        console.info('SportScore live matches: '+result.liveCount+' verified details: '+result.detailCount);
      }catch(error){console.warn('SportScore feed unavailable: '+error.message)}
    }else{
    const current=new Date(now),dates=[current.toISOString().slice(0,10)];
    if(current.getUTCHours()<4)dates.push(new Date(now-86400000).toISOString().slice(0,10));
    // Date queries include scheduled/final matches; the documented live query includes card events.
    const results=await Promise.allSettled([...dates,'live'].map(day=>fixtures(env,day)));
    matches=new Map(results.flatMap(r=>r.status==='fulfilled'?r.value:[]).map(match=>[match.id,match]));
    if(results.at(-1).status==='rejected')console.warn('Live football feed is unavailable; card history retained.');
    else await env.DB.prepare("INSERT INTO service_state(key,value) VALUES('last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(now).run();
    }
    // Only monitor matches relevant to subscribers. Comparing the old state prevents
    // replaying historical scores on the first poll or after a long provider outage.
    for(const match of matches.values()){
      if(!active.some(d=>selectedBy(d.preferences,match)))continue;
      const row=old.get(match.id),prior=row?JSON.parse(row.match_json):null;
      if(match.status==='NS'&&Date.parse(match.date)>now+30*MINUTE)continue;
      if(['FT','AET','PEN','AWD','WO'].includes(match.status)&&(!prior||prior.status===match.status))continue;
      const fresh=row&&now-row.updated<=EVENT_TTL;
      const kinds=fresh?transitions(prior,match):[];
      // A new fixture can appear after the upcoming list was truncated. Only report
      // a kickoff if a healthy previous poll and the provider's actual clock confirm it.
      if(useFree&&!row&&priorFeed&&now-priorFeed.value<=3*MINUTE&&match.status==='1H'&&Number.isInteger(match.minute)&&match.minute<=3&&Math.abs(now-Date.parse(match.date))<=10*MINUTE)kinds.push('kickoff');
      const hasCardData=Array.isArray(match.cards);
      const cards=fresh&&now-(prior?.cardUpdated||0)<=EVENT_TTL?newCards(prior,match):[];
      match.cardUpdated=hasCardData?now:prior?.cardUpdated||0;
      if(match.cards===null)match.cards=prior?.cards??null;
      else if(Array.isArray(prior?.cards))match.cards=[...new Map([...prior.cards,...match.cards].map(card=>[card.id,card])).values()];
      const revision=(row?.revision||0)+(kinds.length||cards.length?1:0);
      const statements=[env.DB.prepare('INSERT INTO match_state(fixture_id,match_json,revision,updated) VALUES(?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET match_json=excluded.match_json,revision=excluded.revision,updated=excluded.updated WHERE match_state.updated<excluded.updated').bind(match.id,JSON.stringify(match),revision,now)];
      for(const kind of kinds){const event={id:match.id+':'+(kind.startsWith('goal')?'score:'+match.homeScore+':'+match.awayScore:kind)+':'+kind,type:kind,match};statements.push(env.DB.prepare('INSERT OR IGNORE INTO events(id,event_json,created) VALUES(?,?,?)').bind(event.id,JSON.stringify(event),now))}
      for(const card of cards){const event={id:match.id+':card:'+card.id,type:card.type,card,match};statements.push(env.DB.prepare('INSERT OR IGNORE INTO events(id,event_json,created) VALUES(?,?,?)').bind(event.id,JSON.stringify(event),now))}
      await env.DB.batch(statements);
    }
  }
  if(!active.length)return;
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
  async fetch(request,env,ctx){
    env=withAppDefaults(env);
    let response;
    try{if(request.headers.get('origin')===env.APP_ORIGIN && request.method!=='OPTIONS')env=await withSigningKeys(env);response=await route(request,env,ctx)}catch{response=json({error:'server_error'},500)}
    if(request.headers.get('origin')===env.APP_ORIGIN){
      response.headers.set('access-control-allow-origin',env.APP_ORIGIN);
      response.headers.set('access-control-allow-methods','GET, POST, OPTIONS');
      response.headers.set('access-control-allow-headers','content-type');
      response.headers.set('vary','Origin');
    }
    return response;
  },
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{env=await withSigningKeys(withAppDefaults(env));if(configured(env)){await diagnoseNativeOnce(env).catch(()=>{});await sendTests(env,controller.scheduledTime);await pollMatches(env,controller.scheduledTime)}})().catch(()=>console.error('Push poll failed; saved state retained.')));}
};
