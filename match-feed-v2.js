(function (root) {
  'use strict';
  const hour = 3600000;
  const localDay = value => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') : '';
  };
  function phaseOf(match) {
    if (['live','finished','upcoming','other'].includes(match.phase)) return match.phase;
    const s = String(match.status || '').toUpperCase().trim();
    if (['POSTPONED','PST','CANCELLED','CANC','SUSPENDED','ABANDONED','ABD','DELAYED'].includes(s)) return 'other';
    if (match.live || ['IN_PLAY','PAUSED','EXTRA_TIME','PENALTY_SHOOTOUT','HT','1H','2H','ET','BT','LIVE','P','INT'].includes(s)) return 'live';
    if (/^(FINISHED|FT|AET|PEN|AWARDED|AWD|WO|FULL TIME|FULL-TIME|AFTER EXTRA TIME|AFTER PENALTIES|FINAL)(\b|$)/.test(s)) return 'finished';
    return 'upcoming';
  }
  function visibleOnDay(match, day, isToday, now = Date.now()) {
    const date = Date.parse(match.date);
    if (!Number.isFinite(date)) return false;
    const phase = phaseOf(match);
    if (localDay(date) === day) return true;
    const age = now - date;
    return isToday && age >= 0 && (phase === 'live' && age <= 8*hour || phase === 'finished' && age <= 12*hour);
  }
  const aliases = {
    bayern:'bayernmuenchen',bayernmunich:'bayernmuenchen',bayernmunchen:'bayernmuenchen',
    cologne:'koln',koeln:'koln',athleticbilbao:'athleticbilbao',athletic:'athleticbilbao',
    espanyoldebarcelona:'espanyol',rcdespanyol:'espanyol',ahlijeddah:'alahli',ahlisaudi:'alahli',alahlijeddah:'alahli',alahlisaudi:'alahli',
    havreathletic:'lehavre',havre:'lehavre',redbullbragantino:'bragantino',vascodagamasaf:'vascodagama',clubedoremo:'remo',athleticparanaense:'paranaense',athleticoparanaense:'paranaense'
  };
  function teamKey(name) {
    const key = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+-\s+(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$/,'').replace(/\b(fc|cf|afc|sc|club|football|rcd|saf|1)\b/g,'').replace(/[^a-z0-9\u0600-\u06ff]/g,'');
    return aliases[key] || key;
  }
  function mergeMatches(base, incoming, preserveId = true) {
    const result = [...base], byId=new Map(), byTeams=new Map();
    const pairKey=m=>{const home=teamKey(m.home),away=teamKey(m.away);return home&&away?JSON.stringify([m.league,home,away]):null};
    const index=(m,i)=>{if(m.id!=null)byId.set(String(m.id),i);const key=pairKey(m);if(key){if(!byTeams.has(key))byTeams.set(key,new Set());byTeams.get(key).add(i)}};
    result.forEach(index);
    for (const fresh of incoming) {
      const pair=pairKey(fresh), stamp=Date.parse(fresh.date);
      let i=fresh.id!=null?byId.get(String(fresh.id)):undefined;
      if(i===undefined&&pair&&Number.isFinite(stamp))i=[...(byTeams.get(pair)||[])].find(j=>pairKey(result[j])===pair&&Math.abs(Date.parse(result[j].date)-stamp)<=3*hour);
      if(i===undefined){index(fresh,result.length);result.push(fresh);continue;}
      const old = result[i], chosen = preserveId ? old : fresh;
      const protect = (phaseOf(old)==='finished'&&phaseOf(fresh)!=='finished')||(phaseOf(old)==='live'&&phaseOf(fresh)==='upcoming');
      const scoreState=protect?{score:old.score,status:old.status,live:old.live,phase:phaseOf(old),minute:old.minute,homeScore:old.homeScore,awayScore:old.awayScore}:{phase:phaseOf(fresh)};
      result[i] = {...old,...fresh,...scoreState,id:chosen.id,eventId:chosen.eventId || old.eventId || fresh.eventId,
        homeLogo:fresh.homeLogo || old.homeLogo,awayLogo:fresh.awayLogo || old.awayLogo,
        sportScoreId:String(fresh.id||'').startsWith('ss:') ? fresh.id : fresh.sportScoreId || old.sportScoreId,
        slug:fresh.slug||old.slug};
      index(result[i],i);if(fresh.id!=null)byId.set(String(fresh.id),i);
    }
    return result;
  }
  function fixtureDays(offset, now = new Date()) {
    const start = new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
    const end = new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset+1);
    let cursor = new Date(offset === 0 ? Math.min(start.getTime(),now.getTime()-12*hour) : start.getTime());
    cursor.setUTCHours(0,0,0,0);
    const days = [];
    while (cursor < end) {days.push(cursor.toISOString().slice(0,10));cursor.setUTCDate(cursor.getUTCDate()+1);}
    return days;
  }
  async function fetchFixtures(offset, now = new Date(), fetcher = fetch) {
    const results = await Promise.allSettled(fixtureDays(offset,now).map(async date => {
      const resp = await fetcher('https://korazol-push.fwadh486.workers.dev/fixtures?date='+date,{cache:'no-store',signal:AbortSignal.timeout(25000)});
      if (!resp.ok) throw Error('Fixture feed HTTP '+resp.status);
      const data = await resp.json();
      if (!Array.isArray(data.matches)) throw Error('Invalid fixture feed');
      return data;
    }));
    const good = results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    return {events:mergeMatches([],good.flatMap(r=>r.matches)),successCount:good.length,partial:good.length!==results.length||good.some(r=>r.partial)};
  }
  function resultDays(now=new Date(),count=3,offset=0){
    const days=[];for(let i=0;i<count;i++)days.push(localDay(new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset-i)));
    return days;
  }
  function completedResults(matches,days){
    const allowed=new Set(days);
    return mergeMatches([],matches).filter(m=>phaseOf(m)==='finished'&&/^\d+\s*[-:]\s*\d+$/.test(String(m.score))&&allowed.has(localDay(m.date))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  }
  async function fetchResultHistory(now=new Date(),count=3,fetcher=fetch){
    // Fetch each UTC calendar date once. Historical days do not need continuous polling.
    const dates=[...new Set(Array.from({length:count-1},(_,i)=>fixtureDays(-i-1,now)).flat())];
    let events=[],successCount=0,partial=false;
    for(const date of dates){try{
      const response=await fetcher('https://korazol-push.fwadh486.workers.dev/fixtures?date='+date,{cache:'no-store',signal:AbortSignal.timeout(22000)});
      if(!response.ok)throw Error('Fixture history HTTP '+response.status);
      const data=await response.json();if(!Array.isArray(data.matches))throw Error('Invalid fixture history');
      events=mergeMatches(events,data.matches);successCount++;partial=partial||Boolean(data.partial);
    }catch{partial=true}}
    return {events:completedResults(events,resultDays(now,count)),successCount,partial};
  }
  function detailUrl(match,options={}){
    const p=new URLSearchParams({id:String(match.id||match.league+':'+match.eventId)});
    if(match.date&&Number.isFinite(Date.parse(match.date)))p.set('date',new Date(match.date).toISOString().slice(0,10));
    const sid=match.sportScoreId||(/^ss:/.test(match.id)?match.id:null);
    if(sid&&/^ss:[a-z0-9]+$/i.test(sid)&&/^[a-z0-9-]+$/i.test(match.slug||'')){p.set('sport',sid);p.set('slug',match.slug)}
    if(options.tab)p.set('tab',options.tab);if(options.side)p.set('side',options.side);
    return './match-details.html?'+p.toString();
  }
  root.KoraMatchFeed = {localDay,phaseOf,visibleOnDay,mergeMatches,fixtureDays,fetchFixtures,resultDays,completedResults,fetchResultHistory,detailUrl};
})(globalThis);

