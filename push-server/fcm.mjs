const encoder=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=value=>b64url(encoder.encode(JSON.stringify(value)));
let cached=null;
function readAccount(env){
  const raw=env.FCM_SERVICE_ACCOUNT;
  if(typeof raw!=='string'||!raw.trim())return {status:'missing'};
  let a;
  try{a=JSON.parse(raw.trim());if(typeof a==='string')a=JSON.parse(a.trim())}catch{return {status:'invalid_json'}}
  if(!a||typeof a!=='object'||typeof a.project_id!=='string'||!/^[a-z0-9-]+$/.test(a.project_id)||typeof a.client_email!=='string'||!a.client_email||typeof a.private_key!=='string'||!a.private_key.includes('BEGIN PRIVATE KEY'))return {status:'invalid_account'};
  return {status:'ready',account:a};
}
export function nativeConfigStatus(env){return readAccount(env).status}
export function nativeConfigured(env){return nativeConfigStatus(env)==='ready'}
function rejectionReason(result){
  const details=result?.error?.details||[];
  if(details.some(d=>d.errorCode==='SENDER_ID_MISMATCH'))return 'sender_mismatch';
  if(details.some(d=>d.reason==='SERVICE_DISABLED'))return 'api_disabled';
  if(details.some(d=>d.reason==='IAM_PERMISSION_DENIED')||result?.error?.status==='PERMISSION_DENIED')return 'permission_denied';
  return 'provider_rejected';
}
// Validation-only: Google checks authorization without sending a notification.
export async function probeNativeAuthorization(env,expectedProject,expectedEmail){
  const {status,account}=readAccount(env);
  if(status!=='ready')return status;
  if(account.project_id!==expectedProject)return 'project_mismatch';
  if(account.client_email!==expectedEmail)return 'account_mismatch';
  try{
    const auth=await accessToken(env);
    const response=await fetch('https://fcm.googleapis.com/v1/projects/'+auth.project+'/messages:send',{method:'POST',headers:{authorization:'Bearer '+auth.token,'content-type':'application/json'},body:JSON.stringify({validate_only:true,message:{topic:'korazol-validation-only',notification:{title:'Kora Zol validation',body:'Authorization check only'}}}),redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(response.ok)return 'authorized';
    return rejectionReason(await response.json().catch(()=>null));
  }catch{return 'authorization_unavailable'}
}
async function accessToken(env){
  const account=readAccount(env).account;
  if(cached?.email===account.client_email&&cached.expires>Date.now()+60000)return cached;
  const now=Math.floor(Date.now()/1000);
  const jwt=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const der=Uint8Array.from(atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const assertion=jwt+'.'+b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(jwt)));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('fcm_auth_failed');
  const data=await response.json();if(!data.access_token)throw Error('fcm_auth_invalid');
  cached={email:account.client_email,token:data.access_token,project:account.project_id,expires:Date.now()+Math.min(Number(data.expires_in)||3600,3600)*1000};
  return cached;
}
const EVENT_TYPES=new Set(['goal-home','goal-away','kickoff','secondhalf','halftime','fulltime','yellow','red','test']);
export function nativeMessage(token,message,rich=false){
  const title=String(message.title).slice(0,180),body=String(message.body).slice(0,500);
  // Deliver a trusted event category to the Android native notification channel
  // selector. Unknown and historical payloads use a quiet-capable general channel.
  const type=EVENT_TYPES.has(message.type)?message.type:'general';
  const data={url:String(message.url||''),tag:String(message.tag||'korazol'),type};
  // Existing APKs continue to receive the system-rendered notification.
  if(rich)return {message:{token,data:{...data,title,body,image:String(message.image||'').slice(0,400)},android:{priority:'HIGH',ttl:'300s'}}};
  return {message:{token,notification:{title,body},data,android:{priority:'HIGH',ttl:'300s',notification:{channel_id:'korazol_matches',icon:'ic_notification',sound:'default',tag:String(message.tag||'korazol')}}}};
}
export async function sendNative(env,token,message,rich=false){
  if(!nativeConfigured(env))return 503;
  try{
    const auth=await accessToken(env);
    const response=await fetch('https://fcm.googleapis.com/v1/projects/'+auth.project+'/messages:send',{method:'POST',headers:{authorization:'Bearer '+auth.token,'content-type':'application/json'},body:JSON.stringify(nativeMessage(token,message,rich)),redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(response.ok)return response.status;
    if(response.status===401)cached=null;
    const result=await response.json().catch(()=>null);
    const unregistered=result?.error?.details?.some(d=>d.errorCode==='UNREGISTERED');
    if(response.status===403){const reason=rejectionReason(result);if(reason==='sender_mismatch')return 460;if(reason==='api_disabled')return 461;if(reason==='permission_denied')return 462;}
    return unregistered?410:response.status===404?593:response.status;
  }catch{return 592}
}
