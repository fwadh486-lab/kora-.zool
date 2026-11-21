"""Fetch licensed football-data.org standings into a public, key-free JSON snapshot."""
import json
import os
import pathlib
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

TOKEN = os.environ.get("FOOTBALL_DATA_API_KEY", "").strip()
LEAGUES = {"cl": "CL", "en": "PL", "es": "PD", "de": "BL1", "it": "SA", "fr": "FL1", "br": "BSA", "nl": "DED", "pt": "PPL", "eng2": "ELC"}
SPORTSCORE = {"cl":"uefa-champions-league", "it":"italian-serie-a", "sa":"saudi-professional-league", "sd":"sudanese-premier-league", "rw":"rwandan-national-league", "qa":"qatar-stars-league", "el":"uefa-europa-league", "cafcl":"caf-champions-league", "nations":"uefa-nations-league", "euro":"uefa-european-championship"}
out = {"updated": datetime.now(timezone.utc).isoformat(), "leagues": {}, "groups": {}, "leagueUpdated": {}, "leagueSource": {}, "errors": {}}
for code, competition in (LEAGUES.items() if TOKEN else []):
    req = urllib.request.Request(
        f"https://api.football-data.org/v4/competitions/{competition}/standings",
        headers={"X-Auth-Token": TOKEN, "Accept": "application/json", "User-Agent": "KoraZol/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.load(response)
        standings = next((s for s in data.get("standings", []) if s.get("type") == "TOTAL" and (code != "cl" or len(s.get("table") or []) == 36)), None)
        if not standings or not standings.get("table"):
            raise ValueError("No total standings returned")
        out["leagues"][code] = [
            {
                "rank": row.get("position"),
                "team": row.get("team", {}).get("name", ""),
                "crest": row.get("team", {}).get("crest", ""),
                "played": row.get("playedGames", 0),
                "won": row.get("won", 0),
                "draw": row.get("draw", 0),
                "lost": row.get("lost", 0),
                "gd": row.get("goalDifference", 0),
                "points": row.get("points", 0),
                "form": row.get("form", ""),
            }
            for row in standings["table"]
        ]
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as exc:
        out["errors"][code] = str(exc)[:160]
    else:
        out["leagueUpdated"][code] = out["updated"]
        out["leagueSource"][code] = "football-data.org"
    time.sleep(7)
for code, slug in SPORTSCORE.items():
    if code in out["leagues"]:
        continue
    try:
        req = urllib.request.Request(f"https://sportscore.com/api/widget/standings/?sport=football&slug={slug}&src=korazol", headers={"Accept":"application/json", "User-Agent":"KoraZol/1.0"})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.load(response)
        if data.get("sport") != "football" or data.get("competition_slug") != slug:
            raise ValueError("Competition mismatch")
        tables = []
        for table in data.get("tables", []):
            rows = [{"rank":r["pos"], "team":r["team"], "crest":r.get("team_logo", ""), "played":r.get("p"), "won":r.get("w"), "draw":r.get("d"), "lost":r.get("l"), "gd":r.get("gd"), "points":r.get("pts"), "form":r.get("form", "")} for r in table.get("rows", []) if r.get("team") and isinstance(r.get("pos"), int)]
            if rows:
                tables.append({"group":table.get("group", ""), "rows":rows})
        if not tables or (code in ("cl", "el") and not (len(tables)==1 and len(tables[0]["rows"])==36)):
            raise ValueError("Complete table unavailable")
        if len(tables)==1:
            out["leagues"][code] = tables[0]["rows"]
        else:
            out["groups"][code] = tables
        out["leagueUpdated"][code] = datetime.now(timezone.utc).isoformat()
        out["leagueSource"][code] = "SportScore"
        out["errors"].pop(code, None)
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as exc:
        out["errors"][code] = str(exc)[:160]
if not out["leagues"] and not out["groups"]:
    raise SystemExit("No standings available: " + json.dumps(out["errors"]))
path = pathlib.Path("data/standings.json")
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    previous = json.loads(path.read_text(encoding="utf-8"))
    for kind in ("leagues", "groups"):
        for code, rows in previous.get(kind, {}).items():
            if code not in out["leagues"] and code not in out["groups"]:
                out[kind][code] = rows
                out["leagueUpdated"][code] = previous.get("leagueUpdated", {}).get(code, previous.get("updated"))
                out["leagueSource"][code] = previous.get("leagueSource", {}).get(code, "football-data.org")
path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Updated:", ", ".join(out["leagues"]), "Errors:", out["errors"])
