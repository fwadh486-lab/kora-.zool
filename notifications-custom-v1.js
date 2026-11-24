/* Kora Zol — device-side selection of competitions and individual teams.
   Explicit "all" is optional, and a saved match can still notify its owner. */
(()=>{
'use strict';
const TEAM='korazol_notify_teams_v1',LEAGUES='korazol_notify_leagues_v1',RULE='korazol_notify_rule_v1',ALL='korazol_push_all_live_v1';
const ids=new Set(['en','es','sa','sd','de','it','fr','cl','afcelite','eng2','pt','nl','br','rw','qa','el','cafcl','euro','nations','friendly','clubfriendly','nonfifa']);
const $=id=>document.getElementById(id),lang=()=>document.documentElement.lang==='en';
function read(key){try{return localStorage.getItem(key)}catch{return null}}
function array(key){try{const v=JSON.parse(read(key)||'null');return Array.isArray(v)?v:[]}catch{return []}}
function teams(){if(read(TEAM)===null){try{return typeof getFollowedTeams==='function'?getFollowedTeams().slice(0,100):[]}catch{return []}}return array(TEAM).filter(s=>typeof s==='string'&&s.trim()).slice(0,100)}
function leagues(){return [...new Set(array(LEAGUES).filter(x=>ids.has(x)))].slice(0,60)}
function rule(){return read(RULE)==='both'?'both':'any'}
function tr(ar,en){return lang()?en:ar}
function changed(){
 document.dispatchEvent(new Event('korazol:preferences-changed'));
 window.KoraPush?.sync?.();
 render();
}
function set(key,value){
 try{localStorage.setItem(key,value);changed();return true}catch{const p=$('notifyCustomSummary');if(p)p.textContent=tr('تعذر حفظ الاختيارات على الجهاز.','Could not save preferences on device.');return false}
}
function knownTeams(){
 const names=new Set(teams());
 try{if(typeof getFollowedTeams==='function')for(const n of getFollowedTeams())names.add(n)}catch{}
 try{if(typeof allCachedMatches==='function')for(const m of allCachedMatches().slice(0,900)){if(m.home)names.add(m.home);if(m.away)names.add(m.away)}}catch{}
 return [...names].filter(n=>typeof n==='string'&&n.length<=100).sort((a,b)=>a.localeCompare(b,'ar'));
}
function render(){
 const panel=$('notifyCustomCard'),list=$('notifyLeagueList');if(!panel||!list)return;
 const all=read(ALL)==='yes',selected=leagues(),chosen=teams();
 panel.querySelectorAll('input[name=notifyScope]').forEach(x=>x.checked=(x.value==='all')===all);
 panel.querySelectorAll('input[name=notifyRule]').forEach(x=>x.checked=x.value===rule());
 list.replaceChildren();
 const picker=$('leagueFilter');
 if(picker)for(const option of picker.options){
   if(!ids.has(option.value))continue;
   const button=document.createElement('button');
   button.type='button';button.textContent=tr(option.dataset.ar||option.textContent,option.dataset.en||option.textContent);
   button.setAttribute('aria-pressed',String(selected.includes(option.value)));
   button.dataset.league=option.value;
   button.onclick=()=>{const next=new Set(leagues());if(next.has(option.value))next.delete(option.value);else next.add(option.value);try{localStorage.setItem(LEAGUES,JSON.stringify([...next]));localStorage.setItem(ALL,'no')}catch{}changed()};
   list.append(button);
 }
 const suggestions=$('notifyTeamChoices');if(suggestions){suggestions.replaceChildren();for(const n of knownTeams().slice(0,250)){const item=document.createElement('option');item.value=n;suggestions.append(item)}}
 const box=$('notifyTeamSelected');if(box){box.replaceChildren();for(const name of chosen){
  const b=document.createElement('button');b.type='button';b.textContent=name+' ×';b.setAttribute('aria-label',tr('إزالة ','Remove ')+name);
  b.onclick=()=>{try{localStorage.setItem(TEAM,JSON.stringify(teams().filter(x=>x!==name)));localStorage.setItem(ALL,'no')}catch{}changed()};box.append(b);
 }}
 const summary=$('notifyCustomSummary');
 if(summary){
  const count=selected.length,tc=chosen.length;
  summary.textContent=all?tr('🔔 كل المباريات المدعومة — إشعارات كثيرة.','🔔 All supported matches — frequent alerts.'):
     rule()==='both'&&(count===0||tc===0)?tr('🎯 لازم تختار بطولة وفريق مع بعض عشان توصلك إشعارات (عدا المباريات المفضلة).','🎯 Select at least one competition AND one team; favorite matches are still covered.'):
     tr('🎯 '+count+' بطولة · '+tc+' فريق. المباريات المفضلة بتستمر تنبّهك.','🎯 '+count+' competitions · '+tc+' teams. Favorite matches can still notify you.');
 }
}
function init(){
 const container=$('notifyCustomCard');if(!container)return;
 container.querySelectorAll('input[name=notifyScope]').forEach(input=>input.onchange=()=>set(ALL,input.value==='all'?'yes':'no'));
 container.querySelectorAll('input[name=notifyRule]').forEach(input=>input.onchange=()=>set(RULE,input.value==='both'?'both':'any'));
 const input=$('notifyTeamInput');
 const add=()=>{
  const name=String(input?.value||'').trim().replace(/\s+/g,' ');
  if(!name||name.length>100)return;
  const proposed=knownTeams().find(n=>n.toLocaleLowerCase()===name.toLocaleLowerCase());
  if(!proposed){const status=$('notifyCustomSummary');if(status)status.textContent=tr('اختار اسم الفريق من الاقتراحات أو تابع الفريق أولاً.','Choose a team from suggestions or follow it first.');return}
  const values=new Set(teams());if(values.size>=100)return;values.add(proposed);
  try{localStorage.setItem(TEAM,JSON.stringify([...values]));localStorage.setItem(ALL,'no')}catch{}
  input.value='';changed();
 };
 $('notifyTeamAdd')?.addEventListener('click',add);
 input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add()}});
 document.addEventListener('korazol:account-restored',render);
 document.addEventListener('korazol:language-changed',render);
 render();
}
window.KoraNotifications={render,teams,leagues,rule};
init();
})();
