# #250 FH-03: a closer look at the three outside records before taking anything in.
# 1) jniimi (HF): 高知 month by month — coverage, gaps, what each column means, how late it is read.
# 2) shiromatz (GitHub): what each zip holds, from when 高知 is in, and whether it agrees with jniimi.
# 3) Open-Meteo Previous Runs: for 高知, how complete day1..7 are, year by year, per model.
import io, json, os, sys, zipfile, urllib.request, collections, datetime as dt
import pandas as pd

def get(u, t=120):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "weather-note-research"}), timeout=t) as r:
        return r.read()

print("# FH-03")
print("## 1. jniimi：高知の月ごと")
files = [s["rfilename"] for s in json.loads(get("https://huggingface.co/api/datasets/jniimi/weather_forecast_japan"))["siblings"] if s["rfilename"].endswith(".parquet")]
print("files:", len(files), files[0], "…", files[-1])
allk = []
for f in files:
    d = pd.read_parquet(io.BytesIO(get(f"https://huggingface.co/datasets/jniimi/weather_forecast_japan/resolve/main/{f}")))
    k = d[d.observatory_code.astype(str) == "390000"].copy()
    allk.append(k)
    issues = k.groupby(["from_date", "from_hour"]).size()
    days = pd.to_datetime(k.from_date).dt.date.nunique()
    print(f"{f[-15:-8]}: rows {len(k):5}, 発表 {len(issues):4}, 日 {days:2}, 時刻 {sorted(k.from_hour.unique().tolist())}, diff_days {sorted(k.diff_days.astype(int).unique().tolist())}")
k = pd.concat(allk)
print("columns:", list(k.columns))
print("例（同じ発表の0〜7日先）:")
first = k[(k.from_date == k.from_date.max())]
print(first[first.from_hour == first.from_hour.max()].to_string()[:3000])
# How late each issue is read (html_obtained_datetime vs the hour in from_hour).
if "html_obtained_datetime" in k:
    lag = (pd.to_datetime(k.html_obtained_datetime, utc=True) - pd.to_datetime(k.from_date + "T" + k.from_hour.astype(str).str.zfill(2) + ":00:00+09:00", utc=True)).dt.total_seconds() / 60
    print("取得の遅れ（分）:", lag.describe().round(1).to_dict())
for c in ["srf_report_datetime", "week_report_datetime", "weather_code"]:
    if c in k: print(c, "埋まっている割合", round(k[c].notna().mean(), 3), "最初に埋まった日", k[k[c].notna()].from_date.min())
gaps = sorted(set(pd.date_range(k.from_date.min(), k.from_date.max()).date) - set(pd.to_datetime(k.from_date).dt.date))
print("発表のない日:", len(gaps), [str(g) for g in gaps[:40]])

print("\n## 2. shiromatz：zip の中身と高知")
api = "https://api.github.com/repos/shiromatz/Japan-Meteorological-Agency-Weather-Forecast/contents/forecast"
zips = sorted((x["name"], x["download_url"], x["size"]) for x in json.loads(get(api)) if x["name"].endswith(".zip"))
first_kochi = None
for name, url, size in zips:
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    names = [n for n in z.namelist() if n.endswith(".csv")]
    has = [n for n in names if "_3900" in n]
    if has and not first_kochi: first_kochi = name
    if name in (zips[0][0], zips[1][0]) or name.endswith(("202212.zip", "202312.zip", "202412.zip", "202510.zip", "202610.zip")) or (has and first_kochi == name):
        print(f"{name}: {size} bytes, csv {len(names)}: {names[:3]}…, 高知 {has}")
print("高知が最初に入る月:", first_kochi)
# Agreement with jniimi for 2026-10 (the 高知 中部 area against jniimi's 地域全体).
z = zipfile.ZipFile(io.BytesIO(get([u for n, u, s in zips if n == "forecast_202610.zip"][0])))
s = pd.read_csv(z.open([n for n in z.namelist() if "390000" in n][0]))
print("shiromatz 2026-10 高知: areas", sorted(s.areaName.dropna().unique())[:10], "reports", s.reportDatetime.nunique())
print(s[s.reportDatetime == s.reportDatetime.max()].head(14).to_string()[:2500])

print("\n## 3. Open-Meteo Previous Runs：高知、年ごとの埋まり具合（各年 1月・7月の15日間）")
for m in ["jma_gsm", "jma_seamless", "best_match"]:
    for y in range(2018, 2027):
        for mo in ("01", "07"):
            if f"{y}-{mo}" > dt.date.today().strftime("%Y-%m"): continue
            vars_ = ",".join(["temperature_2m"] + [f"temperature_2m_previous_day{i}" for i in range(1, 8)])
            u = f"https://previous-runs-api.open-meteo.com/v1/forecast?latitude=33.5597&longitude=133.5311&hourly={vars_}&models={m}&start_date={y}-{mo}-01&end_date={y}-{mo}-15&timezone=Asia%2FTokyo"
            try:
                h = json.loads(get(u, 60)).get("hourly", {})
                fill = [round(sum(v is not None for v in h.get(f"temperature_2m_previous_day{i}", [])) / max(1, len(h.get("time", []))), 2) for i in range(1, 8)]
                print(f"{m} {y}-{mo}: day1..7 {fill}")
            except Exception as e:
                print(f"{m} {y}-{mo}: {e}")
