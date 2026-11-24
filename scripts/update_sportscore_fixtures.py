"""Refresh a bounded, attributed snapshot of the additional competitions."""
import json
import pathlib
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import re

LEAGUES = {"sd":"sudanese-premier-league", "rw":"rwandan-national-league", "qa":"qatar-stars-league", "sa":"saudi-professional-league", "el":"uefa-europa-league", "cafcl":"caf-champions-league", "afcelite":"afc-champions-league-elite", "nations":"uefa-nations-league", "euro":"uefa-european-championship"}
STATUS = {"not started":"NS", "1st half":"1H", "half time":"HT", "2nd half":"2H", "extra time":"ET", "penalties":"P", "finished":"FT", "after extra time":"AET", "after penalties":"PEN", "postponed":"PST", "cancelled":"CANC", "abandoned":"ABD"}
now = datetime.now(timezone.utc)
days = [(now.date()+timedelta(days=i)).isoformat() for i in range(-3, 8)]

def load(league, slug, day):
    url = f"https://sportscore.com/api/v1/fixtures/?sport=football&date={day}&competition={slug}&limit=200&src=korazol"
    req = urllib.request.Request(url, headers={"Accept":"application/json", "User-Agent":"KoraZol/1.0"})
    with urllib.request.urlopen(req, timeout=12) as response:
        data = json.load(response)
    if data.get("sport") != "football" or data.get("date") != day or not isinstance(data.get("matches"), list):
        raise ValueError("Invalid fixture response")
    matches = []
    for m in data["matches"]:
        path = re.fullmatch(r"/football/match/([a-z0-9-]+)/([a-z0-9]+)/", m.get("url", ""), re.I)
        if not path or not all(m.get(k) for k in ("home", "away", "time")):
            continue
        status = STATUS.get(str(m.get("status_text", "")).lower(), {"live":"LIVE", "upcoming":"NS", "finished":"FT"}.get(m.get("status")))
        if not status:
            continue
        hs, aw = m.get("home_score"), m.get("away_score")
        phase = "live" if status in ("1H","HT","2H","ET","P","LIVE") else "finished" if status in ("FT","AET","PEN") else "upcoming" if status=="NS" else "other"
        matches.append({"id":"ss:"+path[2], "slug":path[1], "league":league, "home":m["home"], "away":m["away"], "homeLogo":m.get("home_logo") or "", "awayLogo":m.get("away_logo") or "", "status":status, "phase":phase, "live":phase=="live", "score":f"{hs} - {aw}" if hs is not None and aw is not None else "— : —", "date":m["time"], "minute":m.get("live_minute"), "source":"SportScore", "sourceUrl":"https://sportscore.com"+m["url"]})
    return matches

path = pathlib.Path("data/sportscore-fixtures.json")
previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
matches = {m["id"]:m for m in previous.get("matches", []) if m.get("date", "")[:10] in days}
errors, successes = {}, 0
with ThreadPoolExecutor(max_workers=5) as pool:
    tasks = {pool.submit(load, league, slug, day):(league, day) for league, slug in LEAGUES.items() for day in days}
    for future in as_completed(tasks):
        league, day = tasks[future]
        try:
            fresh = future.result()
            successes += 1
            for m in fresh:
                matches[m["id"]] = m
        except (OSError, ValueError, KeyError) as exc:
            errors[f"{league}:{day}"] = str(exc)[:100]
if not successes:
    raise SystemExit("Provider unavailable; preserving snapshot")
out = {"updated": now.isoformat(), "source":"SportScore", "matches":sorted(matches.values(), key=lambda m:m["date"]), "errors":errors}
path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
print(f"SportScore: {len(matches)} matches; {successes} successful queries; {len(errors)} failures")
