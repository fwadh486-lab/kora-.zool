"""Fetch friendly matches from API-Football on GitHub Actions; never expose API keys to browsers."""
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

key = os.environ.get("API_FOOTBALL_KEY", "").strip()
if not key:
    print("API_FOOTBALL_KEY not configured; existing friendly snapshot unchanged")
    raise SystemExit(0)

date = datetime.now(timezone.utc).date().isoformat()
url = "https://v3.football.api-sports.io/fixtures?" + urllib.parse.urlencode({"date": date})
request = urllib.request.Request(url, headers={"x-apisports-key": key, "Accept": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.load(response)
except (urllib.error.URLError, TimeoutError, ValueError) as exc:
    raise SystemExit("Friendly feed failed; previous snapshot retained: " + str(exc))

if payload.get("errors"):
    raise SystemExit("Provider returned errors; previous snapshot retained: " + str(payload["errors"])[:180])
if not isinstance(payload.get("response"), list):
    raise SystemExit("Invalid provider response; previous snapshot retained")

matches = []
for item in payload["response"]:
    league = item.get("league") or {}
    name = str(league.get("name") or "")
    if not any(word in name.lower() for word in ("friendl", "friendly", "amistoso")):
        continue
    fixture = item.get("fixture") or {}
    teams = item.get("teams") or {}
    home, away = teams.get("home") or {}, teams.get("away") or {}
    if not home.get("name") or not away.get("name") or not fixture.get("id"):
        continue
    status = (fixture.get("status") or {}).get("short") or ""
    goals = item.get("goals") or {}
    hs, aw = goals.get("home"), goals.get("away")
    is_live = status in ("1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT")
    matches.append({
        "id": "apif:" + str(fixture["id"]),
        "league": "clubfriendly" if "club" in name.lower() else "friendly",
        "competition": name,
        "home": home["name"], "away": away["name"],
        "homeLogo": home.get("logo") or "", "awayLogo": away.get("logo") or "",
        "date": fixture.get("date"),
        "score": f"{hs} - {aw}" if hs is not None and aw is not None else "— : —",
        "status": status,
        "live": is_live,
        "source": "API-Football"
    })

path = pathlib.Path("data/friendlies.json")
path.parent.mkdir(exist_ok=True)
output = {"updated": datetime.now(timezone.utc).isoformat(), "date": date, "matches": matches}
path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Friendly fixtures:", len(matches))
