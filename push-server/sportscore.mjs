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
    status,minute:integer(raw.live_minute),date:raw.time,cards:incidents(raw)};
}
async function request(path,params){
  const url=new URL(path,'https://sportscore.com');
  for(const [key,value] of Object.entries({sport:'football',src:'korazol',...params}))url.searchParams.set(key,String(value));
  const response=await fetch(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('sportscore_http_'+response.status);
  return response.json();
}
async function list(date,status){
  const data=await request('/api/v1/fixtures/',{date,status,limit:200});
  if(!Array.isArray(data.matches)||data.sport!=='football')throw Error('sportscore_invalid_list');
  return data.matches.map(fromSportScore).filter(Boolean);
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
