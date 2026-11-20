const liveStatuses = new Set(['1H','HT','2H','ET','BT','P','LIVE','INT']);
const finalStatuses = new Set(['FT','AET','PEN','AWD','WO']);
const leagueCodes = new Map([[39,'en'],[140,'es'],[78,'de'],[135,'it'],[61,'fr'],[307,'sa'],[2,'cl'],[71,'br'],[88,'nl'],[94,'pt'],[40,'eng2'],[10,'friendly']]);
const aliases = new Map([
  ['bayern','bayernmunich'],['bayernmunchen','bayernmunich'],['manchesterutd','manchesterunited'],
  ['mancity','manchestercity'],['manunited','manchesterunited'],['manutd','manchesterunited'],
  ['athletic','athleticclub'],['athleticbilbao','athleticclub'],['psg','parissaintgermain'],
  ['inter','intermilan'],['internazionale','intermilan'],['newcastle','newcastleunited'],
  ['wolves','wolverhamptonwanderers'],['wolverhampton','wolverhamptonwanderers'],
  ['tottenham','tottenhamhotspur'],['nottingham','nottinghamforest'],
  ['koln','cologne'],['fckoln','cologne'],['1fckoln','cologne'],['1koln','cologne'],
  ['alhilalsaudi','alhilal'],['alnassrsaudi','alnassr']
]);
export function normalizedName(name) {
  const key = String(name || '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g,'ا')
    .replace(/\b(?:fc|cf|afc|sc|ac)\b/g,'').replace(/[^\p{L}\p{N}]/gu,'');
  return aliases.get(key) || key;
}
export function fromFixture(raw) {
  const f = raw?.fixture, home = raw?.teams?.home, away = raw?.teams?.away;
  if (!f?.id || !home?.name || !away?.name || !f?.date || !Number.isFinite(Date.parse(f.date))) return null;
  const goals = raw.goals || {}, status = String(f.status?.short || 'NS');
  return {
    id: String(f.id), home: home.name, away: away.name, league: leagueCodes.get(raw.league?.id) || '',
    homeScore: Number.isInteger(goals.home) ? goals.home : null,
    awayScore: Number.isInteger(goals.away) ? goals.away : null,
    status, minute: Number.isInteger(f.status?.elapsed) ? f.status.elapsed : null,
    date: f.date, cards: Array.isArray(raw.events) ? parseCards(raw.events) : null
  };
}
function parseCards(events) {
  const counts = new Map();
  return events.flatMap(event => {
    const type = event?.type === 'Card' && ({'Yellow Card':'yellow','Red Card':'red'})[event.detail];
    if (!type || !event.team?.name || !event.player?.name) return [];
    const identity = JSON.stringify([type,event.team.id || normalizedName(event.team.name),event.player.id || normalizedName(event.player.name)]);
    const count = (counts.get(identity)||0)+1; counts.set(identity,count);
    return [{id:identity+':'+count,type,team:event.team.name,player:event.player.name,
      minute:Number.isInteger(event.time?.elapsed)?event.time.elapsed:null,
      extra:Number.isInteger(event.time?.extra)?event.time.extra:null}];
  });
}
export function selectedBy(preferences, match) {
  if (preferences.allLive && match.league) return true;
  const home = normalizedName(match.home), away = normalizedName(match.away);
  if (preferences.teams.some(team => [home, away].includes(normalizedName(team)))) return true;
  return preferences.matches.some(item => {
    if (item.id === 'af:' + match.id || item.id === 'apif:' + match.id) return true;
    return normalizedName(item.home) === home && normalizedName(item.away) === away &&
      Math.abs(Date.parse(item.date) - Date.parse(match.date)) <= 3 * 3600000;
  });
}
export function transitions(previous, current) {
  if (!previous || !current) return [];
  const result = [], wasLive = liveStatuses.has(previous.status), isLive = liveStatuses.has(current.status);
  const isFinal = finalStatuses.has(current.status), wasFinal = finalStatuses.has(previous.status);
  if (!wasLive && !wasFinal && previous.status === 'NS' && isLive) result.push('kickoff');
  if (previous.status === '1H' && current.status === 'HT') result.push('halftime');
  if (['1H','HT'].includes(previous.status) && current.status === '2H') result.push('secondhalf');
  // A provider's first appearance for a live match is a baseline, not a goal.
  // Score corrections are saved as the new baseline without creating a false goal.
  if ((wasLive || isLive) && (isLive || isFinal) &&
      [previous.homeScore, previous.awayScore, current.homeScore, current.awayScore].every(Number.isInteger)) {
    if (current.homeScore > previous.homeScore && current.awayScore >= previous.awayScore) result.push('goal-home');
    if (current.awayScore > previous.awayScore && current.homeScore >= previous.homeScore) result.push('goal-away');
  }
  if (!wasFinal && isFinal && (wasLive || previous.status === 'NS')) result.push('fulltime');
  return result;
}
export function newCards(previous, current) {
  if (!Array.isArray(previous?.cards) || !Array.isArray(current?.cards)) return [];
  const known = new Set(previous.cards.map(card=>card.id));
  return current.cards.filter(card=>!known.has(card.id));
}
export function preferenceAllows(preferences, event) {
  const key = event.type.startsWith('goal') ? 'goal' : event.type === 'secondhalf' ? 'kickoff' : event.type;
  return preferences.types.includes(key) && selectedBy(preferences, event.match);
}
export function notificationFor(event, language, appUrl) {
  const match = event.match, ar = language !== 'en';
  const score = match.homeScore === null || match.awayScore === null ? '' : ' ' + match.homeScore + ' - ' + match.awayScore + ' ';
  const card = event.card;
  const body = match.home + (score || ' × ') + match.away + (card ? ' · '+card.player+' ('+card.team+')'+(card.minute!==null?' · '+card.minute+(card.extra?'+'+card.extra:'')+'′':'') : match.minute !== null && event.type.startsWith('goal') ? ' · ' + match.minute + '′' : '')+(match.source==='SportScore'?' · SportScore':'');
  const team = event.type === 'goal-home' ? match.home : match.away;
  const title = event.type.startsWith('goal') ? (ar ? '⚽ زوووط! هدف لـ ' : '⚽ GOAL! ') + team :
    event.type === 'kickoff' ? (ar ? '⚽ بداية المباراة' : '⚽ Kickoff') :
    event.type === 'secondhalf' ? (ar ? '⏱ بداية الشوط الثاني' : '⏱ Second half') :
    event.type === 'halftime' ? (ar ? '⏸ نهاية الشوط الأول' : '⏸ Half time') :
    event.type === 'yellow' ? (ar ? '🟨 بطاقة صفراء' : '🟨 Yellow card') :
    event.type === 'red' ? (ar ? '🟥 بطاقة حمراء' : '🟥 Red card') : (ar ? '🏁 نهاية المباراة' : '🏁 Full time');
  const url = new URL(appUrl);
  url.searchParams.set('team', match.home);
  return {title, body, tag:'korazol-' + event.id, url:url.href};
}
