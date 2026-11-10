"""Validate API-Football historical free-plan fixtures and starting lineups."""
import json, os, pathlib, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone
key=os.environ.get("API_FOOTBALL_KEY","").strip()
if not key: raise SystemExit("Missing API_FOOTBALL_KEY")
base="https://v3.football.api-sports.io"
calls=0
def get(endpoint,params):
 global calls
 calls+=1
 req=urllib.request.Request(base+endpoint+"?"+urllib.parse.urlencode(params),headers={"x-apisports-key":key,"Accept":"application/json"})
 with urllib.request.urlopen(req,timeout=25) as r: payload=json.load(r)
 if payload.get("errors"): raise ValueError(str(payload["errors"]))
 return payload.get("response") or []
result={"testedAt":datetime.now(timezone.utc).isoformat(),"season":2024,"league":39,"fixtures":[],"lineup":None,"errors":[]}
try:
 fixtures=get("/fixtures",{"league":39,"season":2024,"from":"2024-08-16","to":"2024-08-19"})
 result["fixtureCount"]=len(fixtures)
 result["fixtures"]=[{"id":x.get("fixture",{}).get("id"),"home":x.get("teams",{}).get("home",{}).get("name"),"away":x.get("teams",{}).get("away",{}).get("name"),"score":x.get("goals")} for x in fixtures[:5]]
 for match in fixtures[:5]:
  fid=match.get("fixture",{}).get("id")
  if not fid: continue
  try:
   lineups=get("/fixtures/lineups",{"fixture":fid})
   for entry in lineups:
    players=[{"name":p.get("player",{}).get("name"),"number":p.get("player",{}).get("number"),"position":p.get("player",{}).get("pos"),"grid":p.get("player",{}).get("grid")} for p in (entry.get("startXI") or [])]
    if len(players)>=10:
     result["lineup"]={"fixture":fid,"team":(entry.get("team") or {}).get("name"),"formation":entry.get("formation"),"players":players}
     break
   if result["lineup"]: break
  except (urllib.error.URLError,ValueError,TimeoutError) as exc: result["errors"].append("lineup: "+str(exc)[:180])
except (urllib.error.URLError,ValueError,TimeoutError) as exc: result["errors"].append("fixtures: "+str(exc)[:180])
result["requests"]=calls
path=pathlib.Path("data/api-football-test.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("Historical test:",json.dumps({"fixtures":result.get("fixtureCount",0),"lineupPlayers":len((result.get("lineup") or {}).get("players",[])),"errors":result["errors"],"requests":calls},ensure_ascii=False))
if not result.get("fixtureCount") or not result["lineup"]:
 raise SystemExit("Historical test incomplete; inspect data/api-football-test.json")
