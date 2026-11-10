"""Fetch licensed football-data.org standings into a public, key-free JSON snapshot."""
import json
import os
import pathlib
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

TOKEN = os.environ.get("FOOTBALL_DATA_API_KEY", "").strip()
if not TOKEN:
    raise SystemExit("FOOTBALL_DATA_API_KEY secret is missing")
LEAGUES = {"en": "PL", "es": "PD"}
out = {"updated": datetime.now(timezone.utc).isoformat(), "leagues": {}, "errors": {}}
for code, competition in LEAGUES.items():
    req = urllib.request.Request(
        f"https://api.football-data.org/v4/competitions/{competition}/standings",
        headers={"X-Auth-Token": TOKEN, "Accept": "application/json", "User-Agent": "KoraZol/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.load(response)
        standings = next((s for s in data.get("standings", []) if s.get("type") == "TOTAL"), None)
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
    time.sleep(7)
if not out["leagues"]:
    raise SystemExit("No standings available: " + json.dumps(out["errors"]))
path = pathlib.Path("data/standings.json")
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    previous = json.loads(path.read_text(encoding="utf-8"))
    for code, rows in previous.get("leagues", {}).items():
        out["leagues"].setdefault(code, rows)
path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Updated:", ", ".join(out["leagues"]), "Errors:", out["errors"])
