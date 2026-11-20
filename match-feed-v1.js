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
    bayernmunich:'bayernmuenchen',bayernmunchen:'bayernmuenchen',
    cologne:'koln',koeln:'koln',athleticbilbao:'athleticbilbao',athletic:'athleticbilbao',
    espanyoldebarcelona:'espanyol',rcdespanyol:'espanyol',ahlijeddah:'alahli',ahlisaudi:'alahli',alahlijeddah:'alahli',alahlisaudi:'alahli'
  };
  function teamKey(name) {
    const key = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(fc|cf|afc|sc|club|football|rcd|1)\b/g,'').replace(/[^a-z0-9\u0600-\u06ff]/g,'');
    return aliases[key] || key;
  }
  function mergeMatches(base, incoming, preserveId = true) {
    const result = [...base];
    for (const fresh of incoming) {
      const i = result.findIndex(old => old.id === fresh.id || old.league === fresh.league &&
        teamKey(old.home) && teamKey(old.home) === teamKey(fresh.home) && teamKey(old.away) === teamKey(fresh.away) &&
        Math.abs(Date.parse(old.date)-Date.parse(fresh.date)) <= 3*hour);
      if (i < 0) {result.push(fresh);continue;}
      const old = result[i], chosen = preserveId ? old : fresh;
      result[i] = {...old,...fresh,id:chosen.id,eventId:chosen.eventId || old.eventId || fresh.eventId,
        homeLogo:fresh.homeLogo || old.homeLogo,awayLogo:fresh.awayLogo || old.awayLogo,
        sportScoreId:fresh.id.startsWith('ss:') ? fresh.id : fresh.sportScoreId || old.sportScoreId,
        phase:phaseOf(fresh)};
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
  root.KoraMatchFeed = {localDay,phaseOf,visibleOnDay,mergeMatches,fixtureDays,fetchFixtures};
})(globalThis);
