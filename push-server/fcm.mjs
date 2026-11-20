const encoder=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode=value=>b64url(encoder.encode(JSON.stringify(value)));
let cached=null;
export function nativeConfigured(env){
  try{const a=JSON.parse(env.FCM_SERVICE_ACCOUNT||'null');return Boolean(a&&/^[a-z0-9-]+$/.test(a.project_id)&&a.client_email&&a.private_key?.includes('BEGIN PRIVATE KEY'))}catch{return false}
}
async function accessToken(env){
  const account=JSON.parse(env.FCM_SERVICE_ACCOUNT);
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
export function nativeMessage(token,message){
  return {message:{token,notification:{title:String(message.title).slice(0,180),body:String(message.body).slice(0,500)},data:{url:String(message.url||''),tag:String(message.tag||'korazol')},android:{priority:'HIGH',ttl:'300s',notification:{channel_id:'korazol_matches',icon:'ic_notification',sound:'default',tag:String(message.tag||'korazol')}}}};
}
export async function sendNative(env,token,message){
  if(!nativeConfigured(env))return 503;
  try{
    const auth=await accessToken(env);
    const response=await fetch('https://fcm.googleapis.com/v1/projects/'+auth.project+'/messages:send',{method:'POST',headers:{authorization:'Bearer '+auth.token,'content-type':'application/json'},body:JSON.stringify(nativeMessage(token,message)),redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(response.ok)return response.status;
    if(response.status===401)cached=null;
    const result=await response.json().catch(()=>null);
    const unregistered=result?.error?.details?.some(d=>d.errorCode==='UNREGISTERED');
    return unregistered?410:response.status===404?593:response.status;
  }catch{return 592}
}
