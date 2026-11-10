"""Build a key-free fixtures snapshot from football-data.org using the server-side secret."""
import json, os, pathlib, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
token=os.environ.get("FOOTBALL_DATA_API_KEY","").strip()
if not token: raise SystemExit("FOOTBALL_DATA_API_KEY secret is missing")
codes={"en":"PL","es":"PD","de":"BL1","it":"SA","fr":"FL1","cl":"CL","br":"BSA","nl":"DED","pt":"PPL","eng2":"ELC"}
today=datetime.now(timezone.utc).date()
start=(today-timedelta(days=45)).isoformat()
end=(today+timedelta(days=30)).isoformat()
retention_start=(today-timedelta(days=120)).isoformat()
out={"updated":datetime.now(timezone.utc).isoformat(),"matches":[],"errors":{},"coverage":{"history_days_requested":45,"future_days_requested":30,"retention_days":120}}
for league,code in codes.items():
    url=f"https://api.football-data.org/v4/competitions/{code}/matches?dateFrom={start}&dateTo={end}"
    req=urllib.request.Request(url,headers={"X-Auth-Token":token,"Accept":"application/json","User-Agent":"KoraZol/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=22) as res: data=json.load(res)
        for m in data.get("matches",[]):
            home=m.get("homeTeam") or {};away=m.get("awayTeam") or {}
            if not home.get("name") or not away.get("name"):continue
            status=m.get("status","SCHEDULED")
            score=m.get("score") or {}
            full=score.get("fullTime") or {}
            hs,aw=full.get("home"),full.get("away")
            events=m.get("goals") or []
            if not isinstance(events,list): events=[]
            details=[{"minute":g.get("minute"),"type":"goal","player":(g.get("scorer") or {}).get("name"),"team":(g.get("team") or {}).get("name")} for g in events if isinstance(g,dict)]
            out["matches"].append({"events":details,"matchday":m.get("matchday"),"stage":m.get("stage"),"halfTime":score.get("halfTime"),"id":f"fd:{m.get('id')}","league":league,"home":home.get("shortName") or home["name"],"away":away.get("shortName") or away["name"],"homeLogo":home.get("crest") or "","awayLogo":away.get("crest") or "","date":m.get("utcDate"),"score":f"{hs} - {aw}" if hs is not None and aw is not None else "— : —","status":status,"live":status in ("IN_PLAY","PAUSED","EXTRA_TIME","PENALTY_SHOOTOUT"),"source":"football-data.org"})
    except (urllib.error.URLError,TimeoutError,ValueError) as e:out["errors"][league]=str(e)[:140]
    time.sleep(7)
path=pathlib.Path("data/fixtures.json");path.parent.mkdir(exist_ok=True)
if path.exists():
    old=json.loads(path.read_text(encoding="utf-8"))
    seen={m["id"] for m in out["matches"]}
    out["matches"] += [m for m in old.get("matches",[]) if m.get("id") not in seen and m.get("date","")[:10]>=retention_start]
out["matches"]=[m for m in out["matches"] if m.get("date","")[:10]>=retention_start]
out["matches"].sort(key=lambda m:m.get("date") or "")
out["coverage"]["matches_total"]=len(out["matches"])
out["coverage"]["matches_by_league"]={league:sum(m.get("league")==league for m in out["matches"]) for league in codes}
out["coverage"]["oldest_match"]=out["matches"][0].get("date") if out["matches"] else None
out["coverage"]["newest_match"]=out["matches"][-1].get("date") if out["matches"] else None
if not out["matches"]:raise SystemExit("No fixtures retrieved; keeping previous snapshot")
path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("Fixture count:",len(out["matches"]),"errors:",out["errors"])
