(function(root){
  'use strict';
  const KEY='korazol_personal_predictions_v1';
  const OPTIONS=['home','draw','away'];
  function validId(value){return typeof value==='string'&&value.length>0&&value.length<=140&&/^[a-z0-9:_-]+$/i.test(value)}
  function readAll(storage){try{const value=JSON.parse(storage.getItem(KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
  function prediction(storage,id){if(!validId(String(id||'')))return null;const all=readAll(storage),value=all[String(id)];return OPTIONS.includes(value)?value:null}
  function savePrediction(storage,id,choice){const key=String(id||'');if(!validId(key)||!OPTIONS.includes(choice))return false;try{const all=Object.entries(readAll(storage)).filter(([name,v])=>validId(name)&&OPTIONS.includes(v)&&name!==key).slice(-99);all.push([key,choice]);storage.setItem(KEY,JSON.stringify(Object.fromEntries(all)));return true}catch{return false}}
  function isUpcoming(match,now=Date.now()){
    if(!match||!Number.isFinite(Date.parse(match.date)))return false;
    const phase=root.KoraMatchFeed?.phaseOf?.(match);
    return phase==='upcoming'&&Date.parse(match.date)>now;
  }
  function cleanName(text){return String(text||'').replace(/[\r\n\t]/g,' ').replace(/\s+/g,' ').trim().slice(0,100)}
  function utcStamp(ms){return new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}
  function calendarLink(match,now=Date.now()){
    if(!isUpcoming(match,now)||!cleanName(match.home)||!cleanName(match.away))return '';
    const start=Date.parse(match.date),end=start+120*60000;
    if(!Number.isFinite(start)||new Date(start).getUTCFullYear()>2100)return '';
    const url=new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action','TEMPLATE');
    url.searchParams.set('text',cleanName(match.home)+' × '+cleanName(match.away)+' | Kora Zol');
    url.searchParams.set('dates',utcStamp(start)+'/'+utcStamp(end));
    url.searchParams.set('details','موعد مباراة من تطبيق كورة زول. التوقيت حسب جهازك؛ راجع الموعد قبل الحفظ.');
    return url.href;
  }
  function isCountedGoal(event){
    const kind=String(event?.type||event?.detail||'');
    const text=[kind,event?.detail,event?.description].filter(Boolean).join(' ');
    return /\bgoal\b/i.test(kind)&&!/\b(disallow(?:ed)?|cancel(?:led|ed)?|overturn(?:ed)?|annull?ed|void|no goal)\b/i.test(text);
  }
  root.KoraMatchExtras={prediction,savePrediction,isUpcoming,calendarLink,isCountedGoal};
})(globalThis);
