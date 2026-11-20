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
    date: f.date
  };
}
export function selectedBy(preferences, match) {
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
export function preferenceAllows(preferences, event) {
  const key = event.type.startsWith('goal') ? 'goal' : event.type;
  return preferences.types.includes(key) && selectedBy(preferences, event.match);
}
export function notificationFor(event, language, appUrl) {
  const match = event.match, ar = language !== 'en';
  const score = match.homeScore === null || match.awayScore === null ? '' : ' ' + match.homeScore + ' - ' + match.awayScore + ' ';
  const body = match.home + (score || ' × ') + match.away + (match.minute !== null && event.type.startsWith('goal') ? ' · ' + match.minute + '′' : '');
  const team = event.type === 'goal-home' ? match.home : match.away;
  const title = event.type.startsWith('goal') ? (ar ? '⚽ زوووط! هدف لـ ' : '⚽ GOAL! ') + team :
    event.type === 'kickoff' ? (ar ? '⚽ بداية المباراة' : '⚽ Kickoff') : (ar ? '🏁 نهاية المباراة' : '🏁 Full time');
  const url = new URL(appUrl);
  url.searchParams.set('team', match.home);
  return {title, body, tag:'korazol-' + event.id, url:url.href};
}
