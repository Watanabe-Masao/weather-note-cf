#!/usr/bin/env bash
# #250 FH-02: the outside archives of past forecasts — what they really hold for 高知. Read-only.
set -u
echo "## 1. shiromatz/Japan-Meteorological-Agency-Weather-Forecast（気象庁の予報 JSON の記録、CC BY-SA 4.0）"
api=https://api.github.com/repos/shiromatz/Japan-Meteorological-Agency-Weather-Forecast
echo "- 最後の push: $(curl -s $api | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("pushed_at"),d.get("license",{}).get("spdx_id"))')"
echo "- forecast/ の月: $(curl -s $api/contents/forecast | python3 -c 'import json,sys;d=json.load(sys.stdin);n=sorted(x["name"] for x in d);print(len(n),n[:2],n[-3:])')"
last=$(curl -s $api/contents/forecast | python3 -c 'import json,sys;d=json.load(sys.stdin);print(sorted(x["download_url"] for x in d if x["name"].endswith(".zip"))[-1])')
first=$(curl -s $api/contents/forecast | python3 -c 'import json,sys;d=json.load(sys.stdin);print(sorted(x["download_url"] for x in d if x["name"].endswith(".zip"))[0])')
for u in $first $last; do
  curl -sL -o f.zip "$u"; echo "--- $u ($(wc -c < f.zip) bytes)"
  unzip -l f.zip | grep 390000
  unzip -o -q f.zip '*390000*' -d f && f=$(ls f/*390000* | head -1) && { wc -l "$f"; head -3 "$f" | cut -c1-600; echo "..."; python3 - "$f" <<'PY'
import csv,sys,collections
r=list(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig")))
print("columns:",list(r[0].keys()))
for k in ("reportDatetime","report_datetime","reportDateTime"):
    if k in r[0]: print("reports:",len({x[k] for x in r}),min(x[k] for x in r),"〜",max(x[k] for x in r))
for k in r[0]:
    if "time" in k.lower() or "date" in k.lower(): print(k, sorted({x[k] for x in r})[:2], "…", sorted({x[k] for x in r})[-2:])
PY
  }
  rm -rf f f.zip
done
echo "## 2. Open-Meteo Previous Runs（高知、JMA GSM / MSM / seamless）"
for m in jma_gsm jma_msm jma_seamless; do for d in 2018-06-01 2019-01-15 2023-08-01 2026-11-10; do
  u="https://previous-runs-api.open-meteo.com/v1/forecast?latitude=33.5597&longitude=133.5311&hourly=temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day3,temperature_2m_previous_day5,precipitation_previous_day1,weather_code_previous_day2&models=$m&start_date=$d&end_date=$d&timezone=Asia%2FTokyo"
  echo "- $m $d: $(curl -s --max-time 40 "$u" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
except Exception as e: print("not json"); sys.exit()
if "error" in d: print("error",d.get("reason")); sys.exit()
h=d.get("hourly",{}); 
print({k:(v[12] if isinstance(v,list) and len(v)>12 else v) for k,v in h.items() if k!="time"})')"
done; done
echo "## 3. jniimi/weather_forecast_japan（Hugging Face）"
curl -s https://huggingface.co/api/datasets/jniimi/weather_forecast_japan | python3 -c 'import json,sys;d=json.load(sys.stdin);print("lastModified",d.get("lastModified"),"license",[t for t in d.get("tags",[]) if t.startswith("license")],"files",[s["rfilename"] for s in d.get("siblings",[])][:10])'
