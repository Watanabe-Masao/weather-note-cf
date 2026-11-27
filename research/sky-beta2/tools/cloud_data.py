"""雲の材料を集める（#537、11/27 渡辺さん「データ取得の整備から」）。**手元の PC で動かす**（この作業場所からは Open-Meteo・気象庁に届かない）。
python3 cloud_data.py 2026-11-13 2026-11-20 ... [--out cloud-data]
日ごとに、取った応答を**加工せずそのまま**保存する（解析はあとで。受け取り時刻と URL は manifest.json に）。標準ライブラリだけで動く。

取るもの（どれも高知 33.56°N・133.53°E と、その日の日の入りの方位に沿って 25・50・100・200 km 先の 4 点）：
1. 衛星の日射（Open-Meteo Satellite Radiation API、ひまわり、10 分ごと）：shortwave_radiation（全天）・direct_radiation・diffuse_radiation。
   直達・散乱は全天からの分離モデルの値（ひまわりは全天だけ）。models=satellite_radiation_seamless（ページの例の値。日本でひまわりが選ばれるかは応答の確認が要る）
2. 予報の雲（Open-Meteo Historical Forecast API）：cloud_cover・cloud_cover_low（〜3 km）・cloud_cover_mid（3〜8 km）・cloud_cover_high（8 km〜）・shortwave_radiation。
   **このエンドポイントは、まだ確かめていない**（失敗したら manifest に残る）
3. 高知の地上観測（気象庁 過去の気象データ 1 時間ごと・10 分ごと）：全天日射量・日照時間・降水量・天気（アプリの jma-tables.ts と同じ表）。高知の 1 点だけ
4. AOD（Open-Meteo Air Quality、CAMS 全球）：aerosol_optical_depth。高知の 1 点だけ

出典：Open-Meteo.com（CC BY 4.0）、JMA・JAXA（ひまわり）、Copernicus（CAMS）、気象庁。鍵やアカウントは要らない。"""
import datetime as dt, json, math, os, sys, time, urllib.parse, urllib.request

KOCHI = (33.5667, 133.5483)  # 高知地方気象台（アプリの地点の座標と同じ桁で）
DIST_KM = [25, 50, 100, 200]
UA = {"User-Agent": "weather-note-research (cloud data, run by hand)"}


def sunset_azimuth(day: dt.date, lat: float) -> float:
    """日の入りの方位（北から東回り、度）。赤緯は日付からの近似（誤差 0.5° 程度。方位の目安に使うだけ）。"""
    n = day.timetuple().tm_yday
    decl = math.radians(23.44) * math.sin(2 * math.pi * (284 + n) / 365)
    a = math.degrees(math.acos(max(-1, min(1, math.sin(decl) / math.cos(math.radians(lat))))))
    return 360 - a


def dest(lat, lon, az_deg, km):
    R = 6371.0
    p1, l1, th, d = math.radians(lat), math.radians(lon), math.radians(az_deg), km / R
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(th))
    l2 = l1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return round(math.degrees(p2), 4), round(math.degrees(l2), 4)


def get(url: str, path: str, log: list):
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            body = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        body, status = e.read(), e.code
    except Exception as e:  # noqa: BLE001
        body, status = str(e).encode(), None
    received = dt.datetime.now(dt.timezone.utc).isoformat()
    open(path, "wb").write(body)
    log.append({"file": os.path.basename(path), "url": url, "status": status, "bytes": len(body), "received_at": received, "seconds": round(time.time() - t0, 2)})
    time.sleep(1.0)  # 間をあける


def om(base: str, lat: float, lon: float, day: str, **q) -> str:
    p = {"latitude": lat, "longitude": lon, "start_date": day, "end_date": day, "timezone": "Asia/Tokyo", **q}
    return base + "?" + urllib.parse.urlencode(p)


def main():
    args = sys.argv[1:]
    out = "cloud-data"
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i : i + 2]
    for d in args:
        day = dt.date.fromisoformat(d)
        folder = os.path.join(out, d)
        os.makedirs(folder, exist_ok=True)
        log: list = []
        az = sunset_azimuth(day, KOCHI[0])
        points = [("kochi", *KOCHI)] + [(f"west{km}", *dest(*KOCHI, az, km)) for km in DIST_KM]
        for name, lat, lon in points:
            get(om("https://satellite-api.open-meteo.com/v1/archive", lat, lon, d,
                   hourly="shortwave_radiation,direct_radiation,diffuse_radiation", models="satellite_radiation_seamless", temporal_resolution="native"),
                os.path.join(folder, f"satellite-{name}.json"), log)
            get(om("https://historical-forecast-api.open-meteo.com/v1/forecast", lat, lon, d,
                   hourly="cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,shortwave_radiation"),
                os.path.join(folder, f"forecast-clouds-{name}.json"), log)
        get(om("https://air-quality-api.open-meteo.com/v1/air-quality", *KOCHI, d, hourly="aerosol_optical_depth", domains="cams_global"),
            os.path.join(folder, "aod-kochi.json"), log)
        for kind in ("hourly", "10min"):
            url = f"https://www.data.jma.go.jp/obd/stats/etrn/view/{kind}_s1.php?prec_no=74&block_no=47893&year={day.year}&month={day.month}&day={day.day}&view="
            get(url, os.path.join(folder, f"jma-{kind}-kochi.html"), log)
        json.dump({"date": d, "sunset_azimuth_deg": round(az, 1), "points": [{"name": n, "lat": a, "lon": b} for n, a, b in points], "requests": log},
                  open(os.path.join(folder, "manifest.json"), "w"), ensure_ascii=False, indent=1)
        bad = [x for x in log if x["status"] != 200]
        print(d, f"日の入りの方位 {az:.1f}°", f"取得 {len(log) - len(bad)}/{len(log)}", "失敗：" + ", ".join(f"{x['file']}({x['status']})" for x in bad) if bad else "")
    print("できたフォルダを zip にして送ってください：", out)


if __name__ == "__main__":
    main()
