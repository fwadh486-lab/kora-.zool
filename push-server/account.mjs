/* Authenticated per-user favorite snapshots. Firebase Authentication performs
   password storage. This Worker verifies Google's RS256 ID-token signature. */
const PROJECT='kora-zol';
const KEY_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache=null;
const enc=new TextEncoder();
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function decode(value){
 if(typeof value!=='string'||value.length>12000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid_token');
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((value.length+3)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function parsePart(s){return JSON.parse(new TextDecoder().decode(decode(s)))}
async function remoteKeys(){
 if(keyCache&&keyCache.until>Date.now())return keyCache.keys;
 const res=await fetch(KEY_URL,{signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!res.ok)throw Error('auth_keys_unavailable');
 const data=await res.json();if(!Array.isArray(data.keys))throw Error('auth_keys_unavailable');
 const cacheControl=res.headers.get('cache-control')||'';
 const seconds=Math.min(3600,Math.max(60,Number(cacheControl.match(/max-age=(\d+)/)?.[1])||900));
 keyCache={keys:data.keys,until:Date.now()+seconds*1000};
 return data.keys;
}
export async function verifyFirebaseToken(raw){
 if(typeof raw!=='string'||raw.length<100||raw.length>6000)throw Error('invalid_token');
 const parts=raw.split('.');if(parts.length!==3)throw Error('invalid_token');
 let h,p;try{h=parsePart(parts[0]);p=parsePart(parts[1])}catch{throw Error('invalid_token')}
 const now=Math.floor(Date.now()/1000);
 if(h?.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>200||
    p?.aud!==PROJECT||p?.iss!=='https://securetoken.google.com/'+PROJECT||
    typeof p?.sub!=='string'||!p.sub.length||p.sub.length>128||
    !Number.isInteger(p.iat)||p.iat>now+60||
    !Number.isInteger(p.exp)||p.exp<=now||
    !Number.isInteger(p.auth_time)||p.auth_time>now+60)throw Error('invalid_token');
 const key=(await remoteKeys()).find(k=>k.kid===h.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
 if(!key)throw Error('invalid_token');
 const publicKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decode(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
 if(!valid)throw Error('invalid_token');
 return {uid:p.sub,email:typeof p.email==='string'?p.email.slice(0,254):''};
}
function strings(arr,max=100,length=100){
 if(!Array.isArray(arr)||arr.length>max||arr.some(s=>typeof s!=='string'||s.trim().length<1||s.trim().length>length))throw Error('invalid_preferences');
 return [...new Set(arr.map(s=>s.trim()))];
}
export function cleanAccountData(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_preferences');
 const saved=Array.isArray(raw.savedMatches)?raw.savedMatches.map(x=>{
   const id=x?.id,home=x?.home,away=x?.away,date=x?.date;
   if([id,home,away,date].some(v=>typeof v!=='string')||id.length>100||home.length>100||away.length>100||!Number.isFinite(Date.parse(date)))throw Error('invalid_preferences');
   return {id,home,away,date};
 }):[];
 if(saved.length>100)throw Error('invalid_preferences');
 const alertTypes=strings(raw.alertTypes||['goal','kickoff','halftime','fulltime','yellow','red'],7,20);
 const allowed=new Set(['goal','kickoff','halftime','fulltime','yellow','red']);
 if(alertTypes.some(x=>!allowed.has(x)))throw Error('invalid_preferences');
 return {
   followedTeams:strings(raw.followedTeams||[],100),favoriteMatches:strings(raw.favoriteMatches||[],200),
   notificationTeams:strings(raw.notificationTeams||[],100),notificationLeagues:strings(raw.notificationLeagues||[],60,24),
   followedLeagues:strings(raw.followedLeagues||[],60,24),
   savedMatches:saved,alertTypes,alertAllLive:raw.alertAllLive===true,alertRule:raw.alertRule==='both'?'both':'any'
 };
}
async function table(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS account_favorites (uid TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated INTEGER NOT NULL)').run();
}
export async function accountRoute(request,env,parseRequest){
 if(!env.DB)return json({error:'storage_unavailable'},503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]{100,6000}$/.test(bearer))return json({error:'unauthorized'},401);
 let user;
 try{user=await verifyFirebaseToken(bearer.slice(7))}catch{return json({error:'unauthorized'},401)}
 await table(env);
 if(request.method==='GET'){
   const record=await env.DB.prepare('SELECT data_json,updated FROM account_favorites WHERE uid=?').bind(user.uid).first();
   return json({found:Boolean(record),data:record?JSON.parse(record.data_json):null,updated:record?.updated||null,email:user.email});
 }
 if(request.method==='DELETE'){
   await env.DB.prepare('DELETE FROM account_favorites WHERE uid=?').bind(user.uid).run();
   return json({deleted:true});
 }
 if(request.method!=='PUT')return json({error:'method_not_allowed'},405);
 let data;try{data=cleanAccountData(await parseRequest(request))}catch{return json({error:'invalid_preferences'},400)}
 const updated=Date.now();
 await env.DB.prepare('INSERT INTO account_favorites(uid,data_json,updated) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET data_json=excluded.data_json,updated=excluded.updated').bind(user.uid,JSON.stringify(data),updated).run();
 return json({saved:true,updated});
}
