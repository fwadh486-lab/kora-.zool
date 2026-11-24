/* Kora Zol account backup via Firebase Authentication (email/password)
 * and server-side D1 snapshots authenticated with signed Firebase ID tokens.
 * No password or service-account key is saved by this application. */
(()=>{
'use strict';
const ACCOUNT_KEY='korazol_account_refresh_v1',BASE='https://korazol-push.fwadh486.workers.dev';
const $=id=>document.getElementById(id),tr=(ar,en)=>document.documentElement.lang==='en'?en:ar;
const current={idToken:'',refreshToken:'',expires:0,uid:'',email:''};
let config=null,busy=false,restoring=false,timer=0,lastUploaded='',activeUid='';
const pendingKey=uid=>'korazol_account_pending_v1_'+uid;
function read(key){try{return localStorage.getItem(key)}catch{return null}}
function store(key,value){try{if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,value);return true}catch{return false}}
function list(key,limit){try{const v=JSON.parse(read(key)||'[]');return Array.isArray(v)?[...new Set(v.filter(x=>typeof x==='string'&&x.trim()&&x.length<=100))].slice(0,limit):[]}catch{return []}}
function snapshot(){
 let saved=[];try{const v=JSON.parse(read('korazol_push_saved_matches_v1')||'[]');if(Array.isArray(v))saved=v.slice(0,100).filter(m=>typeof m?.id==='string'&&typeof m.home==='string'&&typeof m.away==='string'&&Number.isFinite(Date.parse(m.date))).map(m=>({id:m.id,home:m.home,away:m.away,date:m.date}))}catch{}
 const types=list('korazol_push_types_v2',7);
 return {
  followedTeams:list('korazol_followed_teams_v1',100),favoriteMatches:list('corazol_favorites',200),
  followedLeagues:list('korazol_followed_leagues_v1',60),notificationLeagues:list('korazol_notify_leagues_v1',60),
  notificationTeams:read('korazol_notify_teams_v1')===null?list('korazol_followed_teams_v1',100):list('korazol_notify_teams_v1',100),
  savedMatches:saved,alertTypes:read('korazol_push_types_v2')===null?['goal','kickoff','halftime','fulltime','yellow','red']:types,
  alertAllLive:read('korazol_push_all_live_v1')==='yes',alertFavoriteMatchesEnabled:read('korazol_notify_favorite_matches_v1')!=='no',alertRule:read('korazol_notify_rule_v1')==='both'?'both':'any'
 };
}
function status(ar,en,error=false){
 const output=$('koraAccountStatus');if(!output)return;
 output.textContent=tr(ar,en);output.style.color=error?'#ff9b99':'var(--accent,#51d49d)';
}
function render(){
 const on=Boolean(current.uid),guest=$('koraAccountGuest'),signed=$('koraAccountSigned');
 if(guest)guest.hidden=on;
 if(signed)signed.hidden=!on;
 const email=$('koraAccountEmailLabel');if(email)email.textContent=on?tr('👤 حسابك: ','👤 Account: ')+current.email:'';
 for(const id of ['koraAccountLogin','koraAccountSignup','koraAccountReset','koraAccountSync','koraAccountRestore','koraAccountSignout']){
   const b=$(id);if(b)b.disabled=busy;
 }
}
async function configReady(){
 if(config)return config;
 const r=await fetch('./account-config.json',{cache:'no-store',signal:AbortSignal.timeout(9000)});
 if(!r.ok)throw Error('configuration_unavailable');
 const value=await r.json();
 if(!/^AIza[A-Za-z0-9_-]{25,}$/.test(value.apiKey||'')||value.projectId!=='kora-zol')throw Error('configuration_unavailable');
 config=value;return value;
}
function errorCode(result){
 const code=result?.error?.message||result?.error||'';
 const names={
  EMAIL_EXISTS:['البريد دا مسجل بالفعل؛ جرّب تسجيل الدخول.','Email already registered; sign in.'],
  OPERATION_NOT_ALLOWED:['تسجيل البريد وكلمة المرور لم يُفعّل في Firebase بعد.','Email/password sign-in is not enabled in Firebase.'],
  CONFIGURATION_NOT_FOUND:['إعدادات Firebase Authentication غير مكتملة.','Firebase Authentication is not configured.'],
  INVALID_LOGIN_CREDENTIALS:['البريد أو كلمة المرور غير صحيحة.','Invalid email or password.'],
  EMAIL_NOT_FOUND:['البريد أو كلمة المرور غير صحيحة.','Invalid email or password.'],
  INVALID_PASSWORD:['البريد أو كلمة المرور غير صحيحة.','Invalid email or password.'],
  WEAK_PASSWORD:['كلمة المرور ضعيفة؛ اختار 6 حروف على الأقل.','Password is too weak.'],
  TOO_MANY_ATTEMPTS_TRY_LATER:['محاولات كثيرة؛ جرّب بعد شوية.','Too many attempts; try again later.'],
  USER_DISABLED:['تم تعطيل الحساب؛ تواصل مع الدعم.','Account has been disabled.']
 };
 const key=Object.keys(names).find(k=>String(code).includes(k));
 return key?tr(...names[key]):tr('تعذر إكمال الطلب. راجع الإنترنت أو جرّب لاحقاً.','Request failed. Check your connection and try again.');
}
async function firebase(action,payload){
 const cfg=await configReady();
 const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+encodeURIComponent(cfg.apiKey),{
  method:'POST',headers:{'content-type':'application/json'},cache:'no-store',
  body:JSON.stringify(payload),signal:AbortSignal.timeout(18000)
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(errorCode(result));
 return result;
}
function adopt(result,backup=true){
 if(!result?.idToken||!result?.refreshToken||!result?.localId)throw Error('invalid_session');
 current.idToken=result.idToken;current.refreshToken=result.refreshToken;
 current.expires=Date.now()+(Number(result.expiresIn)||3600)*1000;
 current.uid=result.localId;current.email=result.email||current.email;
 activeUid=current.uid;
 if(backup&&!store(ACCOUNT_KEY,JSON.stringify({refreshToken:current.refreshToken,email:current.email,uid:current.uid})))status('تعذر حفظ جلسة الحساب على الجهاز.','Could not persist account session.',true);
 render();
}
async function refresh(){
 if(!current.refreshToken)throw Error('not_signed_in');
 const cfg=await configReady();
 const response=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(cfg.apiKey),{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},cache:'no-store',
  body:new URLSearchParams({grant_type:'refresh_token',refresh_token:current.refreshToken}),signal:AbortSignal.timeout(16000)
 });
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(errorCode(value));
 adopt({idToken:value.id_token,refreshToken:value.refresh_token,localId:value.user_id,email:current.email,expiresIn:value.expires_in});
}
async function token(){
 if(!current.uid)throw Error('not_signed_in');
 if(!current.idToken||Date.now()>current.expires-90000)await refresh();
 return current.idToken;
}
async function account(method,payload){
 const identity=await token();
 const response=await fetch(BASE+'/account',{method,headers:{'authorization':'Bearer '+identity,...(payload?{'content-type':'application/json'}:{})},cache:'no-store',body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(18000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(response.status===401?'session_expired':result.error||'server_unavailable');
 return result;
}
function apply(data){
 if(!data)return;
 const fields={
  followedTeams:'korazol_followed_teams_v1',favoriteMatches:'corazol_favorites',
  followedLeagues:'korazol_followed_leagues_v1',notificationTeams:'korazol_notify_teams_v1',
  notificationLeagues:'korazol_notify_leagues_v1',savedMatches:'korazol_push_saved_matches_v1',
  alertTypes:'korazol_push_types_v2'
 };
 restoring=true;
 try{
  for(const [key,storage] of Object.entries(fields))if(Array.isArray(data[key]))store(storage,JSON.stringify(data[key]));
  store('korazol_push_all_live_v1',data.alertAllLive?'yes':'no');
  store('korazol_notify_favorite_matches_v1',data.alertFavoriteMatchesEnabled===false?'no':'yes');
  store('korazol_notify_rule_v1',data.alertRule==='both'?'both':'any');
  if(typeof renderLive==='function')renderLive();
  if(typeof renderFavorites==='function')renderFavorites();
  document.dispatchEvent(new Event('korazol:account-restored'));
  window.KoraNotifications?.render?.();
  window.KoraPush?.sync?.();
 }finally{restoring=false}
}
async function restore(show=true){
 if(!current.uid)return;
 clearTimeout(timer);
 const uid=current.uid;
 const pending=read(pendingKey(uid));
 // Preserve preferences changed just before the user closed the app.
 // Upload the exact pending snapshot first, then restore the authoritative copy.
 if(pending){
   let local;try{local=JSON.parse(pending)}catch{throw Error('invalid_pending_backup')}
   await account('PUT',local);
   if(current.uid!==uid)return;
   store(pendingKey(uid),null);
 }
 const result=await account('GET');
 if(current.uid!==uid)return;
 if(result.found&&result.data){
  apply(result.data);lastUploaded=JSON.stringify(snapshot());
  if(show)status('✓ رجعنا مفضلاتك واختيارات الإشعارات من حسابك.','✓ Favorites and notification preferences restored.');
 }else if(show)status('الحساب جديد ومافي مفضلات محفوظة. اضغط حفظ مفضلات الجهاز لرفع الموجود.','This account has no saved favorites yet. Tap Back up device favorites to upload your data.');
}
async function save(show=false){
 if(!current.uid||restoring)return;
 const data=snapshot(),fingerprint=JSON.stringify(data);
 if(fingerprint===lastUploaded){if(show)status('✓ المفضلات محفوظة ومتزامنة.','✓ Favorites are already backed up.');return}
 const uid=current.uid;
 await account('PUT',data);
 if(current.uid!==uid)return;
 lastUploaded=fingerprint;
 if(read(pendingKey(uid))===fingerprint)store(pendingKey(uid),null);
 if(show)status('✓ حفظنا الفرق والبطولات والمفضلات واختيارات الإشعارات في حسابك.','✓ Teams, leagues, favorites and notification choices saved to your account.');
}
function schedule(){
 if(!current.uid||restoring)return;
 // An offline or interrupted upload must not be overwritten by an older cloud copy.
 store(pendingKey(current.uid),JSON.stringify(snapshot()));
 clearTimeout(timer);
 timer=setTimeout(()=>save(false).catch(()=>status('تعذرت مزامنة المفضلات؛ هنعيد المحاولة عند فتح الحساب.','Favorites are kept on this device. We will retry the cloud sync.',true)),1100);
}
function signout(){
 clearTimeout(timer);lastUploaded='';
 current.idToken='';current.refreshToken='';current.expires=0;current.uid='';current.email='';
 activeUid='';store(ACCOUNT_KEY,null);render();
 status('تم تسجيل الخروج. مفضلات هذا الجهاز ما انمسحت.','Signed out. Favorites on this device were not deleted.');
}
async function authenticate(create=false){
 if(busy)return;
 const email=String($('koraAccountEmail')?.value||'').trim().toLowerCase(),
       password=$('koraAccountPassword')?.value||'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<6||password.length>128){
   status('اكتب بريد صحيح وكلمة مرور من 6 أحرف على الأقل.','Enter a valid email and a password of at least 6 characters.',true);return}
 busy=true;render();
 try{
  const data=await firebase(create?'signUp':'signInWithPassword',{email,password,returnSecureToken:true});
  adopt(data);
  $('koraAccountPassword').value='';
  lastUploaded='';
  if(create){await save(true)}
  else await restore(true);
 }catch(e){status(e.message&&e.message!=='server_unavailable'?e.message:tr('تعذر ربط حسابك بالسيرفر. جرّب تاني.','Could not connect to account server; try again.'),true)}
 finally{busy=false;render()}
}
async function reset(){
 const email=String($('koraAccountEmail')?.value||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){status('أدخل بريدك الإلكتروني أولاً.','Enter your email address first.',true);return}
 busy=true;render();
 try{await firebase('sendOobCode',{requestType:'PASSWORD_RESET',email});status('لو البريد مسجل، حتوصلك رسالة إعادة تعيين كلمة المرور.','If the email exists, a password reset message will arrive.')}
 catch(e){status(e.message,true)}
 finally{busy=false;render()}
}
async function runSafe(fn){
 if(busy)return;busy=true;render();try{await fn()}catch(e){status(e.message==='session_expired'?tr('انتهت الجلسة؛ سجل دخول من جديد.','Session expired; sign in again.'):tr('تعذّر الاتصال بالسيرفر. تأكد من الإنترنت وجرّب تاني.','Could not reach server. Check internet and retry.'),true)}
 finally{busy=false;render()}
}
function init(){
 if(!$('koraAccount'))return;
 $('koraAccountForm')?.addEventListener('submit',e=>{e.preventDefault();authenticate(false)});
 $('koraAccountSignup')?.addEventListener('click',()=>authenticate(true));
 $('koraAccountReset')?.addEventListener('click',reset);
 $('koraAccountSync')?.addEventListener('click',()=>runSafe(()=>save(true)));
 $('koraAccountRestore')?.addEventListener('click',()=>runSafe(()=>restore(true)));
 $('koraAccountSignout')?.addEventListener('click',signout);
 document.addEventListener('korazol:preferences-changed',schedule);
 const cached=read(ACCOUNT_KEY);if(cached){try{
  const data=JSON.parse(cached);
  if(data?.refreshToken&&data?.uid){current.refreshToken=data.refreshToken;current.uid=data.uid;current.email=data.email||'';activeUid=data.uid;
    runSafe(async()=>{await refresh();lastUploaded='';await restore(false);status('✓ حسابك متصل. مفضلاتك متزامنة.','✓ Signed in. Your favorites are synced.')}).catch(()=>{});
  }
 }catch{store(ACCOUNT_KEY,null)}}
 render();
}
window.KoraAccount={snapshot,restore:()=>runSafe(()=>restore(true)),save:()=>runSafe(()=>save(true))};
init();
})();
