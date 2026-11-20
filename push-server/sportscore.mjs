import {normalizedName, selectedBy} from './events.mjs';

const MINUTE=60000;
const leagueCodes=new Map([
  ['englishpremierleague','en'],['premierleague','en'],['englishfootballleaguechampionship','eng2'],['englishchampionship','eng2'],['eflchampionship','eng2'],
  ['spanishlaliga','es'],['laliga','es'],['bundesliga','de'],['germanbundesliga','de'],['italianseriea','it'],['seriea','it'],['frenchligue1','fr'],['ligue1','fr'],
  ['saudiprofessionalleague','sa'],['saudiproleague','sa'],['roshnsaudileague','sa'],['uefachampionsleague','cl'],['brazilianseriea','br'],
  ['dutcheredivisie','nl'],['eredivisie','nl'],['portugueseprimeraliga','pt'],['portugueseliga','pt'],['ligaportugal','pt'],['sudanpremierleague','sd'],['sudanesepremierleague','sd'],['sudaneseleague','sd'],['internationalfriendly','friendly'],['internationalfriendlies','friendly']
]);
const statusCodes=new Map([['not started','NS'],['delayed','NS'],['1st half','1H'],['half time','HT'],['2nd half','2H'],['extra time','ET'],['extra time half time','BT'],['penalties','P'],['finished','FT'],['after extra time','AET'],['after penalties','PEN'],['postponed','PST'],['cancelled','CANC'],['abandoned','ABD'],['interrupted','INT']]);
const finals=new Set(['FT','AET','PEN','AWD','WO','CANC','ABD','PST']);
const live=new Set(['1H','HT','2H','ET','BT','P','LIVE','INT']);
const publicLeagues=['english-premier-league','spanish-la-liga','bundesliga','italian-serie-a','french-ligue-1','saudi-professional-league','uefa-champions-league','brazilian-serie-a','dutch-eredivisie','portuguese-primeira-liga','english-football-league-championship','sudan-premier-league'];
function integer(value){return typeof value==='number'&&Number.isInteger(value)&&value>=0?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):null}
function incidents(raw){
  if(!Array.isArray(raw.incidents))return null;
  const counts=new Map();
  return raw.incidents.flatMap(event=>{
    const type=event.is_card===true&&({'yellow card':'yellow','red card':'red','second yellow card':'red','yellow-red card':'red'})[String(event.type).toLowerCase()];
    const team=event.side==='home'?raw.home:event.side==='away'?raw.away:null;
    if(!type||!team||!event.player)return [];
    const key=JSON.stringify([type,event.side,normalizedName(event.player)]),count=(counts.get(key)||0)+1;counts.set(key,count);
    return [{id:key+':'+count,type,team,player:event.player,minute:integer(event.time),extra:null}];
  });
}
export function fromSportScore(raw){
  const path=typeof raw?.url==='string'&&raw.url.match(/^\/football\/match\/([a-z0-9-]+)\/([a-z0-9]+)\/$/i);
  if(!path||!raw.home||!raw.away||!Number.isFinite(Date.parse(raw.time)))return null;
  const status=statusCodes.get(String(raw.status_text).toLowerCase())||({live:'LIVE',finished:'FT',upcoming:'NS'})[raw.status];
  if(!status)return null;
  return {id:'ss:'+path[2],slug:path[1],source:'SportScore',home:raw.home,away:raw.away,
    league:leagueCodes.get(normalizedName(raw.competition))||'',homeScore:integer(raw.home_score),awayScore:integer(raw.away_score),
    status,minute:integer(raw.live_minute),date:raw.time,cards:incidents(raw),competition:raw.competition||'',
    homeLogo:typeof raw.home_logo==='string'&&raw.home_logo.startsWith('https://')?raw.home_logo:'',awayLogo:typeof raw.away_logo==='string'&&raw.away_logo.startsWith('https://')?raw.away_logo:'',sourceUrl:'https://sportscore.com'+raw.url};
}
async function request(path,params){
  const url=new URL(path,'https://sportscore.com');
  for(const [key,value] of Object.entries({sport:'football',src:'korazol',...params}))url.searchParams.set(key,String(value));
  const response=await fetch(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('sportscore_http_'+response.status);
  return response.json();
}
async function list(date,status,competition){
  const data=await request('/api/v1/fixtures/',{date,...(status?{status}:{}),...(competition?{competition}:{}),limit:200});
  if(!Array.isArray(data.matches)||data.sport!=='football')throw Error('sportscore_invalid_list');
  return data.matches.map(fromSportScore).filter(Boolean);
}
function toPublicMatch(match){
  const phase=live.has(match.status)?'live':['FT','AET','PEN','AWD','WO'].includes(match.status)?'finished':match.status==='NS'?'upcoming':'other';
  const score=phase==='upcoming'||match.homeScore===null||match.awayScore===null?'— : —':`${match.homeScore} - ${match.awayScore}`;
  return {...match,phase,live:phase==='live',score,cards:undefined};
}
async function cacheRead(key,ttl,loader){
  const cache=globalThis.caches?.default;
  const cacheKey=new Request('https://korazol-push.fwadh486.workers.dev/__sports-cache/'+key);
  if(cache){try{const saved=await cache.match(cacheKey);if(saved)return await saved.json()}catch{}}
  const value=await loader();
  if(cache&&!value.partial){try{await cache.put(cacheKey,Response.json(value,{headers:{'Cache-Control':`public, max-age=${ttl}`}}))}catch{}}
  return value;
}
export async function publicFixtures(date,now=Date.now()){
  const today=new Date(now).toISOString().slice(0,10),yesterday=new Date(now-86400000).toISOString().slice(0,10);
  const recent=date===today||date===yesterday;
  const snapshots=await cacheRead('fixtures-v1-'+date,recent?180:3600,async()=>{
    // The global day response is capped at 200. A fixed competition allowlist
    // prevents late matches being truncated and bounds requests and quota.
    const responses=[];
    for(let i=0;i<publicLeagues.length;i+=6)responses.push(...await Promise.allSettled(publicLeagues.slice(i,i+6).map(league=>list(date,null,league))));
    if(responses.every(r=>r.status==='rejected'))throw Error('sportscore_fixtures_unavailable');
    return {matches:responses.flatMap(r=>r.status==='fulfilled'?r.value:[]),partial:responses.some(r=>r.status==='rejected'),updated:new Date(now).toISOString()};
  });
  let liveResult={matches:[],partial:false};
  if(recent)try{liveResult=await cacheRead('live-v1-'+date,60,async()=>({matches:await list(date,'live'),partial:false}))}catch{liveResult.partial=true}
  const byId=new Map([...snapshots.matches,...liveResult.matches].filter(m=>m.league).map(m=>[m.id,m]));
  return {source:'SportScore',date,updated:snapshots.updated,partial:snapshots.partial||liveResult.partial,matches:[...byId.values()].map(toPublicMatch)};
}
export function normalizeMatchDetails(raw,updated){
  const parsed=fromSportScore(raw);
  if(!parsed)throw Error('invalid_match');
  const match=toPublicMatch(parsed);
  const events=Array.isArray(raw.incidents)?raw.incidents.flatMap(e=>{
    const team=e.side==='home'?match.home:e.side==='away'?match.away:null;
    if(!team||typeof e.type!=='string')return [];
    return [{type:e.type,team,side:e.side,minute:integer(e.time),player:e.player||e.player_in||'',playerIn:e.player_in||'',playerOut:e.player_out||'',score:e.is_goal===true&&integer(e.home_score)!==null&&integer(e.away_score)!==null?e.home_score+' - '+e.away_score:null}];
  }):[];
  const stats=Array.isArray(raw.stats)?raw.stats.flatMap(s=>{
    if(typeof s.label!=='string'||s.home==null||s.away==null||!Number.isFinite(Number(s.home))||!Number.isFinite(Number(s.away)))return [];
    const suffix=s.suffix==='%'?'%':'';
    return [{name:s.label,home:String(s.home)+suffix,away:String(s.away)+suffix}];
  }):[];
  const l=raw.lineups;
  const players=list=>Array.isArray(list)?list.flatMap(p=>typeof p?.name==='string'&&p.name.trim()?[{name:p.name,number:integer(p.number),position:p.position||'',captain:p.captain===true,rating:Number(p.rating)>0&&Number(p.rating)<=10?Number(p.rating):null,photo:typeof p.photo==='string'&&p.photo.startsWith('https://')?p.photo:''}]:[]):[];
  const verifiedLineups=l?.confirmed===true?['home','away'].flatMap(side=>{
    const xi=players(l[side+'_xi']);
    return xi.length?[{side,team:match[side],formation:l[side+'_formation']||'',coach:typeof l[side+'_coach']==='string'?l[side+'_coach']:'',players:xi,bench:players(l[side+'_subs'])}]:[];
  }):[];
  const htHome=integer(raw.home_ht_score),htAway=integer(raw.away_ht_score);
  return {...match,events,stats,verifiedLineups,halfTime:htHome!==null&&htAway!==null?{home:htHome,away:htAway}:null,updated:typeof updated==='string'?updated:null};
}
export async function publicMatchDetails(id,slug){
  if(!/^ss:[a-z0-9]{1,64}$/i.test(id)||!/^[a-z0-9-]{1,200}$/i.test(slug))throw Error('invalid_match');
  return cacheRead('match-v1-'+id.slice(3)+'-'+slug,60,async()=>{
    const data=await request('/api/widget/match/',{slug});
    const result=normalizeMatchDetails(data.match,data.updated);
    if(result.id!==id)throw Error('sportscore_fixture_mismatch');
    return result;
  });
}
async function detail(match){
  const data=await request('/api/widget/match/',{slug:match.slug});
  const parsed=fromSportScore(data.match);
  // A slug can refer to a different meeting of the same teams. Never mix fixtures.
  if(!parsed||parsed.id!==match.id)throw Error('sportscore_fixture_mismatch');
  if(data.updated&&Date.now()-Date.parse(data.updated)>10*MINUTE)throw Error('sportscore_stale_detail');
  return parsed;
}
export async function collectSportScore(now,old,active){
  const date=new Date(now),days=[date.toISOString().slice(0,10)];
  if(date.getUTCHours()<4)days.push(new Date(now-86400000).toISOString().slice(0,10));
  const lists=await Promise.allSettled(days.map(day=>list(day,'live')));
  if(lists.every(result=>result.status==='rejected'))throw Error('sportscore_live_unavailable');
  const allLive=lists.flatMap(result=>result.status==='fulfilled'?result.value:[]);
  const selected=match=>active.some(device=>selectedBy(device.preferences,match));
  const visible=new Map(allLive.filter(selected).map(match=>[match.id,match]));
  const upcoming=date.getUTCMinutes()%5===0&&active.length?await list(days[0],'upcoming').catch(()=>[]):[];
  for(const match of upcoming)if(match.status==='NS'&&Date.parse(match.date)>=now-10*MINUTE&&Date.parse(match.date)<=now+30*MINUTE&&selected(match)&&!visible.has(match.id))visible.set(match.id,match);
  const candidates=new Map([...visible].filter(([,match])=>live.has(match.status)));
  for(const [id,row] of old){
    if(visible.has(id)||now-row.updated>10*MINUTE)continue;
    const match=JSON.parse(row.match_json);
    if(match.source==='SportScore'&&live.has(match.status)&&selected(match))candidates.set(id,match);
  }
  // At most five calls/minute; together with list calls this stays below 10k/day.
  // Rotate through older details first, prioritizing games that disappeared from live.
  const age=match=>{const row=old.get(match.id);return row?JSON.parse(row.match_json).cardUpdated||0:0};
  const target=[...candidates.values()].sort((a,b)=>(Number(!visible.has(b.id))-Number(!visible.has(a.id)))||age(a)-age(b)).slice(0,5);
  // A healthy connection can be verified even before anyone selects a match.
  if(!target.length){const sample=allLive.find(match=>match.league);if(sample)target.push(sample)}
  const results=await Promise.allSettled(target.map(detail));
  let detailCount=0;
  for(const result of results){
    if(result.status!=='fulfilled')continue;
    const match=result.value;detailCount++;
    if(!selected(match))continue;
    const summary=visible.get(match.id);
    if(summary){
      // Summary and details are cached independently. Use the summary's score/status
      // when they disagree rather than creating a false reversal or a second goal.
      visible.set(match.id,{...summary,cards:match.cards,minute:summary.status===match.status?match.minute:null});
    }else if(finals.has(match.status)||live.has(match.status))visible.set(match.id,match);
  }
  return {matches:visible,liveCount:allLive.length,detailCount};
}
