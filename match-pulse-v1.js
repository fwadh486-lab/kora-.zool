(function(root){
'use strict';
const rules=[
 {kind:'disallowed',pattern:/\b(?:disallow(?:ed)?|cancell?ed|overturned?|annull?ed|no goal|var\s+no\s+goal)\b/i},
 {kind:'goal',pattern:/\b(?:own goal|goal|penalty goal)\b/i},
 {kind:'red',pattern:/\b(?:red card|card red|second yellow card|yellow-red card)\b/i},
 {kind:'yellow',pattern:/\b(?:yellow card|card yellow)\b/i},
 {kind:'sub',pattern:/\b(?:substitution|substituted|substitute|replacement)\b/i}
];
const labels={goal:'هدف',disallowed:'هدف ملغي',red:'بطاقة حمراء',yellow:'بطاقة صفراء',sub:'تبديل'};
function kindOf(e){
 const kind=String(e?.type||e?.detail||'').toLowerCase();
 const full=[kind,e?.detail,e?.description].filter(Boolean).join(' ');
 if(!kind)return null;
 if(/\bgoal\s+kick\b/i.test(kind))return null;
 if(/\bgoal\b/i.test(kind)&&rules[0].pattern.test(full))return 'disallowed';
 const row=rules.slice(1).find(r=>r.pattern.test(kind));
 return row?row.kind:null;
}
function momentOf(e){
 const time=e?.minute,extra=e?.extra;
 let minute=null,added=0;
 if(typeof time==='number'&&Number.isInteger(time))minute=time;
 else if(typeof time==='string'){
   const parsed=time.trim().match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?(?:['′])?$/);
   if(parsed){minute=Number(parsed[1]);added=Number(parsed[2]||0)}
 }
 if(typeof extra==='number'&&Number.isInteger(extra)&&extra>=0&&extra<30)added=extra;
 if(minute===null||minute<0||minute>130||added>25||minute+added>150)return null;
 return {minute,added,elapsed:minute+added,label:minute+(added?'+'+added:'')+'′'};
}
function normalizeTeam(s){return String(s||'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]/gu,'')}
function sideOf(e,m,teamMatcher){
 if(e?.side==='home'||e?.side==='away')return e.side;
 const name=e?.team;
 if(typeof name!=='string'||!name.trim())return null;
 const same=(a,b)=>normalizeTeam(a)===normalizeTeam(b)||Boolean(teamMatcher?.(a,b));
 const home=same(name,m.home),away=same(name,m.away);
 return home!==away?(home?'home':'away'):null;
}
function normalizeEvents(match,teamMatcher){
 if(!match||!Array.isArray(match.events))return [];
 const seen=new Set(),found=[];
 for(const e of match.events.slice(0,250)){
   const kind=kindOf(e),time=momentOf(e),side=sideOf(e,match,teamMatcher);
   if(!kind||!time||!side)continue;
   const player=String(e.player||e.playerName||'').trim().slice(0,100);
   const score=typeof e.score==='string'&&/^\d{1,3}\s*-\s*\d{1,3}$/.test(e.score)?e.score:'';
   const incoming=String(e.playerIn||'').trim().slice(0,100);
   const outgoing=String(e.playerOut||'').trim().slice(0,100);
   const key=JSON.stringify([kind,side,time.label,normalizeTeam(player),normalizeTeam(incoming),normalizeTeam(outgoing),score]);
   if(seen.has(key))continue;seen.add(key);
   found.push({key,kind,side,minute:time.minute,added:time.added,elapsed:time.elapsed,clock:time.label,player,score,playerIn:incoming,playerOut:outgoing});
 }
 return found.sort((a,b)=>a.elapsed-b.elapsed||a.side.localeCompare(b.side));
}
function analyze(match,teamMatcher){
 const events=normalizeEvents(match,teamMatcher),max=events.reduce((n,e)=>Math.max(n,e.elapsed),0);
 const extra=/^(?:ET|BT|P|AET|PEN)$/i.test(String(match?.status||''));
 const endMinute=extra||max>100?120:max>90?105:90;
 const counts={home:{goal:0,disallowed:0,red:0,yellow:0,sub:0},away:{goal:0,disallowed:0,red:0,yellow:0,sub:0}};
 for(const e of events)counts[e.side][e.kind]++;
 return {events,endMinute,counts,sourceAvailable:Array.isArray(match?.events)};
}
function score(match){
 const parts=String(match?.score||'').trim().match(/^(\d{1,3})\s*[-:]\s*(\d{1,3})$/);
 return parts?[Number(parts[1]),Number(parts[2])]:null;
}
function story(match,analysis,phaseOf){
 const result=score(match),home=String(match?.home||'الفريق الأول'),away=String(match?.away||'الفريق الثاني');
 const phase=typeof phaseOf==='function'?phaseOf(match):match?.phase;
 let sentence='';
 if(!result)sentence='النتيجة غير متاحة من المصدر حالياً.';
 else if(phase==='finished'){
   if(result[0]===result[1])sentence='انتهت بالتعادل '+result[0]+' - '+result[1]+' بين '+home+' و'+away+'.';
   else sentence='انتهت بفوز '+(result[0]>result[1]?home:away)+' '+Math.max(...result)+' - '+Math.min(...result)+'.';
 }else if(phase==='live')sentence='المباراة جارية: '+home+' '+result[0]+' - '+result[1]+' '+away+'.';
 else sentence='النتيجة المعروضة: '+home+' '+result[0]+' - '+result[1]+' '+away+'.';
 if(!analysis?.sourceAvailable)return sentence+' بيانات أحداث المباراة غير متاحة.';
 const count=analysis.events.filter(e=>e.kind==='goal').length;
 const reds=analysis.events.filter(e=>e.kind==='red').length;
 const disallowed=analysis.events.filter(e=>e.kind==='disallowed').length;
 const extras=[count?count+' هدف في سجل الأحداث':'',reds?reds+' بطاقة حمراء':'',disallowed?disallowed+' هدف ملغي':''].filter(Boolean);
 return sentence+(extras.length?' من الأحداث المؤكدة المتاحة: '+extras.join('، ')+'.':' لا توجد أحداث بارزة مؤكدة في البيانات المتاحة.');
}
function shareText(match,analysis,phaseOf){
 const summary=story(match,analysis,phaseOf);
 const top=analysis.events.filter(e=>e.kind==='goal'||e.kind==='red'||e.kind==='disallowed').slice(0,12)
  .map(e=>e.clock+' '+labels[e.kind]+' · '+(e.side==='home'?match.home:match.away)+(e.player?' · '+e.player:''));
 return ['💚 كورة زول | نبض المباراة',String(match.home||'')+' × '+String(match.away||''),summary,...top,'البيانات المعروضة من أحداث المباراة المتاحة فقط.'].join('\n');
}
root.KoraMatchPulse={analyze,score,story,shareText,labels,kindOf,momentOf,sideOf};
})(globalThis);
