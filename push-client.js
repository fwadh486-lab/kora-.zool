/* Background notifications for the installed Chrome PWA. */
(() => {
  const KEY = 'korazol_background_push_v1', TOKEN = 'korazol_push_device_token', PREFS='korazol_push_types_v1', SAVED='korazol_push_saved_matches_v1', LAST_TEST='korazol_push_last_test_v2';
  const PREFS_V2='korazol_push_types_v2', ALL_LIVE='korazol_push_all_live_v1', TYPES=['goal','kickoff','halftime','fulltime','yellow','red'];
  const $ = id => document.getElementById(id);
  const tr = (ar,en) => document.documentElement.lang === 'en' ? en : ar;
  const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const set = (key,value) => { try { localStorage.setItem(key,value); } catch {} };
  function readJson(key,fallback){try{return JSON.parse(get(key)||'null')??fallback}catch{return fallback}}
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  let endpoint=null, config=null, busy=false, synced=false, fingerprint='', notice='', noticeError=false, syncTimer=null, syncInFlight=false, checkingTest=false;
  function notify(ar,en,error=false){notice=tr(ar,en);noticeError=error;render()}
  function types(){const legacy=readJson(PREFS,['goal','kickoff','fulltime']);const defaults=Array.isArray(legacy)&&['goal','kickoff','fulltime'].every(t=>legacy.includes(t))?TYPES:legacy;const existing=readJson(PREFS_V2,defaults);return TYPES.filter(x=>Array.isArray(existing)&&existing.includes(x))}
  function enabled(){return get(KEY)==='yes'}
  function token(){let value=get(TOKEN);if(!value){value=crypto.randomUUID()+crypto.randomUUID();set(TOKEN,value)}return value}
  function preferenceData(){
    const teams=typeof getFollowedTeams==='function'?getFollowedTeams().slice(0,100):[];
    const favoriteIds=new Set(typeof getFavorites==='function'?getFavorites():[]);
    const old=readJson(SAVED,[]);
    const matches=new Map((Array.isArray(old)?old:[]).filter(x=>favoriteIds.has(x.id)).map(x=>[x.id,x]));
    const all=[...(typeof liveEvents!=='undefined'?liveEvents:[]),...(Array.isArray(window.upcomingEvents)?window.upcomingEvents:[])];
    for(const e of all)if(favoriteIds.has(e.id)&&e.date&&e.home&&e.away)matches.set(e.id,{id:e.id,home:e.home,away:e.away,date:e.date});
    const selected=[...matches.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(0,100);
    set(SAVED,JSON.stringify(selected));
    return {teams:[...teams].sort(),matches:selected,types:types(),allLive:get(ALL_LIVE)==='yes',language:document.documentElement.lang==='en'?'en':'ar'};
  }
  function render(){
    const button=$('backgroundPushButton'),test=$('backgroundPushTest'),status=$('backgroundPushStatus');
    if(!button||!status)return;
    const canUse=supported(),available=Boolean(config?.enabled),on=enabled();
    button.disabled=busy||!canUse||(!available&&!on);
    button.textContent=on?tr('🔕 إيقاف إشعارات الخلفية','🔕 Disable background push'):tr('🔔 تشغيل إشعارات الخلفية','🔔 Enable background push');
    if(test){test.disabled=busy||!on||!synced||!available;test.hidden=!on}
    document.querySelectorAll('[data-push-type]').forEach(input=>{input.checked=types().includes(input.dataset.pushType);input.disabled=busy});
    const allLive=$('pushAllLive');if(allLive){allLive.checked=get(ALL_LIVE)==='yes';allLive.disabled=busy;}
    if(notice){status.textContent=notice;status.style.color=noticeError?'#ff9ca0':'';return}
    status.style.color='';
    if(!canUse)status.textContent=tr('افتح كورة زول في Chrome لتشغيل الإشعارات.','Open Kora Zol in Chrome to use background notifications.');
    else if(Notification.permission==='denied'&&!on)status.textContent=tr('الإشعارات محظورة. اسمح بها من إعدادات الموقع في Chrome.','Notifications are blocked. Allow them in Chrome site settings.');
    else if(!available)status.textContent=tr('سيرفر إشعارات الخلفية غير متصل حالياً. التنبيهات أثناء فتح التطبيق تظل متاحة.','The background notification server is not connected. In-app alerts are still available.');
    else if(on&&!synced)status.textContent=tr('جاري التحقق من اشتراك الجهاز…','Checking this device’s subscription…');
    else if(on)status.textContent=config.liveEnabled?tr('الجهاز مشترك ومصدر الأحداث الحية متصل. اختر كل المباريات أو تابع فريقاً أو احفظ مباراة.','Subscribed and live feed connected. Select all matches, follow a team or save a match.'):tr('الجهاز مشترك. الإشعارات التجريبية تعمل، لكن مصدر أحداث المباريات الحية غير متصل بعد.','Subscribed. Test push works, but the live match event feed is not connected yet.');
    else status.textContent=tr('استلم تنبيهات المباريات حتى بعد إغلاق التطبيق.','Receive match notifications even when the app is closed.');
  }
  async function api(path,data){
    const response=await fetch(endpoint+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
    const value=await response.json();
    if(!response.ok)throw Error(value.error||'server_error');
    return value;
  }
  function applicationKey(value){
    const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((value.length+3)%4));
    return Uint8Array.from(decoded,x=>x.charCodeAt(0));
  }
  function registration(){return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('service_worker_timeout')),12000))])}
  async function loadConfig(){
    try{
      const response=await fetch('./push-config.json',{cache:'no-store',signal:AbortSignal.timeout(7000)});
      if(!response.ok)return;
      const data=await response.json();
      if(!data.endpoint)return;
      const url=new URL(data.endpoint);
      if(url.protocol!=='https:'||url.username||url.password)return;
      endpoint=url.origin;
      config=await api('/config');
    }catch{config=null}
    finally{render();if(enabled())scheduleSync()}
  }
  async function subscribeExisting(sub,prefs){
    const result=await api('/subscribe',{token:token(),subscription:sub.toJSON(),preferences:prefs});
    config.liveEnabled=Boolean(result.liveEnabled);synced=Boolean(result.subscribed);
    fingerprint=JSON.stringify(prefs);
    return result;
  }
  async function sync(){
    if(!enabled()||!config?.enabled||!supported()||busy||syncInFlight)return;
    syncInFlight=true;
    try{
      if(Notification.permission!=='granted')throw Error('not_allowed');
      const reg=await registration(),sub=await reg.pushManager.getSubscription();
      if(!sub)throw Error('subscription_expired');
      const prefs=preferenceData();
      if(!synced||fingerprint!==JSON.stringify(prefs))await subscribeExisting(sub,prefs);
      if(noticeError){notice='';noticeError=false}
      refreshTestStatus();
    }catch{synced=false;notify('تعذر مزامنة الإشعارات. افتح الإعدادات وأعد تفعيلها.','Could not sync pushes. Open Settings and re-enable.',true)}
    finally{syncInFlight=false;render()}
  }
  function scheduleSync(){if(syncTimer)clearTimeout(syncTimer);syncTimer=setTimeout(sync,350)}
  async function toggle(){
    if(busy||!supported())return;
    notice='';busy=true;render();
    try{
      if(enabled()){
        const reg=await registration(),sub=await reg.pushManager.getSubscription();
        if(sub){if(config?.enabled)try{await api('/unsubscribe',{token:token(),subscription:sub.toJSON()})}catch{}await sub.unsubscribe()}
        set(KEY,'no');set(LAST_TEST,'0');synced=false;fingerprint='';
        notify('تم إيقاف إشعارات الخلفية.','Background push disabled.');return;
      }
      if(!config?.enabled)throw Error('not_configured');
      // Permission is only requested in the user's explicit button action.
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted')throw Error('not_allowed');
      const reg=await registration(),key=applicationKey(config.publicKey);
      let sub=await reg.pushManager.getSubscription();
      if(sub&&sub.options.applicationServerKey&&String(new Uint8Array(sub.options.applicationServerKey))!==String(key)){await sub.unsubscribe();sub=null}
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await subscribeExisting(sub,preferenceData());
      set(KEY,'yes');notice='';
    }catch(e){synced=false;notify(e.message==='not_allowed'?'اسمح بالإشعارات في إعدادات Chrome أولاً.':'ما قدرنا نربط الجهاز. تأكد من الاتصال وحاول مرة أخرى.',e.message==='not_allowed'?'Allow notifications in Chrome first.':'Could not connect this device. Check the connection and try again.',true)}
    finally{busy=false;render()}
  }
  async function test(){
    if(busy||!synced||!enabled())return;
    busy=true;notice='';render();
    try{
      const sub=await (await registration()).pushManager.getSubscription();
      if(!sub)throw Error('subscription_expired');
      const result=await api('/test',{token:token(),subscription:sub.toJSON()});
      if(!result.scheduled)throw Error('server_error');
      set(LAST_TEST,String(result.requested||Date.now()));
      notify('تمت جدولة التجربة. اقفل التطبيق الآن وانتظر الإشعار؛ ويمكنك مراجعة نتيجة الإرسال هنا عند العودة.','Test scheduled. Close the app now and check the delivery result here when you return.');
    }catch(e){notify(e.message==='test_rate_limited'?'انتظر دقيقة قبل إعادة التجربة.':'تعذرت جدولة الإشعار التجريبي.',e.message==='test_rate_limited'?'Wait one minute before retrying.':'Could not schedule the test notification.',true)}
    finally{busy=false;render()}
  }
  async function refreshTestStatus(){
    const last=Number(get(LAST_TEST)||0);
    if(checkingTest||busy||!enabled()||!synced||!config?.enabled||!last||Date.now()-last>86400000)return;
    checkingTest=true;
    try{
      const sub=await (await registration()).pushManager.getSubscription();
      if(!sub)return;
      const result=await api('/test-status',{token:token(),subscription:sub.toJSON()});
      if(Number(get(LAST_TEST))!==last||result.requested&&result.requested<last)return;
      switch(result.state){
        case 'accepted':notify('السيرفر أرسل الإشعار وقبله مزود Chrome. لو ما ظهر، راجع سماح الإشعارات في إعدادات الجوال وChrome.','Push accepted by the browser notification provider. If it did not appear, check phone and browser notification settings.');break;
        case 'expired':notify('اشتراك الإشعارات انتهى. أوقف إشعارات الخلفية وشغّلها من جديد.','The subscription expired. Disable and re-enable background push.',true);break;
        case 'rejected':notify('مزود الإشعارات رفض الإرسال (رمز '+result.providerStatus+'). أرسل لنا الرمز للتشخيص.','The push provider rejected the message (code '+result.providerStatus+'). Share this code for diagnosis.',true);break;
        case 'retrying':notify('السيرفر يحاول إرسال الإشعار مرة أخرى (رمز '+result.providerStatus+').','The server is retrying delivery (code '+result.providerStatus+').',true);break;
        case 'timed_out':notify('انتهت مهلة التجربة. أرسل تجربة جديدة.','The test timed out. Send a new test.',true);break;
        case 'pending':notify('التجربة قيد الإرسال. اقفل التطبيق وانتظر الإشعار.','The test is queued. Close the app and wait for the notification.');break;
      }
    }catch{}finally{checkingTest=false}
  }
  function onLanguage(){notice='';render();scheduleSync()}
  function init(){
    $('backgroundPushButton')?.addEventListener('click',toggle);
    $('backgroundPushTest')?.addEventListener('click',test);
    document.querySelectorAll('[data-push-type]').forEach(input=>input.addEventListener('change',()=>{
      set(PREFS_V2,JSON.stringify([...document.querySelectorAll('[data-push-type]:checked')].map(x=>x.dataset.pushType)));
      notice='';scheduleSync();render();
    }));
    $('pushAllLive')?.addEventListener('change',event=>{set(ALL_LIVE,event.target.checked?'yes':'no');notice='';scheduleSync();render()});
    window.addEventListener('online',()=>{if(!config?.enabled)loadConfig();else scheduleSync()});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(enabled())loadConfig();scheduleSync()}});
    setInterval(()=>{if(!document.hidden)refreshTestStatus()},10000);
    setInterval(()=>{if(enabled()&&!document.hidden)loadConfig()},120000);
    render();loadConfig();
  }
  window.KoraPush={sync:scheduleSync,render:onLanguage,ownsLiveAlerts:()=>enabled()&&synced&&Boolean(config?.liveEnabled)};
  init();
})();
