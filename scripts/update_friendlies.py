"""Refresh verified friendly fixtures; use ESPN if API-Football is unavailable."""
import json
import os
import pathlib
import urllib.parse
import urllib.request
from datetime import datetime, timezone

def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.load(response)

def api_matches(date, key, fetch=get_json):
    if not key:
        raise ValueError("API-Football key unavailable")
    payload = fetch("https://v3.football.api-sports.io/fixtures?" + urllib.parse.urlencode({"date": date}), {"x-apisports-key": key})
    if payload.get("errors") or not isinstance(payload.get("response"), list):
        raise ValueError("API-Football unavailable")
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
    return matches

def espn_matches(date, fetch=get_json):
    matches, errors = [], []
    for league, code in (("friendly","fifa.friendly"),("clubfriendly","club.friendly"),("nonfifa","nonfifa")):
        try:
            payload = fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + code + "/scoreboard?dates=" + date.replace("-", ""))
            if not isinstance(payload.get("events"), list):
                raise ValueError("Invalid events")
            for ev in payload["events"]:
                comp = (ev.get("competitions") or [{}])[0]
                teams = {t.get("homeAway"): t for t in comp.get("competitors", [])}
                h, a = teams.get("home", {}), teams.get("away", {})
                hn, an = h.get("team", {}).get("displayName"), a.get("team", {}).get("displayName")
                if not hn or not an or not ev.get("id") or not ev.get("date"):
                    continue
                status = ev.get("status", {}).get("type", {})
                state = status.get("state")
                hs, aw = h.get("score"), a.get("score")
                score = f"{hs} - {aw}" if state != "pre" and hs is not None and aw is not None else "— : —"
                phase = "live" if state == "in" else "finished" if state == "post" and status.get("completed") else "other" if state == "post" else "upcoming"
                matches.append({"id": league+":"+str(ev["id"]), "eventId":str(ev["id"]), "league":league, "home":hn, "away":an, "homeLogo":h.get("team",{}).get("logo",""), "awayLogo":a.get("team",{}).get("logo",""), "date":ev["date"], "score":score, "status":status.get("shortDetail",""), "phase":phase, "live":phase=="live", "source":"ESPN"})
        except Exception:
            errors.append(league)
    if len(errors) == 3:
        raise ValueError("All ESPN friendly feeds unavailable")
    return matches, errors

def build_snapshot(date, key, fetch=get_json):
    try:
        matches = api_matches(date,key,fetch)
        source, missing = "API-Football", []
    except Exception:
        print("API-Football unavailable; trying ESPN fallback")
        matches, missing = espn_matches(date,fetch)
        source = "ESPN"
    return {"updated":datetime.now(timezone.utc).isoformat(),"date":date,"source":source,"partial":bool(missing) or source=="ESPN","missingLeagues":missing,"matches":matches}

if __name__ == "__main__":
    date=datetime.now(timezone.utc).date().isoformat()
    try:
        output=build_snapshot(date,os.environ.get("API_FOOTBALL_KEY","").strip())
    except Exception:
        raise SystemExit("No verified friendly feed available; previous snapshot retained")
    path=pathlib.Path("data/friendlies.json")
    path.parent.mkdir(exist_ok=True)
    temporary=path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    temporary.replace(path)
    print("Friendly fixtures:",len(output["matches"]),"source:",output["source"],"partial:",output["partial"])
