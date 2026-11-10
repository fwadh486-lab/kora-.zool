"""Fetch a server-side API-Football snapshot without exposing the API key."""
import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KEY = os.getenv("API_FOOTBALL_KEY", "").strip()
if not KEY:
    raise SystemExit("Missing API_FOOTBALL_KEY GitHub Actions secret")
BASE = "https://v3.football.api-sports.io"
LEAGUES = {"en": 39, "es": 140, "de": 78, "it": 135, "fr": 61, "cl": 2, "sa": 307}
today = datetime.now(timezone.utc).date()
year = today.year if today.month >= 7 else today.year - 1
errors = {}
calls = 0

def request(path, params):
    global calls
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-apisports-key": KEY, "Accept": "application/json", "User-Agent": "KoraZol/1.0"})
    calls += 1
    with urllib.request.urlopen(req, timeout=25) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise ValueError(str(payload["errors"])[:180])
    return payload.get("response", [])

def convert(raw, league):
    fixture = raw.get("fixture") or {}
    teams = raw.get("teams") or {}
    goals = raw.get("goals") or {}
    status = (fixture.get("status") or {}).get("short", "NS")
    hs, aw = goals.get("home"), goals.get("away")
    return {
        "id": "af:" + str(fixture.get("id")), "apiFixtureId": fixture.get("id"),
        "league": league, "home": (teams.get("home") or {}).get("name", ""),
        "away": (teams.get("away") or {}).get("name", ""),
        "homeTeamId": (teams.get("home") or {}).get("id"),
        "awayTeamId": (teams.get("away") or {}).get("id"),
        "homeLogo": (teams.get("home") or {}).get("logo", ""),
        "awayLogo": (teams.get("away") or {}).get("logo", ""),
        "date": fixture.get("date"), "score": f"{hs} - {aw}" if hs is not None and aw is not None else "— : —",
        "status": status, "live": status in ("1H", "2H", "HT", "ET", "P", "BT"),
        "source": "API-Football", "matchday": (raw.get("league") or {}).get("round"),
    }

snapshot = {"updated": datetime.now(timezone.utc).isoformat(), "matches": [], "lastLineups": {}, "errors": errors}
# Keep requests modest on the free plan: 7 competition calls, up to 12 lineup calls.
for code, league_id in LEAGUES.items():
    try:
        raw = request("/fixtures", {"league": league_id, "season": year, "from": (today - timedelta(days=14)).isoformat(), "to": (today + timedelta(days=15)).isoformat()})
        snapshot["matches"].extend(convert(item, code) for item in raw if item.get("fixture", {}).get("id"))
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        errors[code] = str(exc)[:180]
    time.sleep(0.3)

# For upcoming matches, reuse the last confirmed starting XI per team.
upcoming = sorted((m for m in snapshot["matches"] if m["score"] == "— : —" and m.get("date") and m["date"] >= today.isoformat()), key=lambda m: m["date"])
team_candidates = {}
for m in upcoming:
    for side in ("home", "away"):
        team_id = m.get(side + "TeamId")
        if team_id and team_id not in team_candidates:
            team_candidates[team_id] = (m["league"], m[side])
    if len(team_candidates) >= 12:
        break

finished = sorted((m for m in snapshot["matches"] if m["status"] in ("FT", "AET", "PEN")), key=lambda m: m.get("date") or "", reverse=True)
for team_id, (league, team_name) in list(team_candidates.items())[:12]:
    previous = next((m for m in finished if m.get("homeTeamId") == team_id or m.get("awayTeamId") == team_id), None)
    if not previous:
        continue
    try:
        response = request("/fixtures/lineups", {"fixture": previous["apiFixtureId"]})
        lineup = next((x for x in response if (x.get("team") or {}).get("id") == team_id), None)
        if not lineup or len(lineup.get("startXI") or []) < 10:
            continue
        players = []
        for entry in lineup["startXI"]:
            player = entry.get("player") or {}
            players.append({"name": player.get("name", ""), "number": player.get("number"), "position": player.get("pos", ""), "grid": player.get("grid", "")})
        snapshot["lastLineups"][str(team_id)] = {"team": team_name, "date": previous["date"], "formation": lineup.get("formation"), "players": players, "sourceFixture": previous["apiFixtureId"]}
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        errors["lineup:" + str(team_id)] = str(exc)[:140]
    time.sleep(0.3)

path = pathlib.Path("data/api-football.json")
path.parent.mkdir(exist_ok=True)
if path.exists():
    old = json.loads(path.read_text(encoding="utf-8"))
    seen = {m["id"] for m in snapshot["matches"]}
    snapshot["matches"].extend(m for m in old.get("matches", []) if m.get("id") not in seen and (m.get("date") or "") >= (today - timedelta(days=14)).isoformat())
    for team_id, item in old.get("lastLineups", {}).items():
        snapshot["lastLineups"].setdefault(team_id, item)
if not snapshot["matches"]:
    raise SystemExit("API-Football returned no fixtures. Check subscription access; preserving previous snapshot.")
path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("API-Football fixtures:", len(snapshot["matches"]), "lineups:", len(snapshot["lastLineups"]), "calls:", calls, "errors:", errors)
