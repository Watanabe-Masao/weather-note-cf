# The app end to end in a real browser (Playwright, Python): every screen and the main flows,
# against the built app (dist/client) with the weather API answered by made-up data.
#
# Run:  npx vite build && python3 e2e/e2e.py [width]   (WN_PART=1 / 2: the first or second half only, as CI runs it)
#       WN_CHROME=/path/to/chrome to use a given browser; exits 1 when a check fails (CI).
import re
import time
import json, re, sys, datetime, random, threading, http.server, functools, os, traceback
import math as _math
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
# The same wide face everywhere (DejaVu Sans is on CI and here, and is wider than the phones' faces),
# so the layout checks see what CI sees, and what fits here fits on a phone.
WIDE_FONT = ":root{--font-numeric:'DejaVu Sans',sans-serif!important;--font-family:'DejaVu Sans',sans-serif!important}"
DIST = os.environ.get("WN_DIST", os.path.join(HERE, "..", "dist", "client"))
OUT = os.environ.get("WN_SHOTS", os.path.join(HERE, "shots"))
TODAY = datetime.date(2026, 11, 10)
SKY = ["晴", "曇時々晴", "晴後一時曇", "曇一時雨", "雨後曇", "快晴", "曇"]

# 2026-11-08 is a 強風 day (as 2024-04-09 in Kochi: 最大風速 14.4, 最大瞬間 24.8) for the summary (#176).
STORM_DAY = datetime.date(2026, 11, 8)
def row(d, kind="actual"):
    base = row0(d, kind)
    if d == STORM_DAY: base.update(windMax=14.4, gust=24.8)
    return base

def row0(d, kind="actual"):
    r = random.Random(d.toordinal())
    mx = round(19 + 6 * r.random() - (d.month in (12, 1, 2)) * 9, 1)
    mn = round(mx - 6 - 4 * r.random(), 1)
    rain = round(max(0, r.random() * 30 - 18), 1)
    return {"date": d.isoformat(), "n": d.day, "type": kind, "provider": "JMA", "max": mx, "min": mn, "rain": rain,
            "humidity": round(55 + 30 * r.random()), "wind": round(1 + 4 * r.random(), 1),
            "dayWeather": SKY[d.toordinal() % len(SKY)], "snow": (2.0 if (d.year, d.day) == (2025, 8) else 0), "pressure": round(1012 + 8 * r.random(), 1), "gust": round(6 + 6 * r.random(), 1), "humidityMin": round(30 + 20 * r.random()), "sun": round(9 * r.random(), 1), "temp": round(mx - 4, 1), "raw": {"max": str(mx)}, "quality": {}, "unpublished": []}

ME = {"id": "u1", "loginId": "masao", "name": "渡辺", "role": "admin", "research": {"granted": True, "version": 2, "at": 1762800000000}, "consentVersion": 2, "researchWeather": {"granted": True, "version": 1, "at": 1764300000000}, "weatherConsentVersion": 1}
LOGGED_IN = os.environ.get("WN_LOGGED_OUT") != "1"

# 近づいている台風 (/api/typhoon): one made-up typhoon (台風14号 テスト) south of Kochi, its 強風域 holding
# the station and its 暴風警戒域 ahead over it.
TYPHOON_NOW = {"ok": True, "fetchedAt": "2026-11-10T00:00:00Z", "typhoons": [{
    "tc": "TC2699", "number": 14, "name": "テスト", "category": "台風", "scale": "大型", "intensity": "強い",
    "issued": "2026-11-10T09:45:00+09:00",
    "at": {"lat": 31.8, "lon": 133.4, "location": "足摺岬の南東約120km", "course": "北北東", "speedKmh": 25},
    "pressure": 960, "wind": 40, "gust": 55,
    "gale": {"lat": 31.9, "lon": 133.5, "km": 400}, "storm": {"lat": 31.8, "lon": 133.4, "km": 150},
    "warning": [{"lat": 31.9, "lon": 133.5, "km": 180}, {"lat": 34.0, "lon": 134.5, "km": 220}],
    "warningTimes": ["2026-11-10T09:00:00+09:00", "2026-11-11T21:00:00+09:00"],
    "ahead": [{"validtime": "2026-11-10T21:00:00+09:00", "hours": 12, "center": [33.5, 134.0], "circleKm": 60}]}]}
# 雨の見込み（確認用）: the frames as /api/rain-now builds them (now = 12:00 JST, the fixed clock), and made-up
# tiles (a band of rain moving north-east, drawn in plain Python: no imaging library on CI). One past frame
# (11:30) and one hourly frame (18:30〜19:30) answer 404, to show 「取れなかった」.
def _name(minutes):
    t = datetime.datetime(2026, 11, 10, 3, 0, tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=minutes)
    return t.strftime("%Y%m%d%H%M%S")
def _frame(m, kind, product, b, member="none"):
    return {"m": m, "kind": kind, "product": product, "basetime": _name(b), "validtime": _name(m), "member": member}
RAIN_NOW = {"v": 1, "station": "47893", "supported": True, "now": _name(0),
    "frames": [_frame(m, "obs", "hrpns", m) for m in range(-180, 1, 5)] + [_frame(m, "nowcast", "hrpns", 0) for m in range(5, 61, 5)]
      + [_frame(m, "hourly", "rasrf", -30) for m in range(90, 871, 60)],
    "hours": [_frame(m, "hourly", "rasrf", m) for m in range(-360, 1, 60)] + [_frame(m, "hourly", "rasrf", -30) for m in range(30, 871, 60)],
    "lists": {"obs": {"ok": True, "count": 37, "latest": _name(0)}, "nowcast": {"ok": True, "count": 12, "latest": _name(0)}, "rasrf": {"ok": True, "count": 14, "latest": _name(-30)}},
    "fetchedAt": "2026-11-10T03:00:30Z", "source": "気象庁ホームページ「雨雲の動き」「今後の雨」"}
RAIN_MISSING = {_name(-30), _name(450)}
RAIN_COLORS = [(242, 242, 255), (160, 210, 255), (33, 140, 255), (0, 65, 255), (250, 245, 0), (255, 153, 0), (255, 40, 0), (180, 0, 104)]
_tile_cache = {}
def rain_tile(path):
    # /api/rain-tile/<product>/<basetime>/<member>/<validtime>/<z>/<x>/<y>.png
    import zlib, struct, math
    parts = path.split("/")
    valid, z, x, y = parts[6], int(parts[7]), int(parts[8]), int(parts[9].split(".")[0])
    if valid in RAIN_MISSING: return None
    key = (valid, z, x, y)
    if key in _tile_cache: return _tile_cache[key]
    t = datetime.datetime.strptime(valid, "%Y%m%d%H%M%S").replace(tzinfo=datetime.timezone.utc)
    h = (t - datetime.datetime(2026, 11, 10, 3, 0, tzinfo=datetime.timezone.utc)).total_seconds() / 3600
    n = 256 * 2 ** z
    rows = []
    for py in range(256):
        row = bytearray([0])
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y * 256 + py) / n))))
        for px in range(256):
            lon = (x * 256 + px) / n * 360 - 180
            # a band from the south-west, 1時間に経度 0.35°・緯度 0.22° ほど北東へ (as the sample)
            du, dv = lon - (133.2 + 0.35 * h), lat - (33.3 + 0.22 * h)
            u = du * 0.83 + dv * 0.56; v = -du * 0.56 + dv * 0.83
            val = 30 * math.exp(-(u * u) / (2 * 0.12 ** 2) - (v * v) / (2 * 0.6 ** 2))
            lv = -1 if val < 0.4 else 0 if val < 1 else 1 if val < 5 else 2 if val < 10 else 3 if val < 20 else 4 if val < 30 else 5
            row += bytes((0, 0, 0, 0)) if lv < 0 else bytes((*RAIN_COLORS[lv], 255))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows))
    chunk = lambda k, d: struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    _tile_cache[key] = png
    return png
TYPHOON_ON = {"on": False}  # the TY step turns the made-up typhoon on, then off again
def api(path, q):
    if path == "/api/typhoon":
        if TYPHOON_ON.get("fail"): return {"ok": False, "fetchedAt": "2026-11-10T03:00:00Z", "typhoons": []}
        if TYPHOON_ON.get("old"): return {"ok": True, "fetchedAt": "2026-11-10T00:00:00Z", "typhoons": []}
        return TYPHOON_NOW if TYPHOON_ON["on"] else {"ok": True, "fetchedAt": "2026-11-10T03:00:00Z", "typhoons": []}
    if path == "/api/auth/me":
        return {"user": ME if LOGGED_IN else None, "setup": False}
    if path == "/api/me/notify":
        return {"settings": {"enabled": True, "times": ["07:30", "12:30", "18:30"], "days": [1, 2, 3, 4, 5]}, "devices": 1}
    if path == "/api/me/weather":
        return {"list": [{"id": "feel:r1", "source": "feel", "at": "2026-11-10T02:00:00Z", "sky": "rain", "intensity": "para", "station": "74181"}]}
    if path == "/api/push/key":
        return {"publicKey": "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"}
    if path == "/api/reports/sync":
        return {"taken": 0, "total": 0, "reports": [], "seq": 0, "more": False}
    if path == "/api/admin/users":
        return {"users": [{"id": "u1", "login_id": "masao", "name": "渡辺", "role": "admin", "created_at": 1762800000000, "last_login": 1762800000000, "disabled_at": None, "reports": 0, "research": None}, {"id": "u2", "login_id": "tanaka", "name": None, "role": "user", "created_at": 1762800000000, "last_login": None, "disabled_at": None, "reports": 3, "research": 1}]}
    if path == "/api/admin/forecast-import":
        return {"first": "2025-01", "last": "2026-11", "next": {"month": "2025-02", "expected": "2025-03-02", "available": False}, "parser": {"telegram": 1, "record": 1}, "months": [{"office": "390000", "month": "2025-01", "commit_sha": "abc", "fetched_at": "2026-11-17T03:00:00Z", "rows": 4791, "issues": 186, "empty_days": [], "overlaps": 0, "differ": 0, "license": "CC BY-SA 4.0"}]}
    if path == "/api/admin/forecast-types":
        # 予報が外れやすい型の確かめ（11/24）: made-up — 1回分の記録、型は固定した9つ（答え合わせはまだ）。
        ids = ["A-min-raised-L1", "B-max-rain-L2-3", "B-max-rain-L4-7", "G-rain-summer-cloudy-L2-3", "G-rain-summer-cloudy-L4-7", "E-min-turning-drop-L4-7", "C-max-moved-L2-3", "C-max-moved-L4-6", "W-max-autumn-falling-L1-3"]
        t = lambda i: {"id": i, "stage": "watch" if i.startswith(("W", "E")) or i.endswith("L4-6") else "candidate", "fs05": "A", "item": "min", "leads": [1], "text": "型 " + i, "frozenAt": "2026-11-24",
                       "expected": {"ratio": 2.0, "ci": [1.5, 2.5], "hitRate": 0.2, "baseRate": 0.1}, "judged": 7, "matched": 1, "matchedDays": 1,
                       "inRule": {"n": 0, "miss": 0}, "outRule": {"n": 0, "miss": 0}, "base": {"n": 0, "miss": 0}, "ratio": None, "ci": None, "directionShare": None, "status": "checking"}
        return {"frozenAt": "2026-11-24", "pass": {"minRatio": 1.3, "ciLowAbove": 1, "minDays": 20, "directionShareAbove": 0.5},
                "runs": [{"day": "2026-11-23", "at": "2026-11-23T17:05:00Z", "judged": 56, "checked": 0, "error": None}], "firstJudged": "2026-11-23T17:05:00Z", "types": [t(i) for i in ids]}
    if path == "/api/admin/maintenance":
        st = lambda i, n, r, ok, w, left, needed, why, last=None: {"id": i, "name": n, "reach": r, "lastOk": ok, "waiting": w, "left": left, "available": True, "needed": needed, "why": why, "last": last}
        ser = lambda e, k, p, l, pend=[], lost=[]: {"expected": e, "kept": k, "pendingCount": p, "lostCount": l, "absentCount": 0, "pending": pend, "lost": lost, "absent": [], "watermark": None}
        return {"at": "2026-11-10T03:00:00Z",
            "judged": {"problems": [], "notes": [{"key": "radarStale", "text": "雨雲レーダーの保存が1時間止まっています（手順 R-03・S1）。"}]},
            "refetch": {"perHour": 3, "stages": [
                st("radar", "雨雲レーダー・解析雨量", "雨雲 約3時間・解析雨量 約12時間", "2026-11-10T02:00:00Z", 27, 2, True, ["取り残し 27", "最後に取れてから間が空いている", "まだ取り戻せる欠け 2"], {"at": "2026-11-10T02:50:00Z", "ok": False, "detail": "0枚を保存・残り27枚（一部取れなかった）"}),
                st("forecast", "予報の電文", "7日", "2026-11-10T02:55:00Z", 0, 3, False, []),
                st("warning", "警報・注意報の電文", "7日", "2026-11-10T02:55:00Z", 0, 3, False, []),
                st("typhoon", "台風の電文", "7日", "2026-11-10T02:55:00Z", None, 3, False, [])]},
            "completeness": {"forecast": {"VPFD51": ser(6, 6, 0, 0), "VPFW50": ser(4, 4, 0, 0)}, "radar": {"hrpns": ser(48, 46, 2, 0, ["2026-11-10T11:00:00+09:00", "2026-11-10T11:30:00+09:00"]), "rasrf": ser(48, 48, 0, 0)}, "lostAll": [], "lostLastDay": [], "absentAll": []},
            "errors": [{"at": "2026-11-10T02:50:00Z", "where": "雨雲の保存", "message": "hrpns 20261110023000/8/222/102: HTTP 503"}, {"at": "2026-11-09T14:43:17Z", "where": "アカウント /api/reports/sync", "message": "Error: This promise was created by a request that has since ended, so it can never settle."}],
            "room": {"d1Size": {"bytes": 66480000, "percent": 0.6}, "d1WritesMonth": {"estimate": 635000, "percent": 1.3, "rowsLastDay": 7054}, "r2": {"bytes": 5138000, "percentOfFree": 0}, "cronRunsLastDay": 288, "cronMissing": 0},
            "lastAudit": {"at": "2026-11-10T01:05:00Z", "result": {"tables": [{"name": "forecast_entries", "rows": 182345}, {"name": "reports", "rows": 412}, {"name": "users", "rows": 3}], "links": [{"name": "予報の値で、もとの発表が無い", "n": 0}, {"name": "肌感の記録で、人がいない", "n": 0}]}},
            "weeklyAudit": {"at": "2026-11-09T18:10:00Z", "result": {"latestOk": True, "historyOk": False, "failed": [], "r2": {"checked": 20, "missing": [], "wrongSize": []},
                "holes": [{"source": "radar:hrpns", "lost": 3, "recovered": 1, "absent": 0}],
                "series": [
                    {"id": "amedas", "name": "アメダスの観測（10分値の原本）", "part": "74182", "first": "2026-11-01T00:00:00+09:00", "last": "2026-11-10T09:00:00+09:00", "have": 63, "missing": 2, "gapCount": 1, "gaps": [{"from": "2026-11-08T06:00:00+09:00", "to": "2026-11-08T15:00:00+09:00", "n": 2}], "ageH": 3.2, "freshH": 12, "fresh": True, "note": "気象庁は約10日しか置かないので、それより前の抜けは取り戻せない。"},
                    {"id": "air", "name": "空気質（CAMS のモデル値）", "part": "47893", "first": "2023-01-01T00:00:00+09:00", "last": "2026-11-09T23:00:00+09:00", "have": 33576, "missing": 0, "gapCount": 0, "gaps": [], "ageH": 28.2, "freshH": 72, "fresh": True, "note": ""},
                    {"id": "forecast", "name": "予報の電文", "part": "VPFD51 390000", "first": "2026-11-10T05:00:00+09:00", "last": "2026-11-10T11:00:00+09:00", "have": 1240, "missing": None, "gapCount": 0, "gaps": [], "ageH": 1.2, "freshH": 13, "fresh": True, "note": ""}]}},
            "offsite": {"configured": True, "lastDay": "2026-11-09", "lastAt": "2026-11-09T16:05:00Z", "days": 23, "bytes": 24117248, "pending": 0, "oldestPending": None, "lastError": None},
            "lastDupCheck": {"at": "2026-11-10T01:00:00Z", "result": [{"name": "予報の電文（同じ中身）", "n": 0, "examples": []}, {"name": "予報の電文（同じ発表時刻に2通以上）", "n": 1, "examples": ["VPFD51 11/9 11:00（2通）"], "note": "訂正報で正しく2通のこともある"}, {"name": "肌感の記録（同じ人・時刻・中身が2件以上）", "n": 0, "examples": []}]}}
    if path == "/api/telegram":
        return {"v": 1, "found": True, "id": q.get("id", ""), "kind": "VPFD51", "office": "390000", "url": "https://www.data.jma.go.jp/developer/xml/data/x.xml", "issuedAt": "2026-11-10T11:00:00+09:00", "fetchedAt": "2026-11-10T02:03:00Z", "hash": "abcdef0123456789", "xml": "<?xml version=\"1.0\"?>\n<Report><Control><Title>府県天気予報（Ｒ１）</Title></Control></Report>", "source": "気象庁 防災情報XML（公共データ利用規約）"}
    if path == "/api/rain-now":
        return RAIN_NOW
    if path == "/api/wxchart-at":
        return {"v": 1, "at": q.get("at", ""), "charts": []}
    if path == "/api/forecast-history":
        # 予報の履歴 (R6): made-up — 2026-10 の記録（shiromatz）を日付だけずらした、TODAY を対象日にした1日分。
        if q.get("date") == TODAY.isoformat():
            with open(os.path.join(HERE, "forecast-history.json"), encoding="utf-8") as f:
                h = json.load(f)
            # 風（2026-11-24、電文の読み直し parser 2）：府県天気予報の天気の文に合わせて、その日の風の文を足す。
            # 発表ごとに文を替えて、変わった印が出るように（作ったもの）。
            words = ["北の風", "北の風　後　北西の風", "北西の風　やや強く"]
            texts = [e for e in h["entries"] if e["element"] == "weather_text"]
            for i, e in enumerate(texts):
                h["entries"].append(dict(e, element="wind_text", value=words[min(i, len(words) - 1)], jma_type="風の文"))
            return h
        return {"v": 1, "station": "47893", "date": q.get("date"), "supported": True, "places": {"office": "390000", "area": "390010", "point": "74182"}, "issues": [], "entries": [], "fetchLog": []}
    if path == "/api/forecast-issue":
        # その発表の週間天気予報（11/19）: made-up — 上の1日分から、その発表の行を、対象日から先の日へずらして並べる。
        with open(os.path.join(HERE, "forecast-history.json"), encoding="utf-8") as f:
            h = json.load(f)
        iss = next((i for i in h["issues"] if i["issue_id"] == q.get("id")), None)
        if not iss: return {"v": 1, "station": "47893", "supported": True, "found": False}
        def shift(e, n):
            d = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(days=n)).isoformat()
            return dict(e, valid_from=d(e["valid_from"]), valid_to=d(e["valid_to"]))
        mine = [e for e in h["entries"] if e["issue_id"] == iss["issue_id"]]
        days = 7 if iss["kind"] == "VPFW50" else 3
        weekly = None
        ents = [shift(e, n) for n in range(days) for e in mine]
        if iss["kind"] == "VPFD51":
            weekly = next((i for i in reversed(h["issues"]) if i["kind"] == "VPFW50" and i["issued_at"] <= iss["issued_at"]), None)
            if weekly: ents += [shift(e, n) for n in range(7) for e in h["entries"] if e["issue_id"] == weekly["issue_id"]]
        return {"v": 1, "station": "47893", "supported": True, "found": True, "places": h["places"], "issue": iss, "weekly": weekly, "entries": ents}
    if path == "/api/stations":
        return [{"precNo": 74, "blockNo": "47893", "name": "高知", "prefecture": "高知県", "lat": [33, 33.8], "lon": [133, 33.1]}]
    if path == "/api/daily":
        y, m = map(int, q["month"].split("-"))
        d = datetime.date(y, m, 1); rows = []
        while d.month == m:
            if d < TODAY: rows.append(row(d))
            d += datetime.timedelta(days=1)
        return {"station": "47893", "month": q["month"], "rows": rows, "fixed": True, "source": None, "fetchedAt": ""}
    if path == "/api/air":
        # 空気質（11/25）：CAMS のモデルの値。今日（固定の 11/10）から先は予測、前の日は終わった日の値。
        d = q.get("date", "")
        hours = [{"h": h, "pm2_5": round(9 + 6 * _math.sin((h - 6) / 24 * 2 * _math.pi), 1), "pm10": 14, "dust": (15 if h == 13 else 3), "aod": 0.1} for h in range(24)]
        # ふだん（手前30日の分位、11/25）：PM2.5 は 13時が「多い」くらい、AOD は比べられない（手前が足りない）
        usual = {"from": "2026-10-11", "to": "2026-11-09", "items": {"pm2_5": {"n": 720, "q": [4, 12, 14, 16]}, "pm10": {"n": 720, "q": [5, 14, 18, 22]}, "dust": {"n": 720, "q": [1, 4, 8, 12]}, "aod": None},
                 # 1日の値のふだん（11/25）：日平均 PM2.5 の 90% は 12、日最大の黄砂の 90% は 10（この日の黄砂の最大 15 は多い日）
                 "days": {"pm2_5": {"n": 30, "p90": 12}, "dust": {"n": 30, "p90": 10}}}
        return {"supported": True, "v": 1, "station": q.get("station"), "date": d, "kind": "forecast" if d >= "2026-11-10" else "past", "hours": hours, "fetchedAt": "2026-11-10T02:30:00Z", "usual": usual, "source": "Open-Meteo（CAMS）"}
    if path == "/api/air-days":
        # 比較の空気（11/25）：日ごとのまとめ。2023年より前は無い。前日は黄砂が多い日。
        a = datetime.date.fromisoformat(q["from"]); b = datetime.date.fromisoformat(q["to"]); out = []
        while a <= b:
            ds = a.isoformat()
            k = "none" if ds < "2023-01-01" else ("forecast" if a >= TODAY else "past")
            y = a == TODAY - datetime.timedelta(days=1)
            out.append({"date": ds, "kind": k, "pmMean": None if k == "none" else 9 + (a.day % 5) + (8 if y else 0), "pmHours": 0 if k == "none" else 24,
                        "dustMax": None if k == "none" else (38 if y else 2 + a.day % 3), "dustMaxH": None if k == "none" else 11, "dustHours": 0 if k == "none" else 24,
                        "measuredMean": (11 + a.day % 4) if (k == "past") else None, "measuredHours": 24 if k == "past" else 0})
            a += datetime.timedelta(days=1)
        return {"supported": True, "v": 1, "station": q.get("station"), "from": q["from"], "to": q["to"], "days": out}
    if path == "/api/air-measured":
        d = q.get("date", "")
        usual = {"from": "2026-10-11", "to": "2026-11-09", "items": {"pm2_5": {"n": 700, "q": [5, 12, 15, 18]}, "ox": {"n": 700, "q": [0.01, 0.03, 0.04, 0.05]}, "spm": {"n": 700, "q": [0.005, 0.015, 0.02, 0.03]}, "no2": {"n": 700, "q": [0.002, 0.006, 0.009, 0.012]}, "so2": {"n": 700, "q": [0.001, 0.001, 0.002, 0.003]}}}
        return {"supported": True, "usual": usual, "v": 1, "station": "39201350", "name": "高知市 介良局", "date": d, "hours": [{"hour": k, "pm2_5": 8 + k, "ox": 0.02, "spm": 0.01, "no2": 0.004, "so2": None, "wd": "N", "ws": 1.2, "fetchedAt": "2026-11-10T02:30:00Z"} for k in range(1, 10)], "checkedAt": "2026-11-10T02:30:00Z", "source": "環境省 大気汚染物質広域監視システム（そらまめくん）"}
    if path == "/api/forecast-official":
        # 予報の出典（2026-11-23）: made-up — 今日・明日は府県天気予報の 11時、2〜6日先は週間天気予報の 11時。7日先から
        # は無い（画面は Open-Meteo の「補完」）。
        def src(kind): return {"kind": kind, "issuedAt": f"{TODAY.isoformat()}T11:00:00+09:00", "issueId": f"kari:{kind}", "place": "74182", "placeName": "高知"}
        days = []
        for n in range(0, 7):
            d = TODAY + datetime.timedelta(days=n)
            k = "VPFD51" if n < 2 else "VPFW50"
            base = row0(d, "forecast")
            v = lambda x, lo=None, up=None: {"v": x, "lower": lo, "upper": up, "from": src(k)}
            days.append({"date": d.isoformat(), "weather": {"v": {"code": "101", "label": "晴れ時々くもり", "partial": None}, "from": src(k)},
                         "max": v(round(base["max"]), *( (round(base["max"]) - 2, round(base["max"]) + 2) if k == "VPFW50" else (None, None))),
                         "min": v(round(base["min"])), "popDay": v(30) if k == "VPFW50" else None,
                         "pop6": [v(x) for x in (10, 20, 30, 10)] if k == "VPFD51" else [None, None, None, None],
                         "reliability": v("B") if n >= 3 else None})
        return {"v": 1, "station": "47893", "today": TODAY.isoformat(), "supported": True, "places": {"office": "390000", "area": "390010", "point": "74182"}, "days": days}
    if path == "/api/forecast":
        rows = [dict(row(TODAY + datetime.timedelta(days=i), "forecast"), probability=[10, 30, 70, 50, 20, 0, 40, 60][i % 8], radiation=round(6 + i * 0.7, 1), confidence=("A" if i < 3 else "B" if i < 8 else "C") if i < 15 else None) for i in range(16)]
        import math
        hourly = []
        for i in range(4):
            d = TODAY + datetime.timedelta(days=i); base = row(d)
            for n in range(1, 25):
                t = round(base["min"] + (base["max"] - base["min"]) * math.sin(math.pi * max(0, min(1, (n - 5) / 14))), 1)
                hourly.append({"date": d.isoformat(), "n": n, "type": "forecast", "provider": "Open-Meteo", "temp": t, "humidity": 70, "wind": 2.0,
                               "pressure": 1015.0, "rain": 0, "probability": 20, "solar": round(max(0, 600 * math.sin(math.pi * (n - 6) / 12)), 0) if 6 < n < 18 else 0,
                               # 全雲量（%、正時の瞬時の値、#532）：空の絵（β）の雲の量
                               # WN_NO_COVER=1：全雲量の無い予報（根拠の文の見本を撮るとき）
                               **({} if os.environ.get("WN_NO_COVER") else {"cover": (n * 7) % 101}),
                               "raw": {}, "quality": {}})
        return {"rows": rows, "hourlyRows": hourly}
    if path == "/api/hourly":
        import math
        start = datetime.date.fromisoformat(q["from"]); end = datetime.date.fromisoformat(q["to"])
        days = []
        d = start
        while d <= end:
            if d.year < 2020:
                days.append({"date": d.isoformat(), "rows": [], "fixed": False, "error": "テスト用に取得失敗"})
            else:
                base = row(d)
                rows = []
                for n in range(1, 25):
                    f = (1 - math.cos((n - 5) / 24 * 2 * math.pi)) / 2 if 5 <= n <= 29 else 0
                    t = round(base["min"] + (base["max"] - base["min"]) * (math.sin(math.pi * max(0, min(1, (n - 5) / 14)))), 1)
                    rows.append({"date": d.isoformat(), "n": n, "type": ("forecast" if (d > TODAY or (d == TODAY and n > 12)) else "actual"), "provider": "JMA", "temp": t,
                                 "humidity": 80 - (t - base["min"]) * 2, "pressure": round(base["pressure"] + 3 * math.sin(n / 4), 1), "wind": 1.5 + (n % 5) * 0.4,
                                 "sun": round(max(0, min(1, 1.1 * math.sin(math.pi * (n - 6) / 12))), 1) if 6 < n < 18 else 0, "rain": 1.5 if n in (20, 21) else 0, "radiation": round(max(0, 2.2 * math.sin(math.pi * (n - 6) / 12)), 2) if 6 < n < 18 else None,
                                 # 視程（km、11/25）：ふだん 20、前日の 9〜11時だけ黄砂のように下がる
                                 "visibility": ({9: 6.0, 10: 3.5, 11: 4.2}.get(n, 20.0) if d == TODAY - datetime.timedelta(days=1) else 20.0),
                                 "raw": {}, "quality": {}, "unpublished": []})
                days.append({"date": d.isoformat(), "rows": rows, "fixed": True})
            d += datetime.timedelta(days=1)
        return {"station": "47893", "days": days, "fetchedAt": ""}
    if path == "/api/sun":
        return {"date": q["date"], "sunrise": q["date"] + "T06:31", "sunset": q["date"] + "T17:12"}
    if path == "/api/current":
        return {"rows": [], "latest": None}
    if path == "/api/recent":
        return {"daily": row(datetime.date.fromisoformat(q["date"])), "rows": []}
    return {"error": "nope"}

# 台風の進路 (shared/typhoon.ts, compact): one made-up typhoon (2026年 99号) crossing Kochi on 20 October
# 2026 (UTC), its 強風域 300 km all round and its 暴風域 80 km.
def _ty_hours(y, m, d, h): return int(datetime.datetime(y, m, d, h, tzinfo=datetime.timezone.utc).timestamp() // 3600)
TYPHOON_TRACKS = {"v": 1, "source": "e2e", "built": "2026-11-01T00:00:00Z", "storms": [{"y": 2026, "n": 99, "name": "E2E", "p": [
    [_ty_hours(2026, 10, 19, 18), 5, 310, 1335, 960, [300, 300, -1], [80, 80, -1]],
    [_ty_hours(2026, 10, 20, 0), 5, 335, 1335, 965, [300, 300, -1], [80, 80, -1]],
    [_ty_hours(2026, 10, 20, 6), 5, 360, 1340, 975, [250, 250, -1], []],
]}, {"y": 2025, "n": 98, "name": "E2E2", "p": [
    [_ty_hours(2025, 11, 4, 18), 5, 310, 1335, 970, [300, 300, -1], []],
    [_ty_hours(2025, 11, 5, 0), 5, 335, 1335, 975, [300, 300, -1], []],
    [_ty_hours(2025, 11, 5, 6), 5, 360, 1340, 985, [250, 250, -1], []],
]}]}

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.split("?")[0] == "/data/typhoon-tracks.json":
            body = json.dumps(TYPHOON_TRACKS).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)
            return
        if not self.path.startswith("/api/") and not os.path.exists(DIST + self.path.split("?")[0]):
            self.path = "/index.html"
        return super().do_GET()

PORT = int(os.environ.get("WN_PORT", "8799"))  # another port lets two runs go side by side
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(H, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()


def with_quality(o):
    """The made-up rows say every number is a 正常値, as JMA's do: the new core takes no unmarked value."""
    if isinstance(o, dict):
        if "quality" in o and not o["quality"]:
            o["quality"] = {k: "normal" for k, v in o.items() if isinstance(v, (int, float)) and not isinstance(v, bool) and k != "n"}
        for v in o.values(): with_quality(v)
    elif isinstance(o, list):
        for v in o: with_quality(v)
    return o

results = []
def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))

ONLY = [x for x in os.environ.get("WN_ONLY", "").split(",") if x]
# WN_PART=1 or 2 (#371, CI の時間)：手順を2つに分けて、CI で並べて走らせる。1 は SPLIT より前、2 は SPLIT から後
# （どちらも最初の画面 A は走らせる）。分け目は、時間がほぼ半分ずつになる所（AV が長い）。空なら全部。
PART = os.environ.get("WN_PART", "")
SPLIT = "J"
_seen_split = [False]

TIMES = []
def settle(cond, timeout=5.0, every=0.1):
    """Waits until cond() is true (or the time is up) instead of a fixed sleep."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if cond(): return True
        except Exception:
            pass
        time.sleep(every)
    return False
def step(name, fn):
    # WN_ONLY=A,T runs only those steps (and the first view), for looking into one failure.
    if ONLY and name not in ONLY and name != "A":
        return
    if name == SPLIT: _seen_split[0] = True
    if PART and name != "A" and ((PART == "1") == _seen_split[0]):
        return
    t0 = time.monotonic()
    try:
        fn()
    except Exception as e:
        results.append((False, name, "EXCEPTION " + str(e).splitlines()[0][:160])); print(str(e)[:1500]) if os.environ.get("WN_DEBUG") else None
        # 止まった行と、そのときの画面（CI では e2e/shots が成果物に残る。手元で再現しないときの手がかり）。
        tb = [f"{f.lineno}" for f in traceback.extract_tb(e.__traceback__) if f.filename == __file__]
        print(f"  {name} stopped at e2e.py line {' > '.join(tb)}: {str(e).splitlines()[0][:200]}", flush=True)
        try:
            # 開いているシートの文字と、時刻の操作があるか（写真を取りに行けないときの手がかり）。
            print("  " + name + " page:", json.dumps(pg.evaluate("""() => { const m = [...document.querySelectorAll('.msheet')].pop();
              return { sheet: m ? m.innerText.replace(/\\s+/g, ' ').slice(0, 700) : null, play: document.querySelectorAll('.sun-play').length,
                btns: [...document.querySelectorAll('.sun-play .btn')].map(b => b.textContent.trim()), w: innerWidth, h: innerHeight }; }"""), ensure_ascii=False), flush=True)
        except Exception:
            pass
        try:
            os.makedirs(os.path.join(os.path.dirname(__file__), "shots"), exist_ok=True)
            pg.screenshot(path=os.path.join(os.path.dirname(__file__), "shots", f"fail-{W}-{name}.png"), full_page=True)
        except Exception:
            pass
    TIMES.append((name, time.monotonic() - t0))

errors = []
W = int(sys.argv[1]) if len(sys.argv) > 1 else 390
with sync_playwright() as p:
    # A given browser (WN_CHROME), else Playwright's own Chromium (CI installs it).
    chrome = os.environ.get("WN_CHROME")
    b = p.chromium.launch(**({"executable_path": chrome} if chrome else {}), args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True, locale="ja-JP", timezone_id="Asia/Tokyo")
    ctx.add_init_script("""{const T=Date.parse('2026-11-10T03:00:00Z');const RD=Date;const off=T-RD.now();
      class D extends RD{constructor(...a){super(...(a.length?a:[RD.now()+off]))} static now(){return RD.now()+off}}
      globalThis.Date=D;}""")
    ctx.add_init_script(path=os.path.join(HERE, "calm.js"))
    # WN_THEME=navy|mist|warm starts the app in that theme (as chosen in 設定 → 表示 → テーマ).
    if os.environ.get("WN_THEME"):
        ctx.add_init_script(f"try {{ localStorage.setItem('weather-note-theme', {json.dumps(os.environ['WN_THEME'])}) }} catch {{}}")
    FAIL = set()  # parts of a URL that answer 500 (a step makes a request fail on purpose)
    FAILED_ON_PURPOSE = []
    def handle(route):
        from urllib.parse import urlparse, parse_qs
        if any(f in route.request.url for f in FAIL):
            FAILED_ON_PURPOSE.append(route.request.url)
            return route.fulfill(status=500, content_type="application/json", body=json.dumps({"error": "テスト用の失敗"}))
        u = urlparse(route.request.url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(with_quality(api(u.path, q))))
    ctx.route("**/api/**", handle)
    # 天気図 (#249): JMA's pictures stand in as a 1px PNG (no network in the test).
    PNG1 = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    ctx.route(re.compile(r"https://www\.(data\.)?jma\.go\.jp/.*\.png$"), lambda r: r.fulfill(status=200, content_type="image/png", body=PNG1))
    # 雨の見込み（確認用）: the tiles through the Worker (registered after /api/**, so it is tried first).
    TILES_404 = []  # the tiles RN answers 404 on purpose (「取れなかった」)
    def tile(route):
        from urllib.parse import urlparse
        png = rain_tile(urlparse(route.request.url).path)
        if png is None: TILES_404.append(route.request.url)
        route.fulfill(status=404, content_type="text/plain", body="none") if png is None else route.fulfill(status=200, content_type="image/png", body=png)
    ctx.route("**/api/rain-tile/**", tile)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.wait_for_selector(".app-head"); pg.evaluate("__calm(5000)")
    pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
    cdp = ctx.new_cdp_session(pg)
    # WN_SLOW=4 runs the page's CPU 4× slower: a slow CI runner, to find waits that only just suffice.
    if os.environ.get("WN_SLOW"): cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(os.environ["WN_SLOW"])})
    # After a reload the helpers and the wide font go back on the page.
    def reload():
        pg.reload(); pg.wait_for_selector(".app-head"); calm(5000)
        pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
        calm()
    wait = pg.wait_for_timeout
    # Until the page is at rest (e2e/calm.js), at most max_ms: for after a tap or a swipe (#182).
    def calm(max_ms=3000):
        t = pg.evaluate(f"__calm({int(max_ms)})")
        if os.environ.get("WN_CALM"): print("CALM", t, sys._getframe(1).f_lineno)
        return t
    # 最大のシートは画面いっぱい（項目の帯の上から画面の上まで、2026-11-22）。人は引き下げてから下の物を押す。
    # ここでも同じに：押す物がシートに隠れているときは、シートを中の高さに下げて押し、また最大に戻す。
    from playwright.sync_api import Locator as _Loc
    _orig_click = _Loc.click
    COVERED = """el => { const s = document.querySelector('.sheet[data-detent="max"]');
      return !!s && !s.contains(el) && !el.closest('.metrics, .msheet, .msheet-backdrop'); }"""
    def _click(self, *a, **k):
        try: covered = self.first.evaluate(COVERED, timeout=3000) if not k.get("force") else False
        except Exception: covered = False
        if covered:
            pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        try: return _orig_click(self, *a, **k)
        finally:
            if covered and pg.locator(".sheet-handle").count() and not pg.locator('.sheet[data-detent="max"]').count():
                calm(); pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
    _Loc.click = _click
    pg.click = lambda sel, **k: pg.locator(sel).first.click(**k)
    # 項目の帯は仲間に分かれ、選んでいる仲間だけが開く（2026-11-22）。i 番目の項目を選ぶ：閉じた仲間なら仲間を押してから。
    ITEMS = ["temp", "rain", "radiation", "light", "humidity", "visibility", "wind", "pressure"]
    item_chip = lambda i: pg.locator(f'.metrics [data-item="{ITEMS[i]}"]')
    def pick_item(i):
        if item_chip(i).count() == 0:
            pg.locator(f'.metrics .ib-cat[data-items~="{ITEMS[i]}"]').click(); calm()
        if "on" not in (item_chip(i).get_attribute("class") or ""): item_chip(i).click()
    txt = lambda sel: pg.locator(sel).first.inner_text()
    title = lambda: txt(".sheet-head-title")
    no_overflow = lambda: pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    # Text that runs out of its box, lies on other text, or is cut short (e2e/layout.js, #151).
    # WN_STYLES=<file>: the computed look (spacing, edges, corners, shadows, times) of every element drawn,
    # written at each check of the text and the layout, so a change that should not change the look can
    # be compared before and after (e2e/style_diff.py, #142 A).
    STYLE_PROPS = ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
                   "row-gap", "column-gap", "top", "right", "bottom", "left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
                   "outline-width", "outline-offset", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
                   "box-shadow", "text-shadow", "opacity", "transition-duration", "transition-timing-function", "transition-delay", "animation-duration", "animation-timing-function",
                   "stroke-width", "rx", "font-size", "width", "height"]
    STYLE_N = [0]
    def snap_styles(where):
        if not os.environ.get("WN_STYLES"): return
        STYLE_N[0] += 1
        rows = pg.evaluate("""(props) => { const key = (e) => { const p = []; for (let a = e; a && a !== document.body; a = a.parentElement) {
            const sib = a.parentElement ? [...a.parentElement.children].filter(c => c.tagName === a.tagName) : [a];
            p.unshift(a.tagName.toLowerCase() + (a.classList.length ? '.' + [...a.classList].sort().join('.') : '') + ':' + sib.indexOf(a)); } return p.join('>'); };
          const out = {}; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue;
            const c = getComputedStyle(e); out[key(e)] = props.map(p => c.getPropertyValue(p)).join('|'); } return out; }""", STYLE_PROPS)
        with open(os.environ["WN_STYLES"], "a") as f: f.write(json.dumps({"n": STYLE_N[0], "where": where, "props": STYLE_PROPS, "rows": rows}, ensure_ascii=False) + "\n")
    # WN_TAPS=<file>: the things to press that are smaller than 44px across or high (design-system 3, the
    # pressable area, a ::before/::after laid over them counted), written at each check of the layout — an
    # audit, not a check (python3 e2e/tap_report.py <file> lists them by kind).
    def tap_audit(where):
        if not os.environ.get("WN_TAPS"): return
        rows = pg.evaluate("""() => { const out = [];
          for (const e of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], input, select, summary, [tabindex]:not([tabindex="-1"])')) {
            const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
            const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
            let w = r.width, h = r.height;
            for (const ps of ['::before', '::after']) { const p = getComputedStyle(e, ps); if (p.content === 'none' || p.position !== 'absolute') continue;
              w = Math.max(w, parseFloat(p.width) || 0); h = Math.max(h, parseFloat(p.height) || 0); }
            if (w < 43.5 || h < 43.5) out.push([e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), Math.round(w), Math.round(h)]); }
          return out; }""")
        with open(os.environ["WN_TAPS"], "a") as f: f.write(json.dumps({"where": where, "rows": rows}, ensure_ascii=False) + "\n")
    def rotate_ok(code, where):
        # 横向きにして縦へ戻す（11/19 実機：戻すと画面の幅が広がったまま、中身が左に寄った）。
        # 選んでいる日も変わらない（11/19 CI：幅が変わったときのスクロールを「なぞった」と取り、別の日を選び直していた）。
        day = lambda: pg.evaluate("[...document.querySelectorAll('.strip-col')].map((c, i) => c.classList.contains('is-center') ? i : -1).filter(i => i >= 0).join(',')")
        w0 = pg.evaluate("document.documentElement.scrollWidth"); d0 = day()
        pg.set_viewport_size({"width": 844, "height": 390}); pg.wait_for_timeout(600)
        pg.set_viewport_size({"width": W, "height": 844}); pg.wait_for_timeout(800)
        r = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"); d1 = day()
        check(f"{code} 横向きにして縦に戻しても、画面の幅が広がらず、選んでいる日も変わらない（{where}）", r[1] == W and r[0] <= r[1] and r[0] == w0 and d0 == d1, (w0, r, d0, d1))

    def layout_ok(code, where):
        snap_styles(f"{code} {where}")
        tap_audit(f"{code} {where}")
        r = pg.evaluate("__layoutIssues()")
        bad = r["overflow"] + r["overlap"] + r["clipped"]
        check(f"{code} 文字のはみ出し・重なり・切れがない（{where}）", not bad, str(bad))

    # The centre frames' lines must not run through a control (#151: 真ん中の帯が［連動］に被る).
    frame_hits = lambda: pg.evaluate("""(() => { const fr = [...document.querySelectorAll('.center-band')].map(e => e.getBoundingClientRect());
          return [...document.querySelectorAll('.board button, .board select')].filter(c => { const r = c.getBoundingClientRect(); if (!r.width) return false;
            return fr.some(f => { const inside = r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
              const cross = r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top; return cross && !inside; }); })
            .map(c => (c.getAttribute('aria-label') || c.textContent).trim().slice(0, 12)); })()""")
    # 操作の体系 (#151): the primary buttons that can be seen (not under a sheet), and buttons too
    # small to press (the small ones are pressable 44 high through ::after).
    primaries = lambda: pg.evaluate("""[...document.querySelectorAll('.btn.primary, .actions > button.primary')].filter(e => {
        const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) return false;
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && (e === t || e.contains(t));
      }).length""")
    def buttons_ok(code, where, primary):
        n = primaries()
        check(f"{code} 主のボタンは{primary}つ（{where}）", n == primary, str(n))
        small = pg.evaluate("""[...document.querySelectorAll('.btn')].filter(e => { const r = e.getBoundingClientRect(); if (!r.width) return false;
          const hit = Math.max(r.height, parseFloat(getComputedStyle(e, '::after').height) || 0); return hit < 32; }).map(e => e.textContent.trim())""")
        check(f"{code} 押せる高さが32以上（{where}）", not small, str(small))

    # Text on screen smaller than the type scale's xs (11px, iOS Caption 2): none (docs/design-system.md, #151).
    # In an SVG the computed font-size is in the drawing's own units: the size on screen is that times the
    # drawing's scale (getScreenCTM), so a map or a graph drawn smaller than its viewBox is caught too.
    # Every check also notes the classes of the text it looked at and their parents (WN_SEEN writes them out),
    # so the parts that no check ever sees can be listed.
    SMALL_SEEN = set()
    def small_text():
        snap_styles(f"文字 {len(results)}")
        r = pg.evaluate("""(() => { const seen = new Set();
      const px = (e) => { const f = parseFloat(getComputedStyle(e).fontSize);
        if (!(e instanceof SVGElement) || !e.getScreenCTM) return f;
        const m = e.getScreenCTM(); return m ? f * Math.hypot(m.a, m.b) : f; };
      const hits = [...document.querySelectorAll('body *')].filter(e => {
        const r = e.getBoundingClientRect();
        // Off screen (scrolled out of the sheet, the next day in the drum) still counts: its size is the same.
        if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return false;
        if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
        for (let a = e; a && a !== document.body; a = a.parentElement) for (const c of a.classList) seen.add(c);
        return px(e) < 10.95;
      }).map(e => (e.getAttribute('class') || e.tagName) + ' ' + px(e).toFixed(1) + 'px ' + e.textContent.trim().slice(0, 8)).slice(0, 5);
      return { hits, seen: [...seen] }; })()""")
        SMALL_SEEN.update(r["seen"])
        return r["hits"]
    def touch(kind, x, y):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": x, "y": y}]})
    def sheet_h():
        return pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().height")
    def esc():
        pg.keyboard.press("Escape"); calm()

    # 研究用（テスト）の比べ板は、管理者ページの「確認用」に移した（11/24）。設定はもう開いている前提。
    def open_board(label):
        pg.locator(".msheet.settings button", has_text="管理者ページ").click(); calm()
        pg.locator(".admin-page-sheet .seg button", has_text="確認用").click(); calm()
        pg.locator(".admin-page-sheet button", has_text=label).click(); calm()

    # A. first view
    def a():
        check("A1 表が対象・比較の2つ", pg.locator(".side").count() == 2)
        check("A2 対象日の見出し", "2026/11/10" in txt(".side .date-button"), txt(".side .date-button"))
        check("A3 中央の枠は表ごとに1つ（2つ）", pg.locator(".center-band").count() == 2)
        hits = frame_hits()
        check("A3b 中央の枠の線が操作に被らない", not hits, str(hits))
        check("A4 横にはみ出さない", no_overflow())
        check("A5 シートの見出し", title() == "気温の日別", title())
        st = small_text(); check("A6 11px より小さい文字がない（表）", not st, str(st))
        layout_ok("A7", "表")
        # 引き手の押せる範囲：シートの上の縁から上へ 20px の透明な帯（#296、案A）。引き手と合わせて 44 を超え、押すと引き手と同じ。
        reach = pg.evaluate("(() => { const s = document.querySelector('aside.sheet').getBoundingClientRect(); const e = document.elementFromPoint(innerWidth / 2, s.top - 10); const h = document.querySelector('.sheet .sheet-handle').getBoundingClientRect(); const r = document.querySelector('.sheet-handle-reach').getBoundingClientRect(); return { hit: e && e.className, total: Math.round(r.height + h.height), detent: document.querySelector('aside.sheet').dataset.detent, top: s.top } })()")
        pg.mouse.click(195, reach["top"] - 10); calm()
        d1 = pg.evaluate("document.querySelector('aside.sheet').dataset.detent")
        pg.mouse.click(195, pg.evaluate("document.querySelector('aside.sheet').getBoundingClientRect().top") - 10); calm()
        d2 = pg.evaluate("document.querySelector('aside.sheet').dataset.detent")
        check("A7b 引き手の上の帯：押せる高さ 44 以上、押すと引き手と同じく高さが替わり、もう一度で戻る", reach["hit"] == "sheet-handle-reach" and reach["total"] >= 44 and d1 != reach["detent"] and d2 == reach["detent"], (reach, d1, d2))
        buttons_ok("A8", "表", 0)
        # Today (2026-11-10, 12:00 JST): its weekday filled, its 肌感 band ringed at the band now.
        check("A9 今日の列だけ曜日に印", pg.locator(".cell-date.is-today").count() == 1 and "火" in txt(".cell-date.is-today small"), str(pg.locator(".cell-date.is-today").count()))
        ring = pg.evaluate("[...document.querySelectorAll('.feel-bar i.now')].map(i => !!i.closest('.cell-stack').querySelector('.cell-date.is-today'))")
        check("A10 今の時間帯の輪は今日の帯に1つ", ring == [True], str(ring))
        check("A11 肌感の帯の予報に網が見える", pg.evaluate("[...document.querySelectorAll('.feel-bar i.forecast')].every(i => getComputedStyle(i).backgroundImage.includes('repeating-linear-gradient'))") and pg.locator(".feel-bar i.forecast").count() > 0)
    step("A", a)

    # B. every item chip
    def bb():
        for i, label in enumerate(["気温", "降水", "日差し", "日照", "湿度", "空気", "風速", "気圧"]):
            pick_item(i); calm()
            check(f"B{i+1} {label}: チップがオン", "on" in item_chip(i).get_attribute("class"))
            check(f"B{i+1} {label}: シート見出し", title().startswith(label), title())
            if label == "空気":
                # 空気（11/25）：PM2.5・黄砂・視程の日別を3段で（AirCompare）。読み取りは表と時間帯で。
                check(f"B{i+1} {label}: 3段の日別（PM2.5・黄砂・視程）と凡例", pg.locator(".sheet .ac-chart").count() == 1 and pg.locator(".sheet .ac .aq-legend").count() == 1, pg.locator(".sheet .ac-chart").count())
            else:
                check(f"B{i+1} {label}: 読み取りカード", pg.locator(".sheet .readout-card").count() == 1)
                check(f"B{i+1} {label}: 凡例がグラフの下", pg.locator(".sheet .line-legend").count() >= 1)
            layout_ok(f"B{i+1}b", f"{label}の日別")
        pick_item(0); calm()
    step("B", bb)


    # C. sheet heights
    def c():
        h0 = sheet_h()
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        h1 = sheet_h()
        top = pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().top")
        bar = pg.evaluate("(() => { const r = document.querySelector('.metrics').getBoundingClientRect(); return [r.top, r.bottom]; })()")
        sb = pg.evaluate("document.querySelector('.sheet').getBoundingClientRect().bottom")
        check("C1 上へ弾くと高くなる", h1 > h0 + 50, f"{h0:.0f}→{h1:.0f}")
        # 項目の帯は画面の下に浮かんで固定、シートはその上に乗って画面の上近くまで上がる（2026-11-22）
        check("C2 最大は画面の上近くまで・帯の上に乗る", top <= 16 and abs(sb - bar[0]) <= 1 and bar[1] >= 844 - 24, f"top {top:.0f} sheet bottom {sb:.0f} bar {bar}")
        layout_ok("C2b", "シート最大")
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        h2 = sheet_h()
        check("C3 下へ弾くと低くなる", h2 < h1 - 50, f"{h1:.0f}→{h2:.0f}")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
    step("C", c)

    # TX. 質感 (design-system.md 4.1): values by the points, the 幅 view, rounded amount bars
    def tx():
        fit = pg.evaluate("(()=>{const b=document.querySelector('.sheet-body');return [b.scrollHeight,b.clientHeight]})()")
        check("TX0 日別のグラフはシートに収まる（縦にスクロールしない）", fit[0] <= fit[1] + 1, str(fit))
        check("TX0b 上のカードに時間帯の天気（朝〜夜の5つ）", pg.locator(".sheet .readout-card .parts-wx-cell").count() == 5)
        # 前年同日: the comparison days are the same dates, so one row of dates (the card says the year)
        check("TX0c 比較が同じ日付なら日付の行は1つ", pg.locator(".sheet .chart > svg .chart-x.partner").count() == 0 and pg.locator(".sheet .chart > svg .chart-x-side").count() == 0)
        check("TX0d 線のチップは1行（折り返さない）", pg.evaluate("(()=>{const r=document.querySelector('.sheet .chip-row-scroll');if(!r)return true;const t=[...r.children].map(c=>Math.round(c.getBoundingClientRect().top));return new Set(t).size===1})()"))
        check("TX1 気温の値を点のそばに（対象日の最高・最低）", pg.locator(".sheet .chart-values text").count() >= 14, str(pg.locator(".sheet .chart-values text").count()))
        check("TX2 線は区間ごとに1本（日ごとの線分にしない）", pg.evaluate("document.querySelectorAll('.sheet .chart > svg line[stroke-dasharray]:not(.guide *)').length") == 0)
        pg.locator(".chart-look button", has_text="幅").click(); calm()
        check("TX3 幅：1日1本の丸い棒（対象・比較）", pg.locator(".sheet .range-bars rect").count() >= 14, str(pg.locator(".sheet .range-bars rect").count()))
        check("TX4 幅：最高・最低のチップは出さない", pg.locator(".sheet .chip-row .chip", has_text="最高").count() == 0)
        layout_ok("TX4b", "気温の幅")
        pg.locator(".chart-look button", has_text="線").click(); calm()
        check("TX5 線に戻せる", pg.locator(".sheet .range-bars").count() == 0 and pg.locator(".sheet .chip-row .chip", has_text="最高").count() == 1)
        pick_item(1); calm()
        check("TX6 量の棒は上の角だけ丸い（path）", pg.locator(".sheet .chart svg path[d*='A']").count() > 0 and pg.locator(".sheet .chart svg rect[fill='#45c8d8']").count() == 0)
        pick_item(0); calm()
    step("TX", tx)

    # D. daily -> hours -> back, every item
    def d():
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        check("D1 日をタップで時間帯", title().endswith("の時間帯"), title())
        check("D2 戻るボタン", pg.locator(".back-btn").count() == 1)
        for i, label in enumerate(["気温", "降水", "日差し", "日照と明るさ", "湿度", "空気", "風速", "気圧"]):
            pick_item(i); calm()
            check(f"D3 時間帯 {label}", title() == f"{label}の時間帯" and pg.locator(".day-chart > svg").count() == 1 and (label != "空気" or pg.locator(".sheet .ac-hours .ac-chart").count() == 1), title())
        pick_item(0); calm()
        pg.click(".back-btn"); calm()
        check("D4 ‹日別で戻る", title() == "気温の日別", title())
    step("D", d)

    # U. 日照の時間帯 › 空の色（模式）: なぞると1時間を拡大、テキスト選択・拡大鏡は出ない
    def uu():
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pick_item(3); calm()
        check("U1 明るさと空：1本の帯（切り替えなし）、マスに空の色と段の線", pg.locator(".light-strip .seg").count() == 0 and pg.locator(".light-cells.sky i b").count() >= 48 and pg.locator(".light-cells.sky i u").count() >= 24 and no_overflow(), str(pg.locator(".light-cells.sky i b").count()))
        check("U2 明るさと空の言葉は帯の下（日ごとに1行）、読み取りの枠には言葉の行が無い", pg.locator(".light-words .light-words-row").count() == 2 and "外に出たとき" in txt(".light-words") and "外に出たとき" not in txt(".sheet .readout-card"), txt(".light-words"))
        st = small_text(); check("U2b 11px より小さい文字がない（時間帯）", not st, str(st))
        layout_ok("U2c", "時間帯")
        buttons_ok("U2d", "時間帯", 0)
        lines = pg.evaluate("""[...document.querySelectorAll('.cs-head')].map(h => { const l = h.querySelector('.cs-head-line').getBoundingClientRect(), b = h.querySelector('.cs-head-state').getBoundingClientRect();
          return b.top >= l.bottom - 1; })""")
        check("U2e 見出しはどちらの日も2行（日付の下に実績・予報）", len(lines) == 2 and all(lines), str(lines))
        pg.locator(".light-strip").scroll_into_view_if_needed(); calm()
        b = pg.locator(".light-trace.on").bounding_box()
        y = b["y"] + b["height"] / 2
        pg.mouse.move(b["x"] + b["width"] * 0.5, y); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] * 0.55, y, steps=4)
        check("U3 なぞると拡大カード（空と明るさ）", pg.locator(".sky-zoom").count() == 1 and pg.locator(".sky-zoom-steps span").count() == 6 * pg.locator(".light-row").count() and "lx" in txt(".sky-zoom-light"), txt(".sky-zoom-light"))
        check("U3b 比較日があれば拡大カードにも比較の空と読み取り", pg.locator(".light-row").count() < 2 or (pg.locator(".sky-zoom-day").count() == 2 and "比較" in pg.locator(".sky-zoom-day .sky-zoom-now").nth(1).inner_text()), str(pg.locator(".sky-zoom-day").count()))
        sel = pg.evaluate("String(getSelection())")
        check("U4 テキストが選択されない", sel == "", repr(sel))
        check("U5 帯は選択・長押しメニューなし", pg.evaluate("getComputedStyle(document.querySelector('.light-trace.on')).userSelect") == "none")
        pg.mouse.up(); calm()
        check("U6 離すとカードは消える", pg.locator(".sky-zoom").count() == 0)
        pg.mouse.click(b["x"] + b["width"] * 0.3, y); calm()
        check("U7 軽く押すとカードが残り×で閉じる", pg.locator(".sky-zoom-close").count() == 1)
        pg.click(".sky-zoom-close"); calm()
        check("U8 ×で閉じる", pg.locator(".sky-zoom").count() == 0)
        # 2日の読み取りの枠（2026-11-18）：列の頭は日付だけの1行、畳む物は無い。帯の下の言葉は時刻を替えても高さが同じ。
        pick_item(3); calm()
        heads = pg.evaluate("[...document.querySelectorAll('.sheet .readout-card .ro-col')].map(e => Math.round(e.getBoundingClientRect().height))")
        hs = []
        pg.locator(".sheet .day-chart > svg").first.scroll_into_view_if_needed(); calm()
        gb = pg.locator(".sheet .day-chart > svg").first.bounding_box()
        for fx in (0.2, 0.45, 0.6, 0.85):
            pg.mouse.click(gb["x"] + gb["width"] * fx, gb["y"] + gb["height"] * 0.5); calm()
            hs.append(pg.evaluate("Math.round(document.querySelector('.light-words').getBoundingClientRect().height)"))
        check("U2f 2日の読み取り：列の頭は1行・畳むボタンなし、帯の下の言葉は時刻を替えても高さが同じ", max(heads) <= 20 and pg.locator(".sheet .readout-card .fold-btn").count() == 0 and len(set(hs)) == 1, (heads, hs))
        pick_item(0); calm()
        pg.click(".back-btn"); calm()
    step("U", uu)

    # E. forecast hatch in hours (tomorrow)
    def e():
        pg.locator(".chart-hit").nth(8).click(force=True); calm()
        check("E1 予報の時間に網かけ", pg.locator(".day-chart .chart-forecast").count() >= 20, str(pg.locator(".day-chart .chart-forecast").count()))
        check("E2 予報の線は実線のまま", pg.evaluate("[...document.querySelectorAll('.day-chart :is(line,path)[stroke-dasharray=\"2 4\"]')].length") == 0)
        pg.locator(".day-chart > svg").scroll_into_view_if_needed(); calm()
        b = pg.locator(".day-chart > svg").bounding_box()
        pg.mouse.move(b["x"] + b["width"] * 0.6, b["y"] + 100); pg.mouse.down(); pg.mouse.move(b["x"] + b["width"] * 0.7, b["y"] + 100)
        check("E3 触ると補助線と軸のタグ", pg.locator(".day-chart .guide-tag").count() >= 1)
        check("E4 触っている間カードが光る", pg.locator(".readout-card.live").count() == 1)
        pg.mouse.up(); calm()
        check("E5 離すとカードは戻る", pg.locator(".readout-card.live").count() == 0)
        pg.click(".back-btn"); calm()
    step("E", e)

    # F. long press on the daily graph (touch) scrubs, no day opens; a swipe moves days
    def f():
        b = pg.locator(".chart svg").first.bounding_box()
        x, y = b["x"] + b["width"] * 0.3, b["y"] + b["height"] * 0.4
        touch("touchStart", x, y); wait(500)  # held on purpose: a long press, not a rest
        touch("touchMove", x + 40, y); wait(200)
        check("F1 長押しでカードが光る", pg.locator(".readout-card.live").count() == 1)
        check("F2 長押しで補助線", pg.locator(".chart .guide").count() == 1)
        touch("touchEnd", x + 40, y); calm()
        check("F3 長押しの後に時間帯へ飛ばない", title().endswith("の日別"), title())
        before = txt(".side .date-button")
        sx = b["x"] + b["width"] * 0.7
        touch("touchStart", sx, y)
        for k in range(1, 9):
            touch("touchMove", sx - k * 22, y); wait(16)
        touch("touchEnd", sx - 176, y); calm()
        after = txt(".side .date-button")
        check("F4 横スワイプで日が動く", before != after, f"{before}→{after}")
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
    step("F", f)

    # G. compare presets and link
    def g():
        sel = pg.locator(".side-compare select.mode")
        opts = [o for o in sel.locator("option").evaluate_all("os => os.map(o => o.value)") if o != "__conditions"]
        seen = set()
        for o in opts:
            sel.select_option(o); calm()
            seen.add(txt(".side-compare .date-button"))
        check("G1 比較のプリセットで比較日が変わる", len(seen) >= len(opts) - 1, f"{len(opts)} 種類 → {len(seen)} 通り")
        hits = frame_hits(); check("G1b どの比較のしかたでも、中央の枠の線が操作に被らない", not hits, str(hits))
        sel.select_option(opts[0]); calm()
        pg.click(".link-toggle"); calm()
        check("G2 個別にすると帯が2つ", pg.locator(".center-band.apart").count() == 2)
        pg.click(".link-toggle"); calm()
        check("G3 連動に戻すと枠は実線の2つ", pg.locator(".center-band").count() == 2 and pg.locator(".center-band.apart").count() == 0)
    step("G", g)

    # H. date arrows and 今日
    def h():
        before = txt(".side .date-button")
        pg.locator(".side .arrow").nth(1).click(); calm()
        check("H1 ▶で次の日", txt(".side .date-button") != before)
        check("H2 今日へ戻るボタンが出る", pg.locator(".today-chip").count() == 1)
        moved = txt(".side .date-button")
        pg.reload(); calm(7500); pg.add_script_tag(path=os.path.join(HERE, "flick.js")); pg.add_script_tag(path=os.path.join(HERE, "layout.js")); pg.add_style_tag(content=WIDE_FONT)
        check("H2b 再読み込み（新しい版への切り替え）でも見ていた日のまま", txt(".side .date-button") == moved, txt(".side .date-button"))
        pg.click(".today-chip")
        # Waits for the strip to come back (a slow runner glides longer than a fixed 500 ms).
        settle(lambda: txt(".side .date-button") == before)
        check("H3 今日へ戻る", txt(".side .date-button") == before, txt(".side .date-button"))
    step("H", h)

    # G2. a tap that lowers the sheet must not also tap the page behind (iOS sends the click afterwards)
    def ghost():
        n0 = pg.locator(".msheet").count()
        pg.evaluate("""() => { const h = document.querySelector('.sheet-handle');
          h.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientY: 300, pointerId: 9}));
          h.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientY: 300, pointerId: 9}));
          window.__ghost = 0; const t = document.querySelector('.chart-hit, .date-button');
          t.addEventListener('click', () => window.__ghost++, {once: true});
          t.click(); }""")
        calm()
        check("G2a 下げたタップのクリックは背面に届かない", pg.evaluate("window.__ghost") == 0 and pg.locator(".msheet").count() == n0)
        calm()
        pg.evaluate("""() => { window.__ghost = 0; const t = document.querySelector('.chart-hit, .date-button');
          t.addEventListener('click', () => window.__ghost++, {once: true}); }""")
        pg.locator(".side .arrow").nth(1).click(); calm()
        pg.locator(".today-chip").click(); calm()
        check("G2b 少し後のタップは普通に届く", pg.locator(".today-chip").count() == 0)
        pg.evaluate("""() => { const h = document.querySelector('.sheet-handle');
          h.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientY: 300, pointerId: 9}));
          h.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientY: 300, pointerId: 9})); }""")
        calm()
    step("G2", ghost)

    # FS. 取得できなかったもの: the status bar's message opens what failed, when and for what
    def fs():
        FAIL.add("/api/hourly")
        # A week back: the table asks for those days' hours (and their comparison days'), which now fail.
        for _ in range(9):
            pg.locator(".side .arrow").nth(0).click(); calm()
        for _ in range(20):
            if pg.locator(".status-bar.error").count(): break
            calm()
        check("FS1 失敗がステータスに出る", pg.locator(".status-bar.error").count() == 1)
        st = small_text(); check("FS1b 11px より小さい文字がない（状態の行）", not st, str(st))
        # 値が無いときの印（2026-11-25）：時別が取れない日の視程は「取得失敗」のアイコン（赤）。ⓘ に印の意味。
        pick_item(5); calm()
        whys = pg.evaluate("[...document.querySelectorAll('.strip-col .no-value')].map(e => e.dataset.why)")
        check("NV1 視程の値が無いマスは理由のアイコン（文字の — ではない）、理由は6つのどれか", len(whys) >= 1 and pg.locator(".strip-col .cell-failed").count() == 0 and set(whys) <= {"outside", "gone", "absent", "pending", "failed", "partial"}, str(whys))
        pg.locator('.info-btn[aria-label*="値の出どころの説明"]').first.click(); calm()
        legend = txt(".no-value-legend") if pg.locator(".no-value-legend").count() else ""
        check("NV2 ⓘ に印の意味（対象外・欠測・まだ・取得失敗・比べられない）", all(w in legend for w in ["対象外", "欠測", "まだ", "取得失敗", "比べられない"]), legend[:120])
        if os.environ.get("WN_NVSHOT"): (pg.locator(".side-target").first.screenshot(path=os.environ["WN_NVSHOT"]), pg.evaluate("document.querySelector('aside.sheet').style.visibility='hidden'"), pg.locator(".no-value-legend").first.screenshot(path=os.environ["WN_NVSHOT"] + "-legend.png"), pg.evaluate("document.querySelector('aside.sheet').style.visibility=''"))
        pg.locator('.info-btn[aria-label*="値の出どころの説明"]').first.click(); calm()
        pick_item(0); calm()
        pg.locator(".status-detail").click(); calm()
        items = pg.locator(".failure-item").count()
        body = txt(".failure-sheet") if pg.locator(".failure-sheet").count() else ""
        st = small_text(); check("FS2b 11px より小さい文字がない（取得できなかったもの）", not st, str(st))
        check("FS2 押すと何が取れなかったかのシート", items >= 1, str(items))
        check("FS3 理由・取り先・使う所・時刻が出る", all(w in body for w in ["テスト用の失敗", "時間別の表", "使う所", "失敗"]), body[:120])
        pg.locator(".failure-all").scroll_into_view_if_needed(); calm()
        buttons_ok("FS3b", "取得できなかったもの", 1)
        FAIL.clear()
        pg.locator(".failure-all").click(); calm(9000)
        check("FS4 すべて再試行で消える", pg.locator(".failure-item").count() == 0 and pg.locator(".status-bar.error").count() == 0, str(pg.locator(".failure-item").count()))
        pg.click(".msheet .icon-btn.close"); calm()
        pg.click(".today-chip"); calm()
    step("FS", fs)
    # AV. 手前の平均 on the hour chart: rows in the readout, a legend that sets lines aside, the span
    def av():
        pg.locator(".chart-hit").nth(7).click(force=True); calm(7500)
        check("AV1 読み取りに手前の平均と手前1週との差", pg.locator(".readout-card .ro-label", has_text="手前1週の平均").count() == 1 and pg.locator(".readout-card .ro-label", has_text="手前1週との差").count() == 1)
        # The readout is set on a grid: each column's decimal points on one line, every row 24px high (#151).
        g = pg.evaluate("""() => {
          const grid = [...document.querySelectorAll('.ro-grid')].pop(); const cols = {}; const hs = [];
          for (const el of grid.querySelectorAll('.ro-v')) {
            hs.push(Math.round(el.getBoundingClientRect().height));
            const n = [...el.childNodes].find((c) => c.nodeType === 3 && c.textContent.includes('.')); if (!n) continue;
            const i = n.textContent.indexOf('.'); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
            const b = r.getBoundingClientRect(); const k = [...el.parentNode.children].indexOf(el) % 4;
            (cols[k] ||= []).push(b.left + b.width / 2);
          }
          return { spread: Object.values(cols).map((xs) => Math.max(...xs) - Math.min(...xs)), heights: [...new Set(hs)] };
        }""")
        check("AV1b 読み取りの小数点が列ごとにそろう", len(g["spread"]) >= 2 and max(g["spread"]) < 0.6, str(g))
        check("AV1c 読み取りの行の高さが 24px でそろう", g["heights"] == [24], str(g))
        # HC. The hour graph (#151): rows named, the sun in its own strip, a clear night drawn as the moon.
        hc = pg.evaluate("""() => ({ names: [...document.querySelectorAll('.band-wx-name')].map(e => e.textContent),
          strip: !!document.querySelector('.day-sun-name'),
          sky: [...document.querySelectorAll('.band-wx-cell')].map(c => { const k = c.querySelector('.band-wx-main svg')?.dataset.sky || '';
            return k === 'sun' ? 'sun' : k.endsWith('-night') ? 'moon' : 'other'; }) })""")
        check("HC1 天気の行に 対象／比較 の名前", hc["names"][:2] == ["対象", "比較"], str(hc["names"]))
        check("HC2 太陽の高さは別の帯（太陽）", hc["strip"])
        # 0・3・21・24時 are night all year in Kochi: no sun there; a moon never by day (12時).
        check("HC3 夜に太陽を描かない・昼に月を描かない", all(hc["sky"][i] != "sun" for i in (0, 1, 7, 8)) and hc["sky"][4] != "moon", str(hc["sky"]))
        # #173: the strip says 空は模式 at its right end, clear of 南中 and inside the plot; the sun line has its dark edge.
        sm = pg.evaluate("""() => { const m = document.querySelector('.day-sun-model'), n = document.querySelector('.day-sun-label:not(.day-sun-model)');
          const a = m && m.getBoundingClientRect(), b = n && n.getBoundingClientRect(), svg = m && m.ownerSVGElement.getBoundingClientRect();
          return a && b ? { text: m.textContent, apart: a.left >= b.right + 4, inside: a.right <= svg.right, casing: !!document.querySelector('.day-sun-casing') } : null; }""")
        check("HC4 太陽の帯に「空は模式」（南中と重ならない）、太陽の線に暗い縁", sm and sm["text"] == "空は模式" and sm["apart"] and sm["inside"] and sm["casing"], str(sm))
        # SS. 太陽: the sun strip opens the sheet; the three twilights in order; the slider reads 10-minute steps.
        pg.locator(".day-sun-button").first.scroll_into_view_if_needed(); pg.locator(".day-sun-button").first.click(); calm()
        # 1画面に収める形（2026-11-18）：日の出・南中・日の入りの3枚と、薄明の表（朝の始まり・夕の終わり）と昼の長さ。
        keys = pg.locator(".sun-keys:not(.moon) .sun-key b").all_inner_texts()
        tw = pg.locator(".sun-tw tbody tr").all_inner_texts()
        check("SS1 太陽のシート：日の出・南中・日の入りの3枚、薄明3つ（朝・夕）、昼の長さ", pg.locator(".sun-sheet").count() == 1 and len(keys) == 3 and len(tw) == 3 and "時間" in txt(".sun-tw tfoot"), (keys, tw))
        st = small_text(); check("SS1b 11px より小さい文字がない（太陽のシート）", not st, str(st))
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-sheet.png")
        tm = lambda x: int(x.split(":")[0]) * 60 + int(x.split(":")[1])
        cells = [c.split() for c in tw]
        morning = [tm(c[1]) for c in cells]; evening = [tm(c[2]) for c in cells]
        mins = sorted(morning, reverse=True) == morning and evening == sorted(evening) and max(morning) < tm(keys[0]) and tm(keys[0]) < tm(keys[1]) < tm(keys[2]) < min(evening)
        check("SS2 薄明は 市民→航海→天文 の順（朝は早く・夕は遅く）、日の出→南中→日の入り", mins, (keys, tw))
        moon = pg.locator(".sun-keys.moon .sun-key").count()
        check("SS2c 月：月の出・南中・月の入りの3枚と、選んだ時刻の月（高さ・方位・月齢・明るい部分）", moon == 3 and "月齢" in txt(".sun-now.moon"), txt(".sun-now.moon"))
        # 11/20 渡辺さん：空の色の元（その時間の天気・日照・雨、実績か予報か）を1行で。
        src = txt(".sun-now-from")
        check("SS2z 空の色の元を1行で（時間・雨・実績／予報）", src.startswith("空の色：") and ("時台" in src or "晴れの空" in src) and ("実績" in src or "予報" in src or "晴れの空" in src), src)
        # 11/19 渡辺さん「この回転や傾きをこっちにも」：月の行の絵は、出ている間は月のこよみと同じ球の絵（傾き・模様の向き）。
        up_now = "地平線の上" in txt(".sun-now.moon")
        check("SS2y 月の行：出ている間は傾きのある球の絵、下にあるときは暦の形", pg.locator(".sun-now.moon .sun-now-moon canvas").count() == (1 if up_now else 0) and pg.locator(".sun-now.moon > .moon-glyph").count() == (0 if up_now else 1), (up_now, txt(".sun-now.moon")))
        # 11/19：月が太陽より高く昇る日も、月の線がグラフの上端に張り付かない（上端は太陽と月の高い方から）。
        mt = pg.evaluate("""() => { const c = document.querySelector('.sun-chart'); const r = c && c.querySelector('rect'); const m = c && c.querySelector('.moon-curve');
          if (!r || !m) return null; const top = +r.getAttribute('y'); const ys = (m.getAttribute('d').match(/-?[\\d.]+,-?[\\d.]+/g) || []).map(p => +p.split(',')[1]);
          return { top, min: Math.min(...ys), atTop: ys.filter(y => y <= top + 0.5).length }; }""")
        check("SS2d 月の線がグラフの上端に張り付かない", mt is None or mt["atTop"] == 0, str(mt))
        # 端末の向きで見る（センサー連動、2026-11-18）：作ったセンサーの値（iPhone の方位 187.6°＝偏角を引いて南）を流すと、
        # 南を真ん中にした窓になり、やめると広げた絵に戻る。
        pg.locator(".sun-card .seg button", has_text="空を見上げる").click(); calm()
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-sheet-sky.png")
        # なぞって見る窓（11/19）：横 90° の窓。はじめは太陽を真ん中に（12時の太陽は南）。左へなぞると右（西寄り）へ回り、← キーで戻る。
        pan_head = lambda: pg.evaluate("(document.querySelector('.sky-pan .sky-heading') || {}).textContent || ''")
        az_of = lambda t: int(re.search(r"(\d+)°", t).group(1)) if re.search(r"(\d+)°", t) else None
        h0 = pan_head(); pb = pg.locator(".sky-pan").bounding_box()
        pg.mouse.move(pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2); pg.mouse.down()
        pg.mouse.move(pb["x"] + pb["width"] / 2 - pb["width"] / 3, pb["y"] + pb["height"] / 2, steps=6); pg.mouse.up(); calm()
        h1 = pan_head()
        pg.locator(".sky-pan").focus(); pg.keyboard.press("ArrowLeft"); calm(); h2 = pan_head()
        if os.environ.get("WN_SUN"): pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-pan.png")
        check("SS2r なぞって見る窓：はじめは太陽（南）、左へ 1/3 なぞると約 30° 西へ、← で 5° 戻る", h0.startswith("南") and az_of(h1) is not None and 25 <= az_of(h1) - az_of(h0) <= 35 and az_of(h1) - az_of(h2) == 5 and pg.locator(".sky-view.window").count() == 0, (h0, h1, h2))
        # 空の絵（β、11/27）：入れると窓の空が Canvas の空の絵に。細かい目盛りと通り道は「軌道・目盛り」で重ね、窓の下に出典。切ると元に戻る。
        pg.locator(".sky-beta").click(); calm()
        sb = pg.evaluate("""(() => ({ on: document.querySelector('.sky-beta')?.getAttribute('aria-pressed'), canvas: document.querySelectorAll('.sky-pan .sky-canvas').length,
          grid: document.querySelectorAll('.sky-pan .sky-grid').length, src: (document.querySelector('.sky-src.below') || {}).textContent || '',
          from: document.querySelectorAll('.sun-now-from').length, word: (document.querySelector('.sun-now-phase small') || {}).textContent || '' }))()""")
        # 回帰の基準の画像（#536）：β 入りの窓（β 切りは上の -pan.png）。リポジトリには入れない。
        if os.environ.get("WN_SUN"): pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-pan-beta.png")
        pg.locator(".sky-pan .sky-guides").click(); calm(); sb_grid = pg.locator(".sky-pan .sky-grid").count()
        pg.locator(".sky-pan .sky-guides").click(); calm()
        pg.locator(".sky-beta").click(); calm()
        sb_off = pg.evaluate("[document.querySelectorAll('.sky-pan .sky-canvas').length, document.querySelectorAll('.sky-src.below').length, document.querySelectorAll('.sky-pan .sky-grid').length]")
        check("SB1 空の絵 β：入れると Canvas の空・絵の根拠（雲を描いた／描いていない理由）、目盛りは「軌道・目盛り」で重なる。切ると元の窓", sb["on"] == "true" and sb["canvas"] == 1 and sb["grid"] == 0 and "雲" in sb["src"] and "天気なし" not in sb["src"], (sb, sb_grid, sb_off))
        # 根拠は絵の直下の1か所だけ（11/27）：β の間は空の帯の元（空の色：…）と空の帯の言葉を出さない（詳細欄の「空の帯（参考）」へ）
        check("SB4 空の絵 β：根拠は1か所。空の帯の元・言葉は出さない", sb["from"] == 0 and "・" not in sb["word"], sb)
        # 予報の全雲量（#532）：予報の時間は、全雲量の値・何時の値か・出典が出典の欄に出る（見本の予報は 1時間ごとに cover がある）
        check("SB3 空の絵 β：予報の時間は全雲量から描き、何時の値かと出典を出す", re.search(r"\d+時の全雲量の予報 \d+% から雲を描いています", sb["src"]) is not None, sb["src"])
        check("SB2 空の絵 β：軌道・目盛りで重ね、切ると Canvas と出典が消える", sb_grid > 0 and sb_off[0] == 0 and sb_off[1] == 0 and sb_off[2] > 0, (sb_grid, sb_off))
        # 球の基準線と拡大（11/19）：高さの輪・方位の線がある。＋で 1.5倍、細かい線に。全画面でもなぞる窓。空を見上げても1画面に収まる。
        grid0 = pg.locator(".sky-pan .sky-grid").count()
        sfit = pg.evaluate("(() => { const b = document.querySelector('.sun-sheet .msheet-body'); return [b.scrollHeight, b.clientHeight]; })()")
        # 倍率のボタンは無く（11/19）、2本指でつまむ（ここでは同じ働きのキー ＋ −）。倍率は窓のチップに。
        mag_btns = pg.locator(".sky-pan .sky-mag button").count()
        pg.locator(".sky-pan").focus()
        for _ in range(5): pg.keyboard.press("+"); calm()
        ztxt = txt(".sky-pan .sky-mag"); grid1 = pg.locator(".sky-pan .sky-grid").count()
        if os.environ.get("WN_SUN"): pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-zoom.png")
        for _ in range(8): pg.keyboard.press("-"); calm()
        pg.locator(".sky-sensor .btn", has_text="全画面").click(); calm()
        pan_full = pg.locator(".sky-full .sky-pan").count()
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-pan-full.png")
        # 全画面の横向き（11/19）：操作は右の欄に、空はその左（真ん中が欄に隠れない）。縦に戻すと下に戻る。
        pg.set_viewport_size({"width": 844, "height": 390}); pg.wait_for_timeout(600)
        land = pg.evaluate("""(() => { const p = document.querySelector('.sky-full-bottom').getBoundingClientRect(); const k = document.querySelector('.sky-full-sky').getBoundingClientRect();
          const x = document.querySelector('.sky-full-top .icon-btn').getBoundingClientRect(); const hit = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2);
          return { close: !!hit && !!hit.closest('.sky-full-top'), land: !!document.querySelector('.sky-full.land'), px: Math.round(p.left), pw: Math.round(p.width), kw: Math.round(k.width), scroll: document.documentElement.scrollWidth }; })()""")
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-full-land.png")
        pg.set_viewport_size({"width": W, "height": 844}); pg.wait_for_timeout(600)
        back = pg.evaluate("(() => { const p = document.querySelector('.sky-full-bottom').getBoundingClientRect(); return [!!document.querySelector('.sky-full.land'), Math.round(p.left), Math.round(p.width)]; })()")
        check("SS2w 全画面の横向き：操作は右の欄、空はその左。縦に戻すと下に戻る", land["land"] and land["close"] and land["px"] == 544 and land["kw"] == 544 and land["scroll"] <= 844 and back == [False, 0, W], (land, back))
        pg.locator(".sky-full .icon-btn[aria-label='全画面を閉じる']").click(); calm()
        check("SS2t 球の基準線と拡大：線がある、＋5回で 8倍・線が細かく、全画面でもなぞる窓、1画面に収まる", grid0 >= 4 and mag_btns == 0 and ztxt.startswith("8.0") and grid1 > grid0 and pan_full == 1 and sfit[0] <= sfit[1] + 1, (grid0, ztxt, grid1, pan_full, sfit))
        rotate_ok("SS2u", "太陽と月・空を見上げる")
        pg.evaluate("DeviceOrientationEvent.requestPermission = async () => 'granted'")  # iPhone のように許可を求める形（許可された）
        pg.locator(".sky-sensor .btn", has_text="端末の向き").click(); calm()
        pg.evaluate("""() => { for (let i = 0; i < 20; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 100, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 187.6 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(300)
        head = pg.evaluate("(document.querySelector('.sky-view.window .sky-heading') || {}).textContent || ''")
        h_win = pg.locator(".sky-view").first.bounding_box()["height"] if pg.locator(".sky-view").count() else 0
        # 今に付いていく（11/19）：今日に端末の向きで見はじめると「今」が押された状態で、時刻が今（テストの時計 12:0x）に。
        # つまみを動かすと止まり、「今」で戻る。太陽は本当の大きさ（窓 60° で半径 1.5〜3）に輪と名前。
        now_on = pg.locator(".sun-play .btn", has_text="現在時刻").first.get_attribute("aria-pressed"); t_now = txt(".sun-now-time")
        sun_r = pg.evaluate("(() => { const c = document.querySelector('.sky-view.window .sky-sun'); if (c) return +c.getAttribute('r'); const m = document.querySelector('.sky-view.window .sky-body .moon-glyph'); return m ? +m.getAttribute('width') / 2 : null; })()")
        named = pg.locator(".sky-view.window .sky-body-name").count()
        pg.evaluate("""() => { const r = document.querySelector('.sun-card ~ .sun-play input, .sun-play input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '900'); r.dispatchEvent(new Event('input', { bubbles: true })); }"""); calm()
        now_off = pg.locator(".sun-play .btn", has_text="現在時刻").first.get_attribute("aria-pressed"); t_moved = txt(".sun-now-time")
        pg.locator(".sun-play .btn", has_text="現在時刻").first.click(); calm()
        now_back = pg.locator(".sun-play .btn", has_text="現在時刻").first.get_attribute("aria-pressed"); t_back = txt(".sun-now-time")
        if os.environ.get("WN_SUN"):
            pg.evaluate("""() => { const r = document.querySelector('.sun-play input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '930'); r.dispatchEvent(new Event('input', { bubbles: true })); }""")
            pg.evaluate("""() => { for (let i = 0; i < 20; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 105, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 240 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(400)
            pg.locator(".sky-stage").first.screenshot(path=os.environ["WN_SUN"] + "-true-size.png")
            pg.locator(".sun-play .btn", has_text="現在時刻").first.click(); calm()
            pg.evaluate("""() => { for (let i = 0; i < 200; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 100, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 187.6 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(300)
        # 見上げるとコンパスが当てにならない（11/19 実機：上へ 44°・48° で方位が 155°→250°→338°）：立てている間に測った差のまま、
        # 見上げている間はコンパスがずれても方位は変わらない。戻せばそのまま合っている。
        ev2 = lambda b, c, n=200: pg.evaluate("""([b, c, n]) => { for (let i = 0; i < n; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: c }); window.dispatchEvent(e); } }""", [b, c, n])
        hd = lambda: pg.evaluate("(document.querySelector('.sky-view.window .sky-heading') || {}).textContent || ''")
        ev2(100, 187.6); pg.wait_for_timeout(300); up0 = hd()
        ev2(135, 280); pg.wait_for_timeout(300); up1 = hd()
        ev2(100, 187.6); pg.wait_for_timeout(300); up2 = hd()
        check("SS2v 見上げてコンパスがずれても方位は変わらず、戻しても合っている", up0.startswith("南 180°") and up1.startswith("南 180°") and "上へ 45°" in up1 and up2.startswith("南 180°"), (up0, up1, up2))
        # 本物に合わせる（11/19）：カメラ（テストでは作った映像）のとき「方位を直す」を短く押すと真ん中に＋。本物の太陽を＋に合わせて
        # 画面をタップすると、方位と高さの補正が入り、描いた太陽が真ん中（＋）に来る。ここでは向きを 10° 西・上へ 35° にずらしておく。
        pg.evaluate("""() => { navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.width = 480; c.height = 640; c.getContext('2d').fillRect(0, 0, 480, 640); return c.captureStream(5); }; }""")
        # コンパスとの差は立てている間（上下 20° 以内）だけ測るので、立てて 10° ずれたコンパスを読ませてから見上げる。
        look_up = lambda n=200: pg.evaluate("""(n) => { const go = (b) => { for (let i = 0; i < n; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 197.6 }); window.dispatchEvent(e); } }; go(100); go(125); }""", n)
        look_up(); pg.wait_for_timeout(300)
        pg.locator(".sky-sensor .btn", has_text="カメラ").first.click(); calm()
        aim_btn = pg.locator(".sky-sensor .compass-hold").count()
        sun0 = pg.locator(".sky-view.window .sky-sun").first.bounding_box() if pg.locator(".sky-view.window .sky-sun").count() else None
        moved_ok = None
        if aim_btn and sun0:
            pg.locator(".sky-sensor .compass-hold").click(); calm()
            cross = pg.locator(".sky-view.window .sky-aim").count()
            st = pg.locator(".sky-view.window").bounding_box()
            pg.mouse.click(st["x"] + st["width"] * 0.2, st["y"] + st["height"] * 0.8); calm(); look_up(); pg.wait_for_timeout(300)
            sun1 = pg.locator(".sky-view.window .sky-sun").first.bounding_box()
            note = txt(".sky-sensor-state")
            cx, cy = st["x"] + st["width"] / 2, st["y"] + st["height"] / 2
            moved_ok = (cross == 1 and abs(sun1["x"] + sun1["width"] / 2 - cx) < 4 and abs(sun1["y"] + sun1["height"] / 2 - cy) < 4 and abs(sun0["x"] - sun1["x"]) > 10, note)
            if os.environ.get("WN_SUN"): pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-aim.png")
        pg.locator(".sky-sensor .btn", has_text="カメラ").first.click(); calm()
        check("SS2q 本物に合わせる：真ん中に＋、タップで描いた太陽が＋に来る（方位と高さの補正）、何をしたかを出す", aim_btn == 1 and moved_ok is not None and moved_ok[0] and "太陽に合わせました" in moved_ok[1] and "高さ" in moved_ok[1], (aim_btn, sun0, moved_ok))
        # 補正を 0 に戻す（あとのコンパス補正の確かめのため）
        if pg.locator(".sky-sensor .btn", has_text="0°に").count(): pg.locator(".sky-sensor .btn", has_text="0°に").click(); calm()
        pg.evaluate("""() => { for (let i = 0; i < 200; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 100, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 187.6 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(300)
        # 「現在時刻」をもう一度押すと付いていくのをやめる。つまみの両側の ◀ ▶ で 10分ずつ（11/19 渡辺さん）。
        pg.locator(".sun-play .btn", has_text="現在時刻").first.click(); calm()
        now_off2 = pg.locator(".sun-play .btn", has_text="現在時刻").first.get_attribute("aria-pressed")
        tA = txt(".sun-now-time"); pg.locator(".sun-play .icon-btn[aria-label='10分先へ']").first.click(); calm(); tB = txt(".sun-now-time")
        pg.locator(".sun-play .icon-btn[aria-label='10分前へ']").first.click(); pg.locator(".sun-play .icon-btn[aria-label='10分前へ']").first.click(); calm(); tC = txt(".sun-now-time")
        tm2 = lambda x: int(x.split(":")[0]) * 60 + int(x.split(":")[1])
        check("SS2x 現在時刻をもう一度押すとやめる・◀ ▶ で 10分ずつ", now_off2 == "false" and tm2(tB) - (tm2(tA) // 10 * 10) == 10 and tm2(tB) - tm2(tC) == 20, (now_off2, tA, tB, tC))
        pg.locator(".sun-play .btn", has_text="現在時刻").first.click(); calm()
        check("SS2p 今に付いていく：向きで見ると今の時刻、つまみで止まり「今」で戻る。太陽は本当の大きさに名前", now_on == "true" and t_now.startswith("12:0") and now_off == "false" and t_moved == "15:00" and now_back == "true" and t_back.startswith("12:0") and sun_r is not None and 1.5 <= sun_r <= 4 and named >= 1, (now_on, t_now, now_off, t_moved, now_back, t_back, sun_r, named))
        # 全画面（2026-11-19）：画面いっぱいの空と、下に時刻・動かす・カメラ・ずれ。閉じると元のシートに戻る。カメラのボタンもある。
        cam_btn = pg.locator(".sky-sensor .btn", has_text="カメラ").count()
        pg.locator(".sky-sensor .btn", has_text="全画面").click(); calm()
        fb = pg.locator(".sky-full .sky-stage").bounding_box() if pg.locator(".sky-full").count() else None
        full_ok = fb is not None and fb["width"] >= W - 1 and fb["height"] >= 843 and pg.locator(".sky-full .sun-slider").count() == 1
        pg.locator(".sky-full .icon-btn[aria-label='全画面を閉じる']").click(); calm()
        check("SS2f 全画面：画面いっぱいの空と時刻のつまみ、閉じると元に戻る。カメラのボタンがある", cam_btn >= 1 and full_ok and pg.locator(".sky-full").count() == 0 and pg.locator(".sun-sheet").count() == 1, (cam_btn, fb))
        # 方位を直す（11/19 長押し）：押し続けると目盛りが開き、そのまま左へなぞると方位が大きく（右へ）ずれ、離すと閉じる。
        # 短く押す（カメラなし）は使い方を出す。キーでも動き、「0°に」で戻せる。
        deg = lambda: int(re.search(r"(\d+)°", pg.evaluate("(document.querySelector('.sky-view.window .sky-heading') || {}).textContent || ''")).group(1))
        relook = lambda: (pg.evaluate("""() => { for (let i = 0; i < 20; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 100, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 187.6 }); window.dispatchEvent(e); } }"""), pg.wait_for_timeout(300))
        hold = pg.locator(".sky-sensor .compass-hold"); hb = hold.bounding_box()
        pg.locator(".sky-sensor .compass-hold").click(); calm(); hint = txt(".sky-sensor-state")
        d0 = deg()
        pg.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2); pg.mouse.down(); pg.wait_for_timeout(450)
        pop_open = pg.locator(".sky-sensor .compass-pop.open").count()
        pg.mouse.move(hb["x"] + hb["width"] / 2 - 40, hb["y"] + hb["height"] / 2, steps=5)
        if os.environ.get("WN_SUN"): pg.wait_for_timeout(250); pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-hold.png")
        pg.mouse.up(); calm()
        calm(); pop_closed = pg.locator(".sky-sensor .compass-pop.open").count() == 0
        relook(); lab1 = hold.inner_text(); d1 = deg()
        hold.focus(); pg.keyboard.press("ArrowLeft"); calm(); lab2 = hold.inner_text()
        pg.locator(".sky-sensor .btn", has_text="0°に").click(); calm(); lab3 = hold.inner_text()
        tap_ok = pg.evaluate("(() => { const b = document.querySelector('.sky-sensor .compass-hold'); return parseFloat(getComputedStyle(b, '::after').height); })()") >= 44
        if os.environ.get("WN_SUN"):
            pg.evaluate("""() => { for (let i = 0; i < 200; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 34, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 160 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(300)
            pg.locator(".sun-card").screenshot(path=os.environ["WN_SUN"] + "-down.png"); relook()
            pg.evaluate("""() => { for (let i = 0; i < 200; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 100, gamma: 0 }); Object.defineProperty(e, 'webkitCompassHeading', { value: 187.6 }); window.dispatchEvent(e); } }"""); pg.wait_for_timeout(300)
        check("SS2g 方位を直す：長押しで目盛り、左へなぞると方位が右へずれ、離すと閉じる。短く押すと使い方、キーと 0°に",
              pop_open == 1 and pop_closed and "+10°" in lab1 and (d1 - d0) % 360 == 10 and "+9°" in lab2 and lab3.strip() == "方位を直す" and tap_ok and "長押し" in hint, (hint, d0, d1, lab1, lab2, lab3, pop_open))
        # 横・斜めに持つ（2026-11-19、実機の値）：立てている間にコンパスとの差を測り、横に持っても方位が合う。地平線が傾く。
        ev = lambda a, b, g, c, n: pg.evaluate("""([a, b, g, c, n]) => { for (let i = 0; i < n; i++) { const e = new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g }); Object.defineProperty(e, 'webkitCompassHeading', { value: c }); window.dispatchEvent(e); } }""", [a, b, g, c, n])
        ev(283.0, 94.8, 81.3, 348.7, 150); pg.wait_for_timeout(300)  # 別の日の実機の値なので、外れ値として2秒ぶん続けて受け入れさせる
        ev(79.1, 4.8, -89.0, 283.4, 60); pg.wait_for_timeout(400)
        head2 = pg.evaluate("(document.querySelector('.sky-view.window .sky-heading') || {}).textContent || ''")
        hl = pg.evaluate("(() => { const l = document.querySelector('.sky-view.window .sun-horizon'); return l ? [+l.getAttribute('x1'), +l.getAttribute('y1'), +l.getAttribute('x2'), +l.getAttribute('y2')] : null; })()")
        if os.environ.get("WN_SUN"): pg.locator(".sky-stage").first.screenshot(path=os.environ["WN_SUN"] + "-roll.png")
        steep = hl is not None and abs(hl[3] - hl[1]) > 5 * abs(hl[2] - hl[0])
        ev(283.0, 94.8, 81.3, 348.7, 150); pg.wait_for_timeout(300)  # 別の日の実機の値なので、外れ値として2秒ぶん続けて受け入れさせる
        check("SS2k 横に持つ：方位は北のまま（コンパスの横ずれを使わない）、地平線が縦に傾く", head2.startswith("北") and steep, (head2, hl))
        pg.locator(".sky-sensor .btn", has_text="端末の向き").click(); calm()
        h_pan = pg.locator(".sky-view").first.bounding_box()["height"] if pg.locator(".sky-view").count() else 0
        check("SS2d 端末の向きで見る：南を向けると南を真ん中にした窓（上へ10°）、やめると戻る、絵の高さは同じ", head.startswith("南 180°") and "上へ 10°" in head and pg.locator(".sky-view.window").count() == 0 and abs(h_win - h_pan) < 1, (head, h_win, h_pan))
        pg.locator(".sun-card .seg button", has_text="高さのグラフ").click(); calm()
        # 月のこよみ（2026-11-19）：選んだ日の月・出入り・その月のカレンダー・次の4つの月相。日を押すとその日に。1画面に収まる。
        pg.locator(".moon-open").click(); calm()
        t0 = txt(".moon-today")
        # 今に付いていく（11/19）：今日を開くと「今」が押された状態で、観測の予測は今の時刻（テストの時計 12:0x）。
        mnow = pg.locator(".moon-play .btn", has_text="現在時刻").get_attribute("aria-pressed"); mobs = txt(".moon-obs")
        check("SS2s 月のこよみ：今日を開くと今に付いていく（「今」が押された状態・今の時刻）、地点の切り替えがある", mnow == "true" and "12:0" in mobs and pg.locator(".moon-obs .btn", has_text="現在地").count() == 1, (mnow, mobs[:30]))
        # 日を押すと、その日の月のモーダルが開く（11/20）。ここでは選ぶだけなので、開いたら閉じる。
        def pick_day(i):
            pg.locator(".moon-cal-day").nth(i).click(); calm()
            if pg.locator(".moon-day-sheet").count(): pg.locator(".moon-day-sheet .icon-btn.close").click(); calm()
        # 月相の印とその日のモーダル（11/20 渡辺さん）：新月・上弦・満月・下弦の日にアイコンと名前。満月の日を押すと、その日の月（呼び名つき）。閉じると元の位置。
        marks_n = pg.locator(".moon-cal-mark").count(); full_d = pg.locator(".moon-cal-day:has(.moon-cal-mark.k2)")
        y_before = pg.evaluate("document.querySelector('.moon-sheet .msheet-body').scrollTop")
        full_d.first.click(); calm()
        day_txt = txt(".moon-day-sheet") if pg.locator(".moon-day-sheet").count() else ""
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon-day.png")
        pg.locator(".moon-day-sheet .icon-btn.close").click(); calm()
        y_after = pg.evaluate("document.querySelector('.moon-sheet .msheet-body').scrollTop")
        check("SS3a 月相の印が4つ前後、満月の日を押すとその日の月（満月の時刻・呼び名・出入り）、閉じると元の位置", 3 <= marks_n <= 5 and "満月（" in day_txt and "ムーン" in day_txt and "月の出" in day_txt and pg.locator(".moon-day-sheet").count() == 0 and abs(y_before - y_after) < 2 and pg.locator(".moon-next .phase-icon").count() == 4, (marks_n, day_txt[:60], y_before, y_after))
        # 満月の呼び名のページ（11/20）：その年の満月の一覧、押した満月の由来が開く。その年だけのことは計算から（2026年は3/3 皆既月食・5/31 ブルームーン・12/24 いちばん近い）。
        pg.locator(".moon-sheet .fm-open-row .btn").click(); calm()
        fm_rows = pg.locator(".fm-row").count(); fm_txt = txt(".fm-sheet")
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-fullmoons.png")
        pg.locator(".fm-sheet .icon-btn.close").click(); calm()
        check("SS3b 満月の呼び名：2026年は13回、開いた満月に由来、皆既月食・ブルームーン・いちばん近い満月を計算から", fm_rows == 13 and "名前の由来" in fm_txt and "ビーバームーン" in fm_txt and "皆既月食（" in fm_txt and "ブルームーン" in fm_txt and "いちばん近い" in fm_txt and pg.locator(".fm-sheet").count() == 0, (fm_rows, fm_txt[:80]))
        cal = pg.locator(".moon-cal-day").count()
        pick_day(23)
        t1 = txt(".moon-today")
        mfit = pg.evaluate("(() => { const b = document.querySelector('.moon-sheet .msheet-body'); return [b.scrollHeight, b.clientHeight]; })()")
        check("SS2e 月のこよみ：月齢と形、カレンダーの日が30、次の月相4つ、日を押すと替わる、スクロールしないで収まる", "月齢" in t0 and cal == 30 and pg.locator(".moon-next span").count() == 4 and t1 != t0 and "11/24" in t1 and mfit[0] <= mfit[1] + 1, (t0[:40], cal, t1[:40], mfit))
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon.png")
        # 満ち欠けと大きさ（2026-11-19）：同じ枠でグラフに替わる。下の月相は動かない。グラフを押すとその日が選ばれる。1画面に収まる。
        y_next0 = pg.locator(".moon-next").bounding_box()["y"]
        pg.locator(".moon-sheet .seg button", has_text="満ち欠けと大きさ").click(); calm()
        y_next1 = pg.locator(".moon-next").bounding_box()["y"]
        gb = pg.locator(".moon-trend-chart").bounding_box()
        pg.mouse.click(gb["x"] + gb["width"] * 0.2, gb["y"] + gb["height"] / 2); calm()
        t2 = txt(".moon-today")
        mfit2 = pg.evaluate("(() => { const b = document.querySelector('.moon-sheet .msheet-body'); return [b.scrollHeight, b.clientHeight]; })()")
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon-trend.png")
        check("SS2h 月のこよみ・満ち欠けと大きさ：同じ枠で替わり下が動かない、押すとその日、収まる", abs(y_next0 - y_next1) < 1 and t2 != t1 and mfit2[0] <= mfit2[1] + 1 and pg.locator(".moon-trend-mark").count() >= 1, (y_next0, y_next1, t2[:30], mfit2))
        pg.locator(".moon-sheet .seg button", has_text="カレンダー").click(); calm()
        # 見え方のシミュレーション（2026-11-19）：時刻のつまみで、月の形・傾き・色・位置がその時刻に。地平線の下は色なし。
        setm = lambda v: pg.evaluate("""(v) => { const r = document.querySelector('.moon-play input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(v)); r.dispatchEvent(new Event('input', { bubbles: true })); }""", v)
        pick_day(23)
        setm(1380); calm(); t23 = txt(".moon-obs"); tint23 = pg.locator(".moon-obs canvas.moon-glyph").count(); d23 = pg.locator(".moon-obs .moon-glyph").bounding_box()
        sb = pg.locator(".moon-obs-stage").bounding_box()
        pg.locator(".moon-obs .seg button", has_text="違いを強める").click(); calm(); d23s = pg.locator(".moon-obs .moon-glyph").bounding_box(); sb2 = pg.locator(".moon-obs-stage").bounding_box()
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon-strong.png")
        pg.locator(".moon-obs .seg button", has_text="実際の比").click(); calm()
        # 描き方（11/19）：見え方（暗い側は描かない）と月の全体（暗い側も）を切り替える。枠は動かない。
        h0 = pg.locator(".moon-obs-stage").bounding_box()["height"]
        pg.locator(".moon-obs-side .seg button", has_text="月の全体").click(); calm()
        lab = pg.locator(".moon-obs-stage").get_attribute("aria-label"); h1 = pg.locator(".moon-obs-stage").bounding_box()["height"]
        pg.locator(".moon-obs-side .seg button", has_text="見え方").click(); calm()
        check("SS2m 描き方：見え方／月の全体を切り替え、絵は canvas、枠の高さは同じ", "月の全体" in lab and pg.locator(".moon-obs-stage canvas").count() == 1 and abs(h0 - h1) < 1, (lab, h0, h1))
        setm(720); calm(); t12 = txt(".moon-obs"); g12 = pg.locator(".moon-obs .moon-glyph").count()
        today12 = txt(".moon-today")
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon-below.png")
        # 11/19：暦の上の月（その日）と観測の予測（その時刻）を分ける。見えない時刻は月を描かず「見えません」と次に昇る時刻。
        # 大きさは実際の比／違いを強める（強めると大きく、舞台の枠は動かない）。
        check("SS2i 観測の予測：23時は高い月（色つき・0°33′・平均より大きい）、強めるとさらに大きく枠は同じ、正午は描かず次に昇る時刻、暦は替わらない",
              "23:00" in t23 and "高さ 7" in t23 and "0°33′" in t23 and "平均より +" in t23 and tint23 == 1 and d23s["width"] > d23["width"] + 4 and abs(sb["height"] - sb2["height"]) < 1
              and "地平線の下" in t12 and "次は" in t12 and g12 == 0 and "満月" in today12, (t23[:80], tint23, d23["width"], d23s["width"], t12[:50], g12))
        # その日の月の高さ（2026-11-19）：グラフを押すとその時刻に。3時間ごとの小さな月、傾きと大きさの幅の行。
        db = pg.locator(".moon-day").bounding_box()
        pg.mouse.click(db["x"] + 30 * db["width"] / pg.evaluate("document.querySelector('.moon-day').viewBox.baseVal.width") + (db["width"] - (30 + 8) * db["width"] / pg.evaluate("document.querySelector('.moon-day').viewBox.baseVal.width")) / 2, db["y"] + db["height"] / 2); calm()
        tday = txt(".moon-obs")
        check("SS2l 月の高さのグラフ：押すと正午に、小さな月がある", "12:00" in tday and pg.locator(".moon-day .moon-glyph").count() >= 2, (tday[:30],))
        # 別の日の天気と雲（11/20 渡辺さん）：別の日を選ぶとその日の天気を読み込み、空の色に。予報の先で毎時の天気が無い日（11/17）は
        # 「天気が無い」。10/30 は 21時台に月が出ていて、テストの天気は 20〜21時台が雨：前後の時間の天気から「雲で見えにくい」。
        # 23時台は前後2時間に天気が無いので出さない。
        pick_day(16); calm(); c_none = txt(".moon-sky-note")
        pg.locator(".moon-cal-head .icon-btn[aria-label='前の月']").click(); calm()
        pick_day(29); setm(1290); calm()
        c_note = txt(".moon-sky-note"); c_n = pg.locator(".moon-obs-cloud").count(); c_lab = pg.locator(".moon-obs-stage").get_attribute("aria-label") or ""
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-moon-cloud.png")
        setm(1430); calm(); c_n2 = pg.locator(".moon-obs-cloud").count()
        cfit = pg.evaluate("(() => { const b = document.querySelector('.moon-sheet .msheet-body'); return [b.scrollHeight, b.clientHeight]; })()")
        check("SS3c 別の日を選ぶとその日の天気を読み込み空の色に（無い日は無いと）、雨の頃の月は「雲で見えにくい」、天気の分からない時間は出さない、収まる",
              "天気が無い" in c_none and "この日の天気" in c_note and c_n == 1 and "20時台 雨" in c_lab and c_n2 == 0 and cfit[0] <= cfit[1] + 1, (c_none, c_note, c_n, c_lab[-30:], c_n2, cfit))
        if os.environ.get("WN_SUN"):
            setm(1380); calm(); pg.screenshot(path=os.environ["WN_SUN"] + "-moon-sim.png")
            setm(1050); calm(); pg.screenshot(path=os.environ["WN_SUN"] + "-moon-sim-low.png")
            pick_day(12)
            for m in (1000, 1080, 1140): setm(m); calm(); pg.locator(".moon-obs").screenshot(path=os.environ["WN_SUN"] + f"-moon-cres-{m}.png")
            for day, m in ((12, 1080), (23, 1380), (16, 1260)):
                pick_day(day); setm(m); calm()
                for L in ("見え方", "月の全体"):
                    pg.locator(".moon-obs-side .seg button", has_text=L).click(); calm(); pg.locator(".moon-obs").screenshot(path=os.environ["WN_SUN"] + f"-bc-{day}-{L}.png")
                pg.locator(".moon-obs-side .seg button", has_text="見え方").click(); calm()
        pg.locator(".moon-sheet .icon-btn.close").click(); calm()
        fit = pg.evaluate("(() => { const b = document.querySelector('.sun-sheet .msheet-body'); const p = document.querySelector('.sun-sheet'); return [b.scrollHeight, b.clientHeight, Math.round(p.getBoundingClientRect().height), innerHeight]; })()")
        check("SS2b 太陽のシートはスクロールしないで収まる", fit[0] <= fit[1] + 1, fit)
        # 画面の日の出入りは計算だけ（11/19）：太陽のシート・1日モードの行・比較のまとめで同じ時刻（どれも Open-Meteo の値を読まない）。
        sheet_rise = pg.locator(".sun-keys:not(.moon) .sun-key b").first.inner_text(); sheet_set = pg.locator(".sun-keys:not(.moon) .sun-key b").nth(2).inner_text()
        # 日の出の行は空・光の仲間だけ（2026-11-24）：空・光にして読む。
        sky = pg.locator(".item-bar .ib-cat[data-items^='radiation']")
        if sky.count(): sky.dispatch_event("click"); calm()  # 太陽のシートの下
        others = pg.evaluate("""() => ({ dd: [...document.querySelectorAll('.dd-sun b')].slice(0, 2).map(e => e.textContent), cs: (document.querySelector('.cs-sun .cs-a') || {}).textContent || null })""")
        same = (not others["dd"] or others["dd"] == [sheet_rise, sheet_set]) and (others["cs"] is None or others["cs"].strip() == f"{sheet_rise}–{sheet_set}")
        check("SS2o 日の出入りが太陽のシート・1日モード・比較のまとめで同じ", same and (others["dd"] or others["cs"]), (sheet_rise, sheet_set, others))
        if pg.locator(".item-bar .ib-cat[data-items^='temp']").count(): pg.locator(".item-bar .ib-cat[data-items^='temp']").dispatch_event("click"); calm()
        # 現在地で計算（11/19）：位置を許可すると、太陽と月は現在地（0.01° に丸めた値）で。題に（現在地）、月のこよみは「現在地から見た」。
        # やめると観測所に戻る。ここでは札幌あたりの位置を流す（高知と日の出がはっきり違う）。
        rise0 = pg.locator(".sun-keys:not(.moon) .sun-key b").first.inner_text()
        pg.context.grant_permissions(["geolocation"]); pg.context.set_geolocation({"latitude": 43.0621, "longitude": 141.3544})
        pg.locator(".sun-foot .btn", has_text="現在地で計算").click(); calm()
        rise1 = pg.locator(".sun-keys:not(.moon) .sun-key b").first.inner_text(); here_t = txt(".sun-here"); title1 = txt(".sun-sheet .msheet-head h2")
        pg.locator(".moon-open").click(); calm(); mo_here = txt(".moon-obs"); pg.locator(".moon-sheet .icon-btn.close").click(); calm()
        if os.environ.get("WN_SUN"): pg.screenshot(path=os.environ["WN_SUN"] + "-here.png")
        fit2 = pg.evaluate("(() => { const b = document.querySelector('.sun-sheet .msheet-body'); return [b.scrollHeight, b.clientHeight]; })()")
        pg.locator(".sun-foot .btn", has_text="現在地で計算").click(); calm()
        rise2 = pg.locator(".sun-keys:not(.moon) .sun-key b").first.inner_text()
        check("SS2n 現在地で計算：日の出が替わる、題に（現在地）、丸めた座標、月は現在地から、収まる、やめると戻る",
              rise1 != rise0 and "（現在地）" in title1 and "北緯 43.06°・東経 141.35°" in here_t and "現在地から見た" in mo_here and fit2[0] <= fit2[1] + 1 and rise2 == rise0, (rise0, rise1, rise2, title1, here_t, mo_here[:20], fit2))
        pg.evaluate("""() => { const r = document.querySelector('.sun-slider input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(r, '370'); r.dispatchEvent(new Event('input', { bubbles: true })); }"""); calm()
        check("SS3 スライダーで 6:10 に（10分ごと）", txt(".sun-now-time") == "6:10", txt(".sun-now"))
        layout_ok("SS4", "太陽のシート")
        pg.click(".msheet .icon-btn.close"); calm()
        check("SS5 閉じる", pg.locator(".sun-sheet").count() == 0)
        # TR. Text roles (tokens TEXT_ROLES): each role draws the same on the readout and the table.
        roles = pg.evaluate("""() => {
          const R = { 見出し: ['.ro-title'], 指標名: ['.ro-label', '.labels .label-value:not(.label-diff)'],
            主要数値: ['.ro-v:not(.ro-b):not(.ro-diff):not(.ro-text):not(.ro-icon)', '.cell-value:not(.minor):not(.cell-diff):not(.long)', '.cs-row:not(.cs-sun) .cs-val'],
            比較数値: ['.ro-diff', '.cell-diff:not(.long)'], 補足: ['.ro-unit', '.ro-col', '.cell-kind', '.label-unit'] };
          const out = {};
          for (const [role, sels] of Object.entries(R)) {
            const seen = new Set();
            for (const s of sels) for (const e of document.querySelectorAll(s)) {
              if (!e.getBoundingClientRect().width || !e.textContent.trim() || e.textContent.trim() === '—') continue;
              const c = getComputedStyle(e); seen.add(`${c.fontSize} ${c.fontWeight}`);
            }
            out[role] = [...seen];
          }
          return out;
        }""")
        # The chosen day's column is set in bold (its emphasis), the rest regular; the heading is bold.
        want = {"見出し": ["13px 600"], "指標名": ["12px 400"], "主要数値": ["15px 400", "15px 600"], "比較数値": ["13px 400", "13px 600"], "補足": ["11px 400"]}
        check("TR 文字の役割がどこでも同じ大きさ・太さ", all(set(roles[k]) <= set(v) and roles[k] for k, v in want.items()), str(roles))
        n = pg.locator(".legend-line").count()
        check("AV2 凡例の線は4つ（対象・比較・それぞれの手前）", n == 4, str(n))
        pg.locator(".legend-line").nth(1).click(); calm()
        check("AV3 タップで薄く（押されていない状態に）", pg.locator(".legend-line").nth(1).get_attribute("aria-pressed") == "false")
        pg.locator(".legend-line").nth(1).click(); calm()
        check("AV4 もう一度で戻る", pg.locator(".legend-line").nth(1).get_attribute("aria-pressed") == "true")
        ticks = lambda: pg.locator(".hour-compare .chart-tick").all_inner_texts()
        calm(4500)
        before_ticks = ticks()
        pg.locator(".avg-window").click(); calm(4500)
        check("AV5 平均の期間が 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週の平均").count() == 1)
        check("AV5c 差の行の名前も 2週 に", pg.locator(".readout-card .ro-label", has_text="手前2週との差").count() == 1)
        check("AV5b 期間を変えても縦軸は同じ", ticks() == before_ticks, f"{before_ticks} → {ticks()}")
        pg.locator(".avg-window").click(); calm(3600)
        pg.locator(".ro-grid").last.scroll_into_view_if_needed(); calm()
        check("AV5d 1か月 でも名前が列に収まる", pg.locator(".readout-card .ro-label", has_text="手前1か月との差").count() == 1)
        layout_ok("AV5e", "手前1か月の読み取り")
        pg.locator(".avg-window").click(); calm()
        check("AV6 1か月 を経て 1週 に戻る", pg.locator(".readout-card .ro-label", has_text="手前1週の平均").count() == 1)
        pg.locator(".back-btn").first.click(); calm()
    step("AV", av)

    # I. close rules on the calendar: Esc, backdrop, ×, drag; pick closes
    def i_():
        for how in ["Esc", "背景", "×", "つまみ"]:
            pg.locator(".side .date-button").first.click(); calm()
            ok_open = pg.locator(".msheet.calendar").count() == 1
            if how == "Esc": pg.keyboard.press("Escape")
            elif how == "背景": pg.mouse.click(200, 30)
            elif how == "×": pg.click(".msheet .icon-btn.close")
            else:
                hb = pg.locator(".msheet .sheet-handle").bounding_box()
                pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 8); pg.mouse.down(); pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + 300, steps=6); pg.mouse.up()
            calm()
            check(f"I 閉じ方（{how}）", ok_open and pg.locator(".msheet").count() == 0)
        pg.locator(".side .date-button").first.click(); calm()
        check("I カレンダーは中身の高さ", "fit" in pg.locator(".msheet").get_attribute("class"))
        layout_ok("I0", "カレンダー")
        buttons_ok("I0b", "カレンダー", 1)
        check("I0c 日を選ぶまで［決定］は押せない", pg.locator(".calendar-foot .btn.primary").is_disabled())
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); calm()
        check("I 1回目のタップは仮（閉じない、上の組み合わせが変わる）", pg.locator(".msheet").count() == 1 and pg.locator(".cal-pair.changed").count() == 1)
        st = small_text(); check("I1b 11px より小さい文字がない（カレンダー）", not st, str(st))
        pg.locator(".cal-day:not(:disabled)").nth(3).click(); calm()
        check("I 同じ日をもう一度で決まって閉じる", pg.locator(".msheet").count() == 0 and txt(".side .date-button") != "2026/11/10", txt(".side .date-button"))
        had = pg.locator(".today-chip").count()
        pg.click(".today-chip") if had else None; calm()
        check("I 今日ボタンで今日に戻る", had and txt(".side .date-button") == "2026/11/10", f"chip {had} → {txt('.side .date-button')}")
    step("I", i_)

    # J. settings
    def j():
        pg.click(".app-head .icon-btn"); calm()
        check("J1 設定が開く", pg.locator(".msheet.settings").count() == 1)
        st = small_text(); check("J1b 11px より小さい文字がない（設定）", not st, str(st))
        layout_ok("J1c", "設定")
        buttons_ok("J1d", "設定", 0)
        check("J2 設定は下に閉じるボタンなし", pg.locator(".msheet .actions button:has-text('閉じる')").count() == 0)
        # 管理者ページ（11/24）：入口は設定のいちばん下に1つ。中は 運用・予報・確認用・ユーザー の切り替え。
        check("J2b 管理者の項目は設定の中に散らばらない（入口の1つだけ）", pg.locator("#set-research").count() == 0 and pg.locator("#set-event").count() == 0 and pg.locator(".msheet.settings button", has_text="データの保守").count() == 0 and pg.locator(".msheet.settings button", has_text="管理者ページ").count() == 1)
        pg.locator(".msheet.settings button", has_text="管理者ページ").click(); calm()
        ap = pg.locator(".admin-page-sheet")
        ap.locator(".seg button", has_text="確認用").click(); calm()
        check("J3 管理者ページの確認用：「研究用（テスト）」に比べ板が4つ、イベントの見出しの確かめ", ap.locator("#set-research").count() == 1 and ap.locator("section[aria-labelledby='set-research'] .actions button").count() == 4 and ap.locator("#set-event").count() == 1)
        check("J4 肌感の基準にはテストのボタンがない", pg.locator("section[aria-labelledby='set-feel'] button", has_text="比べる").count() == 0)
        # 予報の履歴 (#250, R2): the record's months, taken one at a time by the administrator.
        ap.locator(".seg button", has_text="予報").click(); calm()
        settle(lambda: pg.locator(".admin-imports li").count() == 1 and pg.locator(".ad-types li").count() > 0)
        check("J5d 管理者ページの予報：影の運用の記録と型の確かめ（型ごとの期待とこれまで）、型にならなかったもの", "2026-11-23 の発表：判定 56件" in ap.locator("section[aria-labelledby=ad-shadow]").inner_text() and pg.locator(".ad-types li").count() == 9 and pg.locator(".ad-rejected li").count() >= 3, ap.inner_text()[:200])
        sec = pg.locator("section[aria-labelledby='admin-forecast-import']")
        sec.scroll_into_view_if_needed(); calm()
        check("J5 管理：予報の履歴の取り込み（取り込んだ月と次の月のボタン）", pg.locator(".admin-imports li").count() == 1 and sec.locator("button", has_text="2025-02 を取り込む").count() == 1, sec.inner_text()[:120])
        btn = sec.locator("button", has_text="2025-02 を取り込む")
        check("J5c 次の月が記録にまだ無いときは押せず、入る見込みの日を出す", btn.count() == 1 and btn.is_disabled() and "2025年3月2日の夜の見込み" in sec.inner_text(), sec.inner_text()[:200])
        layout_ok("J5b", "管理者ページ（予報）")
        if os.environ.get("WN_SHOT"): sec.screenshot(path=f"{os.environ['WN_SHOT']}-admin-import.png")
        ap.locator(".seg button", has_text="ユーザー").click(); calm()
        check("J5e 管理者ページのユーザー：ユーザーの追加と一覧", ap.locator("#admin-add").count() == 1 and ap.locator("#admin-users").count() == 1)
        # データの保守（#299 P1、2026-11-19）：今の状態・取得（取り直しは要る段だけ）・欠け・エラー（コピー）・重なり・大きさ。管理者ページの「運用」（11/24）。
        ap.locator(".seg button", has_text="運用").click(); calm()
        settle(lambda: pg.locator(".admin-page-sheet .mt-list").count() >= 3)
        ms = pg.locator(".admin-page-sheet")
        rb = ms.locator("button", has_text="今すぐ取り直す")
        check("J6 データの保守：注意の行、取り直しは要る段（雨雲）だけ、ほかは「必要ありません」、エラー2件、重なりの疑い", ms.locator(".mt-badge", has_text="注意 1").count() == 1 and rb.count() == 1 and "あと2回" in rb.inner_text() and ms.locator(".mt-fine", has_text="今は取り直す必要はありません").count() == 3 and "2件" in ms.inner_text() and "訂正報" in ms.inner_text() and "表ごとの行数（3表）" in ms.inner_text(), ms.inner_text()[:300])
        wk = ms.locator("section[aria-labelledby=mt-weekly]")
        check("J6c 週の点検：最新と履歴を分けて出し、抜けの回数と R2 の実物、今すぐ点検するボタン", "最新：すべて新しい" in wk.inner_text() and "履歴：抜けのある系列 1" in wk.inner_text() and "抜け 2回（1か所）" in wk.inner_text() and "33,576回分" in wk.inner_text() and "20件中 20件そのまま" in wk.inner_text() and wk.locator("button", has_text="今すぐ点検する").count() == 1, wk.inner_text()[:300])
        od = ms.locator("section[aria-labelledby=mt-offsite]")
        check("J6e 原本の控え（GitHub）：何日分・大きさ・最後に置いた日・遅れなし", "23日分（23.0MB）・最後に置いた日 2026-11-09・遅れなし" in od.inner_text(), od.inner_text()[:200])
        wk.locator("button", has_text="抜けた区間").click(); calm()
        check("J6d 週の点検：抜けた区間と、取り直せるかの注意書き", "11/8 6:00 〜 11/8 15:00 の間（2回）" in wk.inner_text() and "約10日" in wk.inner_text(), wk.inner_text()[-300:])
        layout_ok("J6b", "管理者ページ（運用）")
        if os.environ.get("WN_SHOT"):
            pg.set_viewport_size({"width": W, "height": 2200}); calm()
            ms.screenshot(path=f"{os.environ['WN_SHOT']}-maintenance.png")
            pg.set_viewport_size({"width": W, "height": 844}); calm()
        esc()
        esc()
    step("J", j)

    # TH. テーマ (#241): chosen in settings, put in use at once (CSS and the SVG charts), kept on the device.
    def th():
        shots = os.environ.get("WN_SHOT")
        for name, label in (("mist", "Mist"), ("warm", "White"), ("navy", "Navy")):
            pg.click(".app-head .icon-btn"); calm()
            pg.locator(".msheet.settings .seg button", has_text=label).click(); calm()
            check(f"TH1 {label}：テーマが変わり、設定は開いたまま", pg.evaluate("document.documentElement.dataset.theme") == name and pg.locator(".msheet.settings").count() == 1)
            esc()
            bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
            want = {"mist": "rgb(196, 208, 193)", "warm": "rgb(247, 245, 240)", "navy": "rgb(0, 7, 31)"}[name]
            check(f"TH2 {label}：画面の地の色がそのテーマの page", bg == want, bg)
            if shots:
                pg.screenshot(path=f"{shots}-theme-{name}.png", full_page=False)
                pg.evaluate("window.scrollTo(0, 0)")
                pg.locator(".side-target .strip-col.is-center .cell-stack").first.dispatch_event("click"); calm(1500)
                pg.evaluate("__flick('.sheet-handle',-700,120)"); calm(800)
                pg.screenshot(path=f"{shots}-theme-{name}-hours.png", full_page=False)
                pg.click(".back-btn") if pg.locator(".back-btn").count() else None; calm()
                pg.evaluate("__flick('.sheet-handle',700,120)"); calm(800)
            st = small_text(); check(f"TH3 {label}：11px より小さい文字がない", not st, str(st))
        check("TH4 選んだテーマはこの端末に残る", pg.evaluate("localStorage.getItem('weather-note-theme')") == "navy")
    step("TH", th)

    # SD. 1日モード (#247): the header switch hides the comparison table and the sheet, and tells the
    # selected day under the week; its 時間帯 open their hours; back to 比較 brings the table back.
    def sd():
        shots = os.environ.get("WN_SHOT")
        pg.locator(".app-head .seg button", has_text="1日").click(); calm()
        check("SD1 1日：比較の表と下のシートが消え、1日の画面が出る", pg.locator(".side-compare").count() == 0 and pg.locator(".day-detail").count() == 1 and pg.locator("aside.sheet").count() == 0)
        # 1日を開いたときはいつも「まとめ」から（2026-11-24 渡辺さん）：見出し（天気・一言・出どころ）と、仲間ごとに1行。
        # 数字は上の表だけ（見出しに最高・最低なし、項目の札なし）。行を押すとその仲間の画面。
        settle(lambda: pg.locator(".dd-hero .dd-kind").count() == 1 and pg.locator(".dd-sum-row").count() == 6, 10)
        if shots: pg.locator(".day-detail").screenshot(path=f"{shots}-day-summary.png")
        check("SD1c 1日はまとめから：帯の先頭の「まとめ」が選ばれ、6行（気温・雨・風・空・光・大気・空気）、グラフは無い",
              pg.get_attribute(".day-detail", "data-group") == "summary" and pg.locator(".item-bar [data-item='summary'][aria-selected='true']").count() == 1
              and [t.strip() for t in pg.locator(".dd-sum-label").all_inner_texts()] == ["気温", "雨", "風", "空・光", "大気", "空気"] and pg.locator(".day-detail .hour-face").count() == 0,
              str(pg.locator(".dd-sum-label").all_inner_texts()))
        pg.locator(".dd-sum-line").first.click(); calm()
        settle(lambda: pg.locator(".dd-part").count() == 5)
        check("SD1b 気温の行を押すと気温の画面：数字は表だけ（見出し・項目の札なし）、グラフは1本", pg.get_attribute(".day-detail", "data-group") == "temp" and pg.locator(".dd-hero").count() == 0 and pg.locator(".dd-temps").count() == 0 and pg.locator(".dd-value").count() == 0 and pg.locator(".ts-curve").count() == 0 and pg.locator(".day-detail .hour-face").count() == 1)
        check("SD2 時間帯は5つ", pg.locator(".dd-part").count() == 5, pg.locator(".dd-part").count())
        pg.locator(".dd-part").nth(2).click(); calm()
        check("SD3 時間帯を押すと1時間ごと", pg.locator(".dd-hours tbody tr").count() >= 1, pg.locator(".dd-hours tbody tr").count())
        # 下は帯で選んだ仲間のものだけ（2026-11-24）。気温：グラフ・時間帯の気温・肌感の1行（押すと肌感マップ）。
        check("SD4 気温の仲間：時間帯の気温・肌感の1行、日の出の行は無い", pg.get_attribute(".day-detail", "data-group") == "temp" and "°" in txt(".dd-part") and pg.locator(".dd-feel-line").count() == 1 and pg.locator(".dd-sun").count() == 0)
        group = lambda first: pg.locator(f".item-bar .ib-cat[data-items^='{first}']").click() if pg.locator(f".item-bar .ib-cat[data-items^='{first}']").count() else None
        seen = {}
        for first, name in (("rain", "雨・風"), ("radiation", "空・光"), ("humidity", "大気")):
            group(first); calm()
            if shots: pg.locator(".day-detail").screenshot(path=f"{shots}-day-{first}.png")
            seen[name] = (pg.get_attribute(".day-detail", "data-group"), pg.locator(".dd-part").count(), "%" in (txt(".dd-parts") if pg.locator(".dd-parts").count() else ""),
                          pg.locator(".dd-sun").count(), pg.locator(".dd-feel-line").count(), pg.locator(".day-detail .hour-face").count())
        group("temp"); calm()
        check("SD4m 仲間ごと：雨・風は時間帯の降水確率、空・光は日の出の行、大気はグラフだけ（肌感は気温だけ）",
              seen["雨・風"][0] == "rainwind" and seen["雨・風"][1] == 5 and seen["雨・風"][2] and seen["雨・風"][4] == 0
              and seen["空・光"][0] == "sky" and seen["空・光"][3] == 1 and seen["空・光"][1] == 0
              and seen["大気"][0] == "air" and seen["大気"][1] == 0 and seen["大気"][3] == 0 and seen["大気"][5] == 1, str(seen))
        # 根拠と記録は項目ごと（2026-11-24）：気温は自分の記録だけ、予報の移り変わり・天気図・その日の要約はまとめに。
        # ふだん畳んである。押すと開く。
        pg.locator(".day-detail .dd-basis-sec > .fold > .fold-btn").click(); calm()
        temp_basis = (pg.locator(".day-detail .dd-basis .fh, .day-detail .wx-chart").count(), pg.locator(".day-detail .dd-basis").count())
        pg.locator(".day-detail .dd-basis-sec > .fold > .fold-btn").click(); calm()
        check("SD4o 気温の根拠と記録は自分の記録だけ（予報の移り変わり・天気図は無い）", temp_basis == (0, 1) and pg.locator(".day-detail .fh").count() == 0, str(temp_basis))
        pg.locator(".item-bar [data-items='summary']").click(); calm()
        fbb = pg.locator(".dd-basis-sec > .fold > .fold-btn")
        closed = fbb.count() == 1 and fbb.get_attribute("aria-expanded") == "false"
        fbb.click(); calm()
        check("SD4n 根拠と記録：ふだん畳まれていて、押すと開く", closed and fbb.get_attribute("aria-expanded") == "true")
        # この日の予報の変化（2026-11-24）：予報の移り変わりのいちばん上に、変化を新しい順に3つまで（無ければ「大きく変わっていません」）。
        settle(lambda: pg.locator(".fc-changes").count() == 1, 10)
        fc = pg.evaluate("""() => ({ rows: [...document.querySelectorAll('.fc-changes .fc-change')].map(e => e.innerText.replace(/\\s+/g, ' ')), none: !!document.querySelector('.fc-changes-none'), head: !!document.querySelector('.dd-change') })""")
        check("SD4p この日の予報の変化：3つまで（または「大きく変わっていません」）、まとめの見出しの下の1行は変化があるときだけ",
              (0 < len(fc["rows"]) <= 3 and not fc["none"] and fc["head"]) or (len(fc["rows"]) == 0 and fc["none"] and not fc["head"]), str(fc))
        if shots: pg.locator(".day-detail").screenshot(path=f"{shots}-day.png"); pg.locator(".day-detail .dd-sec").last.screenshot(path=f"{shots}-basis.png")
        lr = pg.locator(".day-detail .legend-row")
        if lr.count():
            tops = pg.evaluate("[...document.querySelectorAll('.day-detail .legend-row .legend-line, .day-detail .legend-row .avg-window, .day-detail .legend-row .info-btn')].map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))")
            check("SD4h 1日：凡例・平均・ⓘ が1列（真ん中の高さがそろう）", max(tops) - min(tops) <= 2, tops)
            if shots: lr.screenshot(path=f"{shots}-legend.png")
        # 天気図は予報の移り変わりと連動（2026-11-18）：「発表の時」は選んだ発表の直前の天気図と、その時の予想天気図。
        lead = txt(".wx-chart .wx-lead") if pg.locator(".wx-chart .wx-lead").count() else ""
        check("SD4b 天気図：「発表の時｜この日」、発表の時は選んだ発表の時刻の図（保存の無い予想天気図は無いと書く）", pg.locator(".wx-chart").count() == 1 and pg.locator(".wx-chart .seg button").count() == 2 and "の発表のときの空の形" in lead and (pg.locator(".wx-trio .wx-empty").count() == 2 or "予想天気図はありません" in txt(".wx-chart")), lead)
        pg.locator(".wx-chart .seg button", has_text="この日").click(); calm()
        check("SD4b2 「この日」：対象日の天気図（時刻を選べる）", pg.locator(".wx-hours button").count() == 7 or pg.locator(".wx-chart h4", has_text="予想天気図").count() == 1)
        # 天気図を押すとアプリの中のシートで大きく（閉じるがあり、閉じても読んでいた所のまま、2026-11-18）。
        pic = pg.locator(".wx-chart .wx-pic").first
        if pic.count():
            pic.scroll_into_view_if_needed(); calm()
            y0 = pg.evaluate("scrollY")
            pic.click(); calm()
            opened = pg.locator(".wx-viewer").count() == 1 and pg.locator(".wx-viewer button[aria-label='閉じる']").count() >= 1 and len(pg.context.pages) == 1
            pg.locator(".wx-viewer button[aria-label='閉じる']").first.click(); calm()
            y1 = pg.evaluate("scrollY")
            check("SD4i 天気図を押すとシートで大きく（×で閉じ、閉じても同じ所）", opened and pg.locator(".wx-viewer").count() == 0 and abs(y1 - y0) < 4, (opened, y0, y1))
        pg.locator(".wx-chart .seg button", has_text="発表の時").click(); calm()
        # 予報の移り変わり (R6): 選んだ発表と実績・グラフ・発表した日ごとの一覧。降水確率の欄を押すと 1マス⇄6時間ごと。
        settle(lambda: pg.locator(".fh-split").count() == 1)
        check("SD4d 予報の移り変わり：上の枠・グラフ・日ごとの一覧", pg.locator(".fh-split").count() == 1 and pg.locator(".fh-step > svg").count() == 1 and pg.locator(".fh-dgroup").count() >= 5, (pg.locator(".fh-split").count(), pg.locator(".fh-dgroup").count()))
        check("SD4d2 予報の移り変わり：いつ取れた分かを一覧の見出しに（「HH:MM に確認」、今日は開き直すと取り直す）", pg.locator(".fh-rows-head .fh-checked").count() == 1 and "に確認" in txt(".fh-rows-head .fh-checked"), txt(".fh-rows-head") if pg.locator(".fh-rows-head").count() else "")
        n0 = pg.locator(".fh-step .fh-step-cell").count()
        pg.locator(".fh-step > svg").scroll_into_view_if_needed(); calm()
        b = pg.locator(".fh-step .fh-step-cell").first.bounding_box()
        pg.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2); calm()
        n1 = pg.locator(".fh-step .fh-step-cell").count()
        check("SD4e 降水確率の欄を押すと6時間ごと（マスが増える）", n1 > n0, (n0, n1))
        pg.mouse.click(b["x"] + b["width"] / 2, b["y"] + 4); calm()
        wide = pg.evaluate("[...document.querySelectorAll('.fh, .fh *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className).slice(0, 3)")
        check("SD4f 予報の移り変わりが画面からはみ出さない", not wide, str(wide))
        fb = pg.locator(".fh-days .fold-btn")
        closed = fb.count() == 1 and fb.get_attribute("aria-expanded") == "false" and pg.locator(".fh-days .fold-body[inert]").count() == 1
        if fb.count():
            fb.click(); calm()
        opened = fb.count() == 1 and fb.get_attribute("aria-expanded") == "true" and pg.locator(".fh-days .fold-body").bounding_box()["height"] > 100
        check("SD4g 予報の一覧：前の日の発表は畳まれていて、押すと開く", closed and opened, (closed, opened))
        if fb.count():
            fb.click(); calm()
        # その発表の週間天気予報（11/19）：発表のある行を押すと、シートでその発表の先の日ぜんぶ。府県のときは週間で先を埋め、
        # どの発表かを添える。この日の行に印。閉じると元の位置。
        rows_ok = pg.locator(".fh-days .fh-drow:not(.gap)")
        fd = None
        for i in range(rows_ok.count()):
            if rows_ok.nth(i).is_visible() and "府県" in rows_ok.nth(i).inner_text(): fd = rows_ok.nth(i); break
        wk = None
        if fd:
            fd.scroll_into_view_if_needed()
            fd.click(); calm()
            settle(lambda: pg.locator(".fh-week-sheet .fh-wk-day").count() >= 3)
            # 行を選ぶと上の枠の中身が替わる（今まで通り）。シートを開いて閉じても、開いていた間の位置に戻ることを見る。
            y0 = pg.evaluate("document.querySelector('.day-detail-scroll, .page')?.scrollTop ?? scrollY")
            d0 = txt(".fh-week-sheet .fh-wk-detail")
            pg.locator(".fh-week-sheet .fh-wk-day").last.click(); calm(); d1 = txt(".fh-week-sheet .fh-wk-detail")
            wk = (pg.locator(".fh-week-sheet .fh-wk-day").count(), txt(".fh-week-sheet .msheet-head h2"), pg.locator(".fh-week-sheet .fh-wk-band").count(), pg.locator(".fh-week-sheet .fh-wk-day.target").count(), "この日" in d0 and d1 != d0)
            if os.environ.get("WN_SHOT"): pg.screenshot(path=f"{os.environ['WN_SHOT']}-issue-week.png")
            pg.locator(".fh-week-sheet .icon-btn.close").click(); calm()
            y1 = pg.evaluate("document.querySelector('.day-detail-scroll, .page')?.scrollTop ?? scrollY")
        check("SD4l 発表の行を押すと、その発表の週間天気予報を横の表で（府県＋週間の帯・この日に印・列を押すと下に詳しく）、閉じられる",
              wk is not None and wk[0] >= 7 and "時の府県天気予報" in wk[1] and wk[2] == 2 and wk[3] == 1 and wk[4] and pg.locator(".fh-week-sheet").count() == 0 and abs(y0 - y1) <= 2, (wk, fd is not None, y0, y1, pg.locator(".fh-week-sheet").count()))
        # 出どころのリンク（2026-11-19）：出典の ⓘ に、選んでいる発表の原文・実績（過去の気象データ）・今の予報。原文はシートで。
        src = pg.locator(".fh-sources")
        src.scroll_into_view_if_needed(); src.locator(".info-btn").click(); calm()
        links = src.locator("a")
        hrefs = [links.nth(i).get_attribute("href") for i in range(links.count())]
        has_etrn = any("etrn/view/hourly_s1.php?prec_no=74&block_no=47893" in (h or "") for h in hrefs)
        has_fc = any("area_code=390000" in (h or "") for h in hrefs)
        src.locator("button", has_text="原文を見る").click(); calm()
        settle(lambda: pg.locator(".telegram-sheet .tg-xml").count() == 1)
        xml_ok = "<Report>" in (pg.locator(".telegram-sheet .tg-xml").inner_text() or "")
        if os.environ.get("WN_SHOT"): pg.screenshot(path=f"{os.environ['WN_SHOT']}-telegram.png")
        pg.locator(".telegram-sheet .icon-btn.close").click(); calm()
        check("SD4k 出典の ⓘ：実績と今の予報のリンク（新しいタブ）、原文はシートで開いて閉じられる", has_etrn and has_fc and all(links.nth(i).get_attribute("target") == "_blank" for i in range(links.count())) and xml_ok and pg.locator(".telegram-sheet").count() == 0, (hrefs, xml_ok))
        if os.environ.get("WN_SHOT"):
            src.scroll_into_view_if_needed(); calm(); pg.locator(".fh").screenshot(path=f"{os.environ['WN_SHOT']}-fh-sources.png")
        src.locator(".info-btn").click(); calm()
        st = small_text(); check("SD4c 11px より小さい文字がない（1日モード・天気図）", not st, str(st))
        # 変化の行を押すと、その発表を選ぶ（上の枠がその発表に）。
        if fc["rows"]:
            ch = pg.locator(".fc-changes .fc-change").first
            when = ch.inner_text().split("の発表で")[0].split("〜")[-1].split("のあいだ")[0].strip()
            ch.scroll_into_view_if_needed(); ch.click(); calm()
            hour = re.search(r"(\d+)時", when)
            check("SD4q 変化の行を押すと、その発表が上の枠に", bool(hour) and f"{hour.group(1)}時" in txt(".fh-split"), (when, txt(".fh-split")[:60]))
        # 時点に印（2026-11-24）：「前日 14時」で、その時刻までのいちばん新しい発表（前日11時）に印、後の発表は薄く。「やめる」で戻る。
        pg.locator(".fh-point .chip", has_text="前日 14時").first.scroll_into_view_if_needed()
        pg.locator(".fh-point .chip", has_text="前日 14時").first.click(); calm()
        pt = pg.evaluate("""() => ({ say: (document.querySelector('.fh-point-say') || {}).textContent || '', point: [...document.querySelectorAll('.fh-drow.point .fh-drow-t b')].map(e => e.textContent),
          after: document.querySelectorAll('.fh-drow.after').length, split: (document.querySelector('.fh-split') || {}).textContent || '' })""")
        if shots:
            pg.evaluate("document.querySelector('.item-bar').style.visibility='hidden'")
            pg.locator(".fh-point").scroll_into_view_if_needed(); time.sleep(0.6); pg.screenshot(path=f"{shots}-point.png")
            pg.evaluate("document.querySelector('.item-bar').style.visibility=''")
        # ほかの発表を手で選ぶと時点の印は外れる（印と上の枠が食い違わないように）。
        pg.locator(".fh-days .fh-drow:not(.gap):not(.point)").last.scroll_into_view_if_needed()
        pg.locator(".fh-days .fh-drow:not(.gap):not(.point)").last.click(); calm()
        esc() if pg.locator(".fh-week-sheet").count() else None
        by_hand = pg.locator(".fh-drow.point, .fh-drow.after").count() == 0 and pg.locator(".fh-point-say").count() == 0
        # その時刻までの発表が無い時点：上の枠も出さず「確かめられません」
        pg.locator(".fh-point select").select_option(index=pg.locator(".fh-point select option").count() - 1); calm()
        empty = (pg.locator(".fh-split").count(), "確かめられません" in pg.locator(".fh").inner_text(), "発表がありません" in txt(".fh-point-say"))
        check("SD4s2 時点の印：ほかの発表を選ぶと外れる、その時刻までの発表が無ければ上の枠も出さない", by_hand and empty == (0, True, True), (by_hand, empty))
        pg.locator(".fh-point .chip", has_text="前日 14時").first.click(); calm()
        pg.locator(".fh-point .chip", has_text="やめる").click(); calm()
        check("SD4s 時点に印：前日14時までの最新は前日11時の発表（印1つ・後の発表は薄く・上の枠もその発表）、やめると印は消える",
              "前日 14時までの最新" in pt["say"] and "11時の発表" in pt["say"] and pt["point"] == ["11時"] and pt["after"] >= 1 and "11時" in pt["split"]
              and pg.locator(".fh-drow.point, .fh-drow.after").count() == 0, str(pt)[:200])
        # まとめの見出しの下の1行を押すと、その発表を選んで開く（2026-11-24）。
        if pg.locator(".dd-change").count():
            want = pg.locator(".fc-changes .fc-change").first.inner_text()
            pg.evaluate("window.scrollTo(0, 0)"); pg.locator(".dd-change").click(); calm()
            hour = re.search(r"(\d+)時の発表", pg.locator(".dd-change").inner_text())
            check("SD4t まとめの変化の1行を押すと、その発表が選ばれる（上の枠がその発表）", bool(hour) and f"{hour.group(1)}時" in txt(".fh-split"), (want[:40], txt(".fh-split")[:40]))
        rotate_ok("SD4r", "1日モード")
        # 仲間の中で項目を切り替えても、グラフの読み取りの枠は動かない（2026-11-18 渡辺さん「切り替えで画面がぶれるのが嫌い」）。
        ro_tops = []
        for first in ("rain", "humidity"):
            group(first); calm()
            items = pg.locator(".item-bar .ib-open .chip.item")
            tops = []
            for i in range(items.count()):
                items.nth(i).click(); calm()
                tops.append(pg.evaluate("Math.round(document.querySelector('.day-detail .hour-face .readout-card').getBoundingClientRect().top - document.querySelector('.day-detail').getBoundingClientRect().top)"))
            ro_tops.append(tops)
        group("temp"); calm()
        check("SD4j 仲間の中で項目を切り替えても、読み取りの枠の位置は変わらない", all(len(t) >= 2 and max(t) - min(t) <= 1 for t in ro_tops), ro_tops)
        # 開いて閉じたら、開く前の位置に戻る（2026-11-18 渡辺さん「戻るときは戻る前の位置が基本」）：1日モードの下の方から開く物。
        back = []
        pg.locator(".item-bar [data-items='summary']").click(); calm()
        for name, opener in (("その日の要約", lambda: pg.locator(".dd-links .chip", has_text="その日の要約").first), ("肌感マップ", lambda: pg.locator(".dd-feel-line").first)):
            if name == "肌感マップ": group("temp"); calm()
            el = opener()
            if not el.count(): continue
            el.scroll_into_view_if_needed(); calm()
            y0 = pg.evaluate("scrollY")
            el.click(); calm()
            pg.keyboard.press("Escape"); calm()
            back.append((name, y0, pg.evaluate("scrollY")))
        check("SD4k 1日モードから開いた物を閉じると、開く前の位置に戻る", back and all(abs(a - b) < 4 for _, a, b in back), back)
        group("rain"); calm()
        # 雨・風の根拠と記録：降水確率と風の予報の移り変わり（気象庁の値だけ、2026-11-24）。
        rw_btn = pg.locator(".day-detail .dd-basis-sec > .fold > .fold-btn")
        rw_closed = rw_btn.get_attribute("aria-expanded") == "false"  # ほかの仲間で開いていても、移ると畳んだところから
        rw_btn.click(); calm()
        settle(lambda: pg.locator(".rw .rw-row").count() >= 1 and rw_btn.get_attribute("aria-expanded") == "true", 10)
        rw = pg.evaluate("""() => ({ older: (() => { const b = document.querySelector('.rw .fold-body'); return b ? Math.round(b.getBoundingClientRect().height) : -1; })(), rows: document.querySelectorAll('.rw .rw-row').length, wind: [...document.querySelectorAll('.rw .rw-wind span')].map(e => e.textContent),
          chg: document.querySelectorAll('.rw .rw-wind.chg').length, pop: document.querySelectorAll('.rw .rw-pop').length, fh: document.querySelectorAll('.day-detail .fh').length })""")
        if shots:
            pg.evaluate("document.querySelector('.item-bar').style.visibility='hidden'")
            pg.locator(".rw").scroll_into_view_if_needed(); time.sleep(0.8)
            pg.screenshot(path=f"{shots}-rainwind-history.png")
            pg.evaluate("document.querySelector('.item-bar').style.visibility=''")
        check("SD5b 雨・風の根拠と記録：はじめは畳んである、開くと発表ごとの降水確率と風の文（変わった所に印）、前の発表は畳んだまま（外の畳みといっしょに開かない）、天気・気温の移り変わりは無い", rw_closed and rw["older"] in (-1, 0) and rw["rows"] >= 1 and rw["pop"] == rw["rows"] and len(rw["wind"]) >= 1 and rw["fh"] == 0, str(rw))
        pg.locator(".day-detail .dd-basis-sec > .fold > .fold-btn").click(); calm()
        check("SD5 帯で雨・風を押すと降水に（項目を選ぶのは帯だけ）", pg.locator('.metrics [aria-selected="true"]').inner_text().strip() == "降水")
        if shots: pg.screenshot(path=f"{shots}-single.png", full_page=True)
        # 暫定の説明 (2026-11-18)：昨日（暫定）にすると、出どころ・待っているもの・確定の見込みが出る。予報の今日には出ない。
        # 出どころは ⓘ で開く（2026-11-18）：予報の日は ⓘ だけ、開くと出どころ（信頼度の意味まで）。暫定の説明は出ない。
        pg.locator(".item-bar [data-items='summary']").click(); calm()
        closed0 = pg.locator(".dd-prov").count() == 0 and pg.locator(".dd-kind .info-btn").count() == 1
        pg.locator(".dd-kind .info-btn").click(); calm()
        src = pg.locator(".dd-prov").inner_text() if pg.locator(".dd-prov").count() else ""
        pg.locator(".dd-kind .info-btn").click(); calm()
        check("SD7a 予報の日：ⓘ で出どころが項目ごとに開き（気象庁のどの発表か・そのほか Open-Meteo）、暫定の説明は出ない、「根拠と記録」に出どころの行は無い", closed0 and "府県天気予報" in src and "Open-Meteo" in src and "最高・最低" in src and "暫定" not in src and pg.locator(".dd-basis", has_text="出どころ").count() == 0, src[:80])
        pg.locator("button[aria-label$='1日前へ']").first.click(); calm()
        settle(lambda: pg.locator(".dd-kind .info-btn").count() == 1, 5)
        check("SD7d 暫定の日：ふだんは「暫定 ⓘ」だけ（説明は閉じている）", pg.locator(".dd-kind .info-btn").count() == 1 and pg.locator(".dd-prov").count() == 0)
        pg.locator(".dd-kind .info-btn").click(); calm()
        settle(lambda: pg.locator(".dd-prov").count() == 1, 5)
        t = pg.locator(".dd-prov").inner_text() if pg.locator(".dd-prov").count() else ""
        check("SD7b 暫定の日：いまの値・待っているもの・確定の見込み（11/12 以降）", all(w in t for w in ("いまの値", "待っているもの", "確定の見込み", "11/12以降")), t[:160])
        layout_ok("SD7c", "暫定の説明")
        if shots: pg.locator(".dd-hero").screenshot(path=f"{shots}-prov-hero.png"); pg.locator(".dd-prov").screenshot(path=f"{shots}-prov.png")
        pg.locator("button[aria-label$='1日後へ']").first.click(); calm()
        # 表の日はタップでも選べる（2026-11-24 渡辺さん）：押した日が選ばれ、表がその日を真ん中へ滑らせる（指の操作として
        # 扱って、元の日へ戻さない）。
        strip = ".side-target .strip"
        center_date = lambda: pg.locator(f"{strip} .strip-col.is-center .cell-date").inner_text().split("\n")[0].strip()
        before = center_date()
        cols = pg.locator(f"{strip} .strip-col")
        idx = [i for i in range(cols.count()) if "is-center" in (cols.nth(i).get_attribute("class") or "")][0]
        want = cols.nth(idx + 1).locator(".cell-date").inner_text().split("\n")[0].strip()
        cols.nth(idx + 1).locator(".cell-kind").tap()
        off = lambda: pg.evaluate(f"""() => {{ const s = document.querySelector('{strip}').getBoundingClientRect();
          const c = document.querySelector('{strip} .strip-col.is-center').getBoundingClientRect();
          return Math.abs((c.left + c.width / 2) - (s.left + s.width / 2)); }}""")
        ok = settle(lambda: center_date() == want and off() < 2, 5)
        time.sleep(0.5)
        check("SD8 表の日をタップすると、その日が選ばれて真ん中へ（戻らない）", ok and center_date() == want and off() < 2 and want != before, (before, want, center_date(), off()))
        cols.nth(idx).locator(".cell-kind").tap()
        settle(lambda: center_date() == before and off() < 2, 5)
        # 空気（11/25「項目を分けませんか」→「いっそのこと統合」）：帯の「空気」は1つの項目（PM2.5・黄砂・視程）。大気は湿度・気圧。
        # まとめに「空気」の行（見通しの最小と、PM2.5・黄砂は CAMS と書く）。押すと空気の画面。実測（そらまめくん）はだれにでも。
        pg.locator('[data-items="summary"]:visible, [data-item="summary"]:visible').first.click(); calm()
        air_line = pg.locator(".dd-sum .dd-sum-row", has_text="空気").first
        settle(lambda: "PM2.5" in air_line.inner_text(), 5)
        air_only = pg.locator(".dd-sum .dd-sum-row", has_text="大気").first.inner_text()
        check("AQ1 まとめに「空気」の行（見通しの最小・PM2.5 の日平均・黄砂の最大とふだんより多い時、CAMS の予測）、大気の行は湿度・気圧だけ", "PM2.5 日平均" in air_line.inner_text() and "ふだんの目安 8、超えたのは 13時" in air_line.inner_text() and "環境基準は 35 以下" in air_line.inner_text() and "CAMS の予測" in air_line.inner_text() and "PM2.5" not in air_only and "見通し" not in air_only, (air_line.inner_text(), air_only))
        if os.environ.get("WN_AQSHOT"): (air_line.scroll_into_view_if_needed(), pg.evaluate("document.querySelector('.item-bar').style.visibility='hidden'"), air_line.screenshot(path=os.environ["WN_AQSHOT"] + "-summary.png"), pg.evaluate("document.querySelector('.item-bar').style.visibility=''"))
        air_line.locator("button").first.click(); calm()
        settle(lambda: pg.locator(".aq .aq-chart").count() > 0, 5)
        aq = pg.locator(".aq").first.inner_text() if pg.locator(".aq").count() else ""
        chips = pg.evaluate("[...document.querySelectorAll('.item-bar .ib-open [data-item]')].map(e => e.dataset.item)")
        check("AQ2 まとめの空気の行から「空気」の画面（ひとこと・値・PM2.5・黄砂・視程の3段）、帯の空気は1つの項目、実測はだれにでも", chips == ["visibility"] and pg.locator('[data-item="visibility"][aria-selected="true"]').count() == 1 and pg.locator(".aq .aq-chart path.aq-line").count() >= 3 and "実測 PM2.5" in aq and "管理者だけ" not in aq and pg.locator(".day-detail .hour-face").count() == 0, (chips, aq[:120]))
        # ひとこと（Weather Note の判定）：ふだんより多い時間だけ。説明と出典・基準は ⓘ に畳む（11/25「ⓘ で不要な情報は削る」）
        check("AQ3 ひとことは Weather Note の判定（1日の値で黄砂がふだんより多い日、多いのは 13時、CAMS）、黄砂の多い日は気象庁の黄砂解析予測図へ、出典と基準は畳んである", "黄砂がふだんより多い日（多いのは 13時）" in aq and pg.locator(".aq a.aq-kosa-link[href^='https://www.data.jma.go.jp/env/kosa/']").count() == 1 and "Weather Note の判定" in aq and "Open-Meteo" not in aq and "環境基準" not in aq, aq[:160])
        if os.environ.get("WN_AQSHOT"): pg.locator(".aq-top").first.screenshot(path=os.environ["WN_AQSHOT"] + "-verdict.png")
        check("AQ3b グラフの目安の点線は出どころごと（黄砂は「CAMS の目安 8」、PM2.5 は CAMS と介良局を別の線に）", pg.locator(".aq .aq-chart line.aq-usual").count() >= 3 and "CAMS の目安 8" in pg.locator(".aq .aq-chart").first.text_content() and "介良局の目安" in pg.locator(".aq .aq-chart").first.text_content(), pg.locator(".aq .aq-chart").first.text_content()[:160])
        if os.environ.get("WN_AQSHOT"): pg.locator(".aq-chartbox").first.screenshot(path=os.environ["WN_AQSHOT"] + "-chart.png")
        pg.locator(".aq-src .info-btn").first.click(); calm()
        aq = pg.locator(".aq").first.inner_text()
        # 取得の時刻は日付つき（モデルの計算の時刻ではない）、基準は「70 を超える」（11/25 レビュー）
        check("AQ2b ⓘ を開くと出典と基準：取得の時刻は「11/10 11:30 に取得」、注意喚起の目安は 70 を超えるとき、そらまめくん", "11/10 11:30 に取得" in aq and "70 µg/m³ を超える" in aq and "そらまめくん" in aq and "Open-Meteo" in aq, aq[-200:])
        pg.locator(".aq .aq-chart").first.click(position={"x": 200, "y": 40}); calm()
        check("AQ5 グラフを押すとその時刻の値（PM2.5・黄砂・実測・視程）", pg.locator(".aq-read-line b").count() == 1 and "視程" in pg.locator(".aq-read-line").inner_text() and pg.locator(".aq-chart .aq-sel").count() == 1, pg.locator(".aq-read-line").inner_text())
        # 全項目の内訳（ヒートマップ、11/25）：CAMS 4行・実測 5行 × 24マス、時刻を選ぶと下の表、比べられない項目は斜線
        pg.locator(".aq-more").first.click(); calm()
        settle(lambda: pg.locator(".ahm-sheet .ahm-row").count() > 0, 5)
        hrows = pg.evaluate("[...document.querySelectorAll('.ahm-sheet .ahm-row')].map(r => [r.dataset.key, r.children.length])")
        pg.locator(".ahm-sheet .ahm-cells").first.click(position={"x": 2, "y": 4}); calm()
        rd = pg.locator(".ahm-read").first.inner_text()
        hot = pg.locator(".ahm-sheet .ahm-row[data-key='pm2_5'] .ahm-c.l3, .ahm-sheet .ahm-row[data-key='pm2_5'] .ahm-c.l4").count()
        nu = pg.locator(".ahm-sheet .ahm-row[data-key='aod'] .ahm-c.nu").count()
        check("AQ6 内訳はヒートマップ（CAMS 4行・実測 5行 × 24時）、列を押すとその時刻の値、ふだんと比べた段、比べられない項目は斜線", [k for k, _ in hrows] == ["pm2_5", "pm10", "dust", "aod", "pm2_5", "ox", "spm", "no2", "so2"] and all(n == 24 for _, n in hrows) and rd.startswith("0時") and "実測 オキシダント" in rd and hot > 0 and nu == 24 and "Weather Note の集計" in pg.locator(".ahm-sheet").inner_text(), (hrows[:3], rd[:80], hot, nu))
        pg.locator(".ahm-sheet .icon-btn.close").first.click(); calm()
        pg.locator('.item-bar .ib-cat[data-items^="humidity"]').first.click(); calm()
        chips = pg.evaluate("[...document.querySelectorAll('.item-bar .ib-open [data-item]')].map(e => e.dataset.item)")
        check("AQ4 大気の仲間は湿度・気圧、開いても帯がはみ出さない", chips == ["humidity", "pressure"] and pg.evaluate("(() => { const b = document.querySelector('.item-bar'); return b.scrollWidth <= b.clientWidth + 1 })()"), chips)
        pg.locator(".metrics button", has_text="気温").click(); calm()
        pg.locator(".app-head .seg button", has_text="比較").click(); calm()
        check("SD6 比較に戻すと比較の表が戻る", pg.locator(".side-compare").count() == 1 and pg.locator(".day-detail").count() == 0)
        pg.evaluate("window.scrollTo(0, 0)")
    step("SD", sd)

    # RN. 雨の見込み（確認用）: 本物の形のこまとタイル（作ったもの）で、地図・グラフ・取れなかったこま・再生。
    def rn():
        shots = os.environ.get("WN_SHOT")
        # 雨の見込みは今日の 1日モードにある（2026-11-18）：札の言葉と「直近の雨雲レーダー」。過去の日には出ない。
        pg.locator(".app-head .seg button", has_text="1日").click(); calm()
        # 雨の見込みは雨・風の仲間に（2026-11-24）。気温の仲間には出ない。
        no_rain_in_temp = pg.locator(".rn-card").count() == 0  # 1日はまとめから（まとめは雨雲レーダーのボタンだけ）
        pg.locator(".item-bar .ib-cat[data-items^='rain']").click(); calm()
        check("RN0a 雨の見込みの札は雨・風の仲間だけ（まとめには出ない）", no_rain_in_temp)
        settle(lambda: pg.locator(".rn-card .rn-say-item").count() == 2 and "読み込み中" not in txt(".rn-card"), 15)
        check("RN0 今日の 1日モードに雨の見込み（1時間・15時間の2枚と「直近の雨雲レーダー」）", pg.locator(".rn-card .rn-say-item").count() == 2 and pg.locator(".rn-card button", has_text="直近の雨雲レーダー").count() == 1, txt(".rn-card")[:120])
        if shots: pg.screenshot(path=f"{shots}-rain-card.png", clip={**pg.locator(".day-detail").bounding_box(), "height": 520})
        pg.locator("button[aria-label$='1日前へ']").first.click(); calm()
        check("RN0b 昨日の 1日モードには雨の見込みが出ない", pg.locator(".rn-card").count() == 0)
        pg.locator("button[aria-label$='1日後へ']").first.click(); calm()
        settle(lambda: pg.locator(".rn-card button").count() == 1, 5)
        pg.locator(".rn-card button", has_text="直近の雨雲レーダー").click(); calm()
        settle(lambda: pg.locator(".rn-board .rn-map").count() == 1 and pg.locator(".rn-board .rn-loading").count() == 0, 15)
        check("RN1 雨の見込み：地図・つまみ・グラフが出る", pg.locator(".rn-board .rn-map canvas").count() == 1 and pg.locator(".rn-board .rn-scrub").count() == 1 and pg.locator(".rn-board .rn-graph").count() == 1)
        check("RN2 今のこま：「12:00」「今・実況」", "12:00" in txt(".rn-when") and "今・実況" in txt(".rn-when"), txt(".rn-when"))
        settle(lambda: "読み込み中" not in txt(".rn-say"), 20)
        check("RN3 この先の言葉が出る（読み込み中でない）", pg.locator(".rn-say-item").count() >= 2 and "読み込み中" not in txt(".rn-say"), txt(".rn-say"))
        if shots: pg.screenshot(path=f"{shots}-rain.png", full_page=True)
        # 取れなかったこま（11:30）：雨なしと見せない
        idx = [f["m"] for f in RAIN_NOW["frames"]].index(-30)
        pg.locator(".rn-scrub input").fill(str(idx)); calm()
        settle(lambda: pg.locator(".rn-miss").count() == 1, 8)
        check("RN4 取れなかったこま：「このこまは取れませんでした」と「取れなかった」", pg.locator(".rn-miss").count() == 1 and "取れなかった" in txt(".rn-when"), txt(".rn-when"))
        if shots: pg.screenshot(path=f"{shots}-rain-missing.png")
        # 1時間の量のこま：凡例の見出しが変わる
        idx = [f["m"] for f in RAIN_NOW["frames"]].index(150)
        pg.locator(".rn-scrub input").fill(str(idx)); calm()
        settle(lambda: pg.locator(".rn-loading").count() == 0, 8)
        check("RN5 1時間の量のこま：「1時間の量（mm）」と「1〜2時間後」…の幅", "1時間の量（mm）" in txt(".rn-legend-title") and "〜" in txt(".rn-when"), (txt(".rn-legend-title"), txt(".rn-when")))
        layout_ok("RN6", "雨の見込み")
        st = small_text(); check("RN7 11px より小さい文字がない（雨の見込み）", not st, str(st))
        check("RN8 画面からはみ出さない（雨の見込み）", no_overflow())
        pg.locator(".rn-diag summary").click(); calm()
        check("RN9 取れ方（確認用）：一覧3つとこまの数", pg.locator(".rn-diag tbody tr").count() == 3 and "こまのうち" in txt(".rn-diag-body"), txt(".rn-diag-body")[:200])
        if shots: pg.screenshot(path=f"{shots}-rain-hourly.png", full_page=True)
        esc()
        pg.locator(".item-bar .ib-cat[data-items^='temp']").click(); calm()
        pg.locator(".app-head .seg button", has_text="比較").click(); calm()
    step("RN", rn)

    # AC. 長期の気温履歴を比べる（テスト）: L1 and L2 through the new core, side by side (#189)
    def ac():
        pg.click(".app-head .icon-btn"); calm()
        open_board("長期の気温履歴を比べる")
        check("AC1 長期の気温履歴の比べ板が開く", pg.locator(".msheet.history-cmp").count() == 1)
        settle(lambda: "比べた日" in txt(".history-cmp-facts") and pg.locator(".history-cmp tbody tr").count() == 24, 8)
        t = txt(".history-cmp-facts")
        check("AC2 要約に比べた日数・境目の差・段が違った時間", "比べた日" in t and "境目の差の最大" in t and "段が違った時間" in t, t)
        check("AC3 選んだ日の24時間に、両方の段", pg.locator(".history-cmp tbody tr").count() == 24, str(pg.locator(".history-cmp tbody tr").count()))
        before = txt(".history-cmp .section-head:has-text('の時間ごと') .section-title")
        pg.locator(".history-cmp svg[aria-label*='境目の差']").first.scroll_into_view_if_needed(); calm()
        g = pg.locator(".history-cmp svg[aria-label*='境目の差']").first.bounding_box()
        pg.mouse.click(g["x"] + g["width"] * 0.3, g["y"] + g["height"] / 2); calm()
        after = txt(".history-cmp .section-head:has-text('の時間ごと') .section-title")
        check("AC4 境目の差のグラフをタップするとその日を選ぶ", before != after, f"{before} → {after}")
        # 横軸を共有する1つのグラフに2段（design-system 4.1）：選んだ日の線は1本で上下を通す
        gs = ".history-cmp svg[aria-label*='境目の差']"
        check("AC4b 気温と境目の差は1つのグラフ（2段）、選んだ日の線は1本", pg.locator(".history-cmp svg[aria-label*='L1']").count() == 1 and pg.locator(f"{gs} line[stroke='var(--ink-secondary)']").count() == 1)
        settle(lambda: pg.locator(".history-cmp tbody tr").count() == 24, 8)
        t2 = txt(".history-cmp-facts"); m2 = re.search(r"段が違った時間 (\d+)", t2)
        check("AC5 太字の行の数＝要約の「段が違った時間」", m2 and int(m2.group(1)) == pg.locator(".history-cmp tr.history-cmp-diff").count(), f"{t2} / {pg.locator('.history-cmp tr.history-cmp-diff').count()}")
        st = small_text(); check("AC6 11px より小さい文字がない（長期の気温履歴の比べ板）", not st, str(st))
        layout_ok("AC7", "長期の気温履歴の比べ板")
        if os.environ.get("WN_SHOT"): pg.locator(".history-cmp svg[aria-label*='境目の差']").screenshot(path=f"{os.environ['WN_SHOT']}-history-cmp.png")
        esc(); esc()
    step("AC", ac)

    # AS. 短期の履歴と答え（テスト）: one day's 肌感, S and rate from the new core (#189 S0)
    def as_():
        pg.click(".app-head .icon-btn"); calm()
        open_board("短期の履歴と答え")
        check("AS1 短期の履歴と答えが開く", pg.locator(".msheet.short-hist").count() == 1)
        settle(lambda: pg.locator(".short-hist svg[aria-label*='短期の履歴 S']").count() == 1, 8)
        # 横軸を共有する1つのグラフに2段（design-system 4.1）：時刻の目盛りは下に1組だけ
        g = ".short-hist svg[aria-label*='短期の履歴 S']"
        check("AS2 肌感と S、変化の速さが横軸を共有する1つのグラフ（2段、時刻の目盛りは1組）", pg.locator(g).count() == 1 and "変化の速さ" in pg.locator(g).get_attribute("aria-label") and pg.locator(f"{g} text", has_text="12時").count() == 1)
        paths = pg.locator(".short-hist svg[aria-label*='短期の履歴 S'] path").count()
        check("AS3 肌感と S の線が引かれる", paths == 2, str(paths))
        t = txt(".short-hist .history-cmp-facts")
        check("AS4 要約に答えの件数と、いつもと違う動き", "この日の答え" in t and "いつもと違う動き" in t, t)
        pg.locator(".short-hist .seg button", has_text="日なた").click(); calm()
        check("AS5 日なたに切り替えると凡例も日なた", "肌感（日なた）" in txt(".short-hist .sun-test-legend"))
        st = small_text(); check("AS6 11px より小さい文字がない（短期の履歴と答え）", not st, str(st))
        layout_ok("AS7", "短期の履歴と答え")
        if os.environ.get("WN_SHOT"): pg.locator(".short-hist svg[aria-label*='短期の履歴 S']").screenshot(path=f"{os.environ['WN_SHOT']}-short-hist.png")
        esc(); esc()
    step("AS", as_)

    # AL. 学習あり版を比べる（テスト）: one step ahead on the person's answers (#189, #117)
    def al():
        pg.click(".app-head .icon-btn"); calm()
        open_board("学習あり版を比べる")
        check("AL1 学習あり版を比べるが開く", pg.locator(".msheet.learned-cmp").count() == 1)
        t = txt(".learned-cmp .history-cmp-facts")
        check("AL2 要約に答えの件数", "答え" in t and "件" in t, t)
        b = pg.locator(".learned-cmp .btn.primary")
        check("AL3 答えがないうちは［比べる］を押せない", b.count() == 1 and b.is_disabled(), t)
        st = small_text(); check("AL4 11px より小さい文字がない（学習あり版を比べる）", not st, str(st))
        layout_ok("AL5", "学習あり版を比べる")
        buttons_ok("AL6", "学習あり版を比べる", 1)
        esc(); esc()
    step("AL", al)

    # R. 記録: the save button stays in view and names what is missing (#151 操作の体系)
    def rr():
        pg.click(".head-report"); calm()
        check("R1 記録が開く", pg.locator(".msheet.report-sheet").count() == 1)
        vis = lambda: pg.evaluate("(() => { const r = document.querySelector('.report-save').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()")
        check("R2 開いた時から［記録する］が見える（下に固定）", vis())
        t = txt(".report-save")
        check("R3 押せない間は足りないものを出す", "あと" in t and "感じ方" in t and "今の天気" in t, t)
        pg.locator(".msheet button", has_text="涼しい").first.click(); calm()
        t = txt(".report-save")
        check("R4 答えると足りないものが減る", "感じ方" not in t and "あと" in t, t)
        pg.locator(".msheet").last.evaluate("e => e.scrollTop = e.scrollHeight / 2"); calm()
        check("R5 途中までスクロールしても見える", vis())
        st = small_text(); check("R6 11px より小さい文字がない（記録）", not st, str(st))
        layout_ok("R7", "記録")
        buttons_ok("R8", "記録", 1)
        # 今の天気（#553）：研究で選んだものだけ出る。雨を選ぶと強さが 4 段出て、選ぶまで記録できない。
        # 空の写真（11/28 渡辺さん「厳密に」「画面にも出さない」）：空の写真の研究に同意していない人には出ない（ME は肌感と今の天気だけ）。
        check("R8b 同意していない研究（空の写真）は記録のシートに出ない", pg.locator(".msheet.report-sheet .seg button", has_text="空の写真").count() == 0 and pg.locator("#sp-add").count() == 0)
        pg.locator(".msheet.report-sheet .seg button", has_text="今の天気").first.click(); calm()
        check("R9 今の天気に切り替わる", pg.locator("#ws-now").count() == 1)
        pg.locator(".msheet.report-sheet .chip", has_text="雨").first.click(); calm()
        levels = pg.locator(".msheet.report-sheet [aria-label='雨の強さ'] .chip").all_inner_texts()
        check("R10 雨を選ぶと強さが 4 段", levels == ["ポツポツ", "パラパラ", "ザーザー", "ゴウゴウ"], str(levels))
        b = pg.locator(".msheet.report-sheet #ws-now ~ .btn.primary, .msheet.report-sheet section[aria-labelledby='ws-now'] .btn.primary").first
        check("R11 強さを選ぶまで記録できない", b.is_disabled() and "雨の強さ" in b.inner_text(), b.inner_text())
        pg.locator(".msheet.report-sheet .chip", has_text="ザーザー").first.click(); calm()
        check("R12 強さを選ぶと記録できる", not b.is_disabled())
        pg.locator(".msheet.report-sheet .chip", has_text="雪").first.click(); calm()
        snow = pg.locator(".msheet.report-sheet [aria-label='雪の強さ'] .chip").all_inner_texts()
        if os.environ.get("WN_WSHOT"): pg.locator(".msheet.report-sheet").last.screenshot(path=os.environ["WN_WSHOT"])
        check("R12b 雪を選ぶと雪の強さが 4 段（雨の強さは消え、選び直し）", snow == ["チラチラ", "ヒラヒラ", "シンシン", "ゴウゴウ"] and pg.locator(".msheet.report-sheet [aria-label='雨の強さ']").count() == 0 and b.is_disabled(), str(snow))
        check("R13 一覧に肌感の記録の天気も出る", "肌感の記録から" in txt("section[aria-labelledby='ws-list']"))
        st = small_text(); check("R14 11px より小さい文字がない（今の天気）", not st, str(st))
        layout_ok("R15", "今の天気")
        esc()
    step("R", rr)

    # K. feel map
    def k():
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); calm()
        head = pg.evaluate("document.querySelector('.side-target .date-button').innerText")
        md = txt(".band-map-date.center").split()[0]
        check("K0 中央の日のマップ", head.endswith("/" + md.split("/")[0] + "/" + md.split("/")[1]), f"マップ {md} / 表 {head}")
        check("K1 肌感マップが開く", pg.locator(".msheet.feel-sheet").count() == 1)
        st = small_text(); check("K1b 11px より小さい文字がない（肌感マップ）", not st, str(st))
        layout_ok("K1c", "肌感マップ")
        mh = pg.evaluate("document.querySelector('.msheet').getBoundingClientRect().height")
        sm = pg.evaluate("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-max'))")
        check("K2 グラフシート最大と同じ高さ", abs(mh - sm) <= 2, f"{mh:.0f} vs {sm:.0f}")
        seen = pg.evaluate("""(() => { const d = document.querySelector('.bm-drum').getBoundingClientRect();
          return [...document.querySelectorAll('.band-cell')].filter(c => { const r = c.getBoundingClientRect(); return r.left >= d.left + 30 && r.right <= d.right + 1; }).length; })()""")
        check("K3 1枚の比較マップ（見えるのは7日×5区分）", seen == 35, str(seen))
        check("K4 予報のマスに網かけ", pg.locator(".bm-a.forecast").count() >= 1)
        check("K5 凡例がマップの下", pg.evaluate("document.querySelector('.map-legend').getBoundingClientRect().top > document.querySelector('.band-map').getBoundingClientRect().bottom"))
        pg.locator(".band-cell.center").nth(2).click(); calm()
        check("K6 マスで両日の詳細", pg.locator(".band-detail table").count() == 2)
        st = small_text(); check("K6b 11px より小さい文字がない（肌感マップの詳細）", not st, str(st))
        pg.locator(".seg button", has_text="推移").click(); calm()
        bx = pg.locator("svg.scrub").bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] * 0.3, bx["y"] + 80); calm()
        check("K7 推移で補助線とタグ", pg.locator("svg.scrub .guide-tag").count() >= 1)
        pg.mouse.move(5, 5); calm()
        # 推移 is a drum too: a sideways drag moves the target day.
        before = txt(".band-trend .readout-card .ro-title")
        pg.locator(".band-trend .drum-pane svg").first.scroll_into_view_if_needed(); calm()
        bx = pg.locator(".band-trend .drum-pane svg").first.bounding_box(); y = bx["y"] + min(80, bx["height"] / 2); x = bx["x"] + bx["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        after = txt(".band-trend .readout-card .ro-title")
        check("K7b 推移も横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("K7c", "肌感の推移（動かした後）")
        check("K8 時間区分の線にデータ色を使わない", pg.evaluate("![...document.querySelectorAll('svg.scrub line[stroke]')].some(l => ['#86b8ff','#f5c865','#c9a6f7','#f39a86','#8fd8c4'].includes(l.getAttribute('stroke')))"))
        check("K9 横にはみ出さない", no_overflow())
        pg.click(".msheet .icon-btn.close"); calm()
        check("K10 ×で閉じる", pg.locator(".msheet").count() == 0)
        # K7b moved the target day; back to today so the later steps start where they expect.
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
    step("K", k)

    # L. 条件から選ぶ
    def l():
        before = txt(".side-compare .date-button")
        pg.locator(".side-compare select.mode").select_option("__conditions"); calm(4500)
        check("L1 条件から選ぶが開く", pg.locator(".msheet.cond-sheet").count() == 1)
        check("L2 条件は5行（最高・最低・雨・台風・期間）", pg.locator(".cond-line").count() == 5)
        check("L3 最初は最高が開いて範囲（つまみ2つ）", pg.locator(".cond-line.open[data-cond=max] .slider input").count() == 2)
        st = small_text(); check("L3b 11px より小さい文字がない（条件から選ぶ）", not st, str(st))
        layout_ok("L3b", "条件から選ぶ")
        pg.locator(".cond-line[data-cond=max] .seg button", has_text="以上").click(); calm()
        check("L4 以上はつまみ1つ", pg.locator(".cond-line[data-cond=max] .slider input").count() == 1, txt(".cond-line[data-cond=max] .cond-value"))
        check("L5 値は「以上」と読める", "以上" in txt(".cond-line[data-cond=max] .cond-value"))
        pg.locator(".cond-line[data-cond=max] .seg button", has_text="問わない").click(); calm()
        pg.locator(".cond-line[data-cond=min] .cond-head").click(); calm()
        pg.locator(".cond-line[data-cond=min] .seg button", has_text="問わない").click(); calm()
        check("L6 開くのは1行だけ", pg.locator(".cond-line.open").count() == 1)
        pg.locator(".cond-line[data-cond=rain] .cond-head").click(); calm()
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="降らない").click(); calm()
        pg.locator(".cond-line[data-cond=rain] .seg.multi button").nth(1).click(); calm()
        check("L7 雨は時間帯で", "降らない" in txt(".cond-line[data-cond=rain] .cond-value") and "昼" not in txt(".cond-line[data-cond=rain] .cond-value"), txt(".cond-line[data-cond=rain] .cond-value"))
        for _ in range(30):
            if pg.locator(".cond-col.day").count() and pg.locator(".cond-result .loading").count() == 0: break
            calm()
        n = pg.locator(".cond-col.day").count()
        check("L8 合う日の表", n >= 1, txt(".cond-count"))
        check("L8b 合う日は見出し（SectionHead）", pg.locator(".cond-result .section-head .cond-count").count() == 1)
        pg.locator(".cond-col.day").nth(0).click(); calm()
        after = txt(".side-compare .date-button")
        check("L9 選ぶと比較日が変わり、シートは開いたまま", after != before and pg.locator(".msheet").count() == 1, after)
        check("L10 取り消せる", pg.locator(".cond-toast button").count() == 1)
        pg.locator(".cond-toast button").click(); calm()
        check("L11 取り消すと元の比較日", txt(".side-compare .date-button") == before, txt(".side-compare .date-button"))
        # 雨の強さ・台風
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="降る").click(); calm()
        check("L12 降るで強さが選べる", pg.locator(".cond-line[data-cond=rain] .seg button", has_text="激しい").count() >= 1)
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="激しい").first.click(); calm()
        check("L13 値は「激しい雨」と読める", "激しい雨" in txt(".cond-line[data-cond=rain] .cond-value"), txt(".cond-line[data-cond=rain] .cond-value"))
        pg.locator(".cond-line[data-cond=rain] .seg button", has_text="問わない").first.click(); calm()
        pg.locator(".cond-line[data-cond=typhoon] .cond-head").click(); calm()
        pg.locator(".cond-line[data-cond=typhoon] .seg button", has_text="台風の日").first.click()
        for _ in range(30):
            if pg.locator(".cond-result .loading").count() == 0: break
            calm()
        check("L13b 台風の日を選ぶと最高・最低・雨は問わない、期間は通年", all("問わない" in txt(f".cond-line[data-cond={k}] .cond-value") for k in ("max", "min", "rain")) and "通年" in txt(".cond-line[data-cond=period] .cond-value"))
        check("L14 台風の日だけ：表に台風の号", pg.locator(".cond-col.day").count() >= 1 and "98号" in txt(".cond-table"), txt(".cond-count"))
        check("L15 台風の行に出典", "ベストトラック" in txt(".cond-line[data-cond=typhoon]"))
        layout_ok("L16", "条件から選ぶ 台風")
        pg.click(".msheet .icon-btn.close"); calm()
        pg.locator(".side-compare select.mode").select_option(index=0); calm()
    step("L", l)


    # M. summary minimise and 表に集中
    def m():
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pg.click(".cs-toggle"); calm()
        check("M1 要約を畳む", pg.locator(".compare-summary.collapsed").count() >= 1)
        pg.click(".cs-toggle"); calm()
        check("M2 要約を広げる", pg.locator(".compare-summary.compact").count() == 1)
        pg.click(".back-btn"); calm()
        pg.locator(".side .icon-btn").first.click(); calm()
        check("M3 表に集中", pg.evaluate("document.querySelector('.app').classList.contains('full')"))
        pg.locator(".side .icon-btn").first.click(); calm()
        check("M4 表示を戻す", not pg.evaluate("document.querySelector('.app').classList.contains('full')"))
    step("M", m)

    # N. long press guard: no text selection anywhere
    def n_():
        us = pg.evaluate("getComputedStyle(document.querySelector('.chart')).webkitUserSelect || getComputedStyle(document.querySelector('.chart')).userSelect")
        check("N1 グラフの文字は選択されない", us == "none", us)
    step("N", n_)

    # DS. その日の要約 (#176): a long press on a day's weather picture, from the table and the calendar.
    def ds():
        def hold(loc):
            loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
            pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()  # held on purpose: a long press
        pg.evaluate("window.scrollTo(0, 0)")
        # The day sheet lowered when it covers the table's pictures (raised again at the end).
        covered = pg.evaluate("""() => { const e = document.querySelector(".side-target .cell-icon[data-summary^='2026-11-08']"); const b = e.getBoundingClientRect();
          const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !(t && e.contains(t)); }""")
        if covered: pg.evaluate("__flick('.sheet-handle',700,120)"); calm()
        sheets = pg.locator(".msheet").count()
        hold(pg.locator(".side-target .cell-icon[data-summary^='2026-11-08']").first)
        check("DS1 表の天気の絵を長押しで要約が開く（タップの動きは起きない）", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".msheet").count() == sheets + 1, str(pg.locator(".msheet").count()))
        check("DS2 まとめ（浮いた面）に一言、読み取り（沈んだ面）に対象・比較・差", pg.locator(".day-summary-sheet .ds-lead .ds-comment span").count() >= 1 and pg.locator(".day-summary-sheet .readout-card .ro-label").count() == 8, txt(".day-summary-sheet .ds-comment") if pg.locator(".ds-comment").count() else "")
        check("DS2b 要約の年は「’25/」（半角の ' を使わない）", "'" not in txt(".day-summary-sheet"), txt(".day-summary-sheet .readout-card .ro-col")[:40] if pg.locator(".day-summary-sheet .ro-col").count() else "")
        check("DS3 強風の日は風の強さ（基準の目盛り）", pg.locator(".day-summary-sheet .ds-meter").count() == 2 and "強風" in txt(".day-summary-sheet .ro-title") and "強風" in txt(".day-summary-sheet .ds-comment"), txt(".day-summary-sheet .ro-title"))
        layout_ok("DS4", "要約")
        st = small_text(); check("DS5 11px より小さい文字がない（要約）", not st, str(st))
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        hold(pg.locator(".side-target .cell-icon[data-summary^='2026-11-09']").first)
        check("DS6 ふつうの日は風の強さを出さない", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".day-summary-sheet .ds-meter").count() == 0)
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        pg.locator(".side-target .date-button").click(); calm()
        hold(pg.locator(".calendar-grid [data-summary^='2026-11-05']").first)
        check("DS7 カレンダーからも長押しで要約（カレンダーの上に重なる）", pg.locator(".day-summary-sheet").count() == 1 and pg.locator(".msheet.calendar").count() == 1)
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        check("DS8 要約を閉じてもカレンダーはそのまま", pg.locator(".msheet.calendar").count() == 1 and pg.locator(".day-summary-sheet").count() == 0)
        # The table is not left held as moving by a release that landed on the sheet (Strip).
        check("DS9 長押しの後も表は動いていない扱いにならない", not pg.locator(".side-compare select.mode").is_disabled())
        pg.click(".msheet.calendar .icon-btn.close"); calm()
        if covered: pg.evaluate("__flick('.sheet-handle',-700,120)"); calm()
    step("DS", ds)

    # MR. 月の概要（もと月の振り返り）: opened from the line under the calendar; one place chooses; the pages follow.
    def mr():
        pg.locator(".side-target .date-button").click(); calm()
        pg.locator(".calendar-head .icon-btn").first.click(); calm()  # the month before: a whole month
        pg.locator(".cal-month-review", has_text="月の概要").click(); calm()
        check("MR1 カレンダーの下の1行で月の概要が開く（カレンダーは閉じる）", pg.locator(".month-review").count() == 1 and pg.locator(".msheet.calendar").count() == 0)
        check("MR2 ページは4つ（まとめ・日ごと・曜日・肌感）", pg.locator(".month-tabs button").count() == 4, txt(".month-tabs"))
        check("MR3b 台風の日：レポートに台風◯号と出典", "台風99号" in txt(".month-report") and "ベストトラック" in txt(".month-report"), txt(".month-report")[-200:])
        check("MR3 まとめに月の値とレポート（前年同曜日と比べる）", pg.locator(".month-review .readout-card").count() >= 1 and pg.locator(".month-report-part").count() >= 3 and "前年同曜日" in txt(".month-review"))
        pg.locator(".month-filter-days .chip").nth(6).click(); calm()  # 土
        check("MR4 曜日を選ぶと「選んだ N日」、レポートも選んだ日に", pg.locator(".month-picked").count() == 1 and "選んだ" in txt(".month-review .section-head") if pg.locator(".month-review .section-head").count() else False, txt(".month-picked") if pg.locator(".month-picked").count() else "")
        bx = pg.locator(".month-filter-days").bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2 + 60, steps=4); pg.mouse.up(); calm()
        check("MR5 曜日の並びを下に引くとカレンダー（曜日の並びは隠れる）", pg.locator(".month-filter .month-cal").count() == 1 and pg.locator(".month-filter-days").count() == 0)
        check("MR5b カレンダーに台風の印（暴風域は塗り）", pg.locator(".month-cal-ty").count() >= 1 and pg.locator(".month-cal-ty.violent").count() >= 1, str(pg.locator(".month-cal-ty").count()))
        pg.click(".month-fold"); calm()
        check("MR6 つまみでたたむ", pg.locator(".month-filter .month-cal").count() == 0 and pg.locator(".month-filter-days").count() == 1)
        layout_ok("MR7s", "月の概要 まとめ")
        for i, name in enumerate(["日ごと", "曜日", "肌感"]):
            pg.locator(".month-tabs button").nth(i + 1).click(); calm()
            layout_ok(f"MR7{i}", f"月の概要 {name}")
        st = small_text(); check("MR8 11px より小さい文字がない（月の概要）", not st, str(st))
        pg.click(".month-review .icon-btn.close"); calm()
        check("MR9 閉じると元の画面", pg.locator(".month-review").count() == 0)
    step("MR", mr)

    # YR. 年の概要（2026-11-22）：カレンダーの下の1行から。3つのページ、月を押すとその月の概要。
    def yr():
        pg.locator(".side-target .date-button").click(); calm()
        pg.locator(".cal-month-review", has_text="年の概要").first.click(); calm(6000)
        check("YR1 カレンダーの下の1行で年の概要が開く（カレンダーは閉じる）", pg.locator(".year-review").count() == 1 and pg.locator(".msheet.calendar").count() == 0)
        check("YR2 まとめ：3つの数字・年の値・目立った日", pg.locator(".year-review .month-tile").count() == 3 and pg.locator(".year-standouts li").count() >= 3)
        layout_ok("YR3", "年の概要 まとめ")
        for i, name in enumerate(["月ごと", "肌感"]):
            pg.locator(".year-review .month-tabs button").nth(i + 1).click(); calm()
            layout_ok(f"YR4{i}", f"年の概要 {name}")
        check("YR5 肌感：月ごとの帯", pg.locator(".year-review .month-feel-row").count() >= 10)
        pg.locator(".year-review .month-tabs button").nth(1).click(); calm()
        pg.locator(".year-month").nth(5).click(); calm()
        check("YR6 月を押すとその月の概要（年の概要の上に）", pg.locator(".month-review:not(.year-review)").count() == 1 and pg.locator(".year-review").count() == 1)
        pg.locator(".month-review:not(.year-review) .icon-btn.close").click(); calm()
        st = small_text(); check("YR7 11px より小さい文字がない（年の概要）", not st, str(st))
        pg.click(".year-review .icon-btn.close"); calm()
        check("YR8 閉じると元の画面", pg.locator(".year-review").count() == 0)
    step("YR", yr)

    # Q. calendar: presets and custom
    def q():
        pg.locator(".side-compare .date-button").click(); calm()
        check("Q1 比較日のカレンダーにプリセット", pg.locator(".cal-presets .chip").count() == 5)
        check("Q2 マスに天気と最高気温", pg.locator(".cal-day .cal-max").filter(has_text=re.compile(r"\d")).count() >= 20)
        pg.locator(".cal-presets .chip", has_text="前週").click(); calm()
        check("Q3 プリセットで組み合わせが前週に", "前週" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        st = small_text(); check("Q3b 11px より小さい文字がない（カレンダーの組み合わせ・プリセット）", not st, str(st))
        pg.click(".calendar-foot .primary"); calm()
        check("Q4 決定で前週になる", pg.locator(".side-compare select.mode").input_value() == "lastWeek" and txt(".side-compare .date-button") == "2026/11/3", txt(".side-compare .date-button"))
        pg.locator(".side-compare .date-button").click(); calm()
        pg.locator(".cal-day:not(:disabled)").nth(1).click(); calm()
        check("Q5 日を選ぶとカスタムと表示", "カスタム" in txt(".cal-pair-interval"), txt(".cal-pair-interval"))
        pg.click(".calendar-foot .primary"); calm()
        check("Q6 決定でカスタムになる", pg.locator(".side-compare select.mode").input_value() == "custom")
        pg.locator(".side-compare select.mode").select_option("sameDate"); calm()
    step("Q", q)

    # P. the four decisions (all B)
    def pp():
        check("P1 比較の表に差の行", pg.locator(".side-compare .label-diff").count() >= 2 and pg.locator(".side-compare .cell-diff").count() > 0)
        pg.locator(".side .icon-btn").first.click(); calm()
        wb = pg.locator(".side-target .strip-wrap").bounding_box()
        cols = pg.evaluate("[...document.querySelectorAll('.side-target .strip-col')].filter(c=>{const r=c.getBoundingClientRect();return r.left>=%f-1&&r.right<=%f+1}).length" % (wb["x"], wb["x"] + wb["width"]))
        check("P2 表に集中で9日", cols == 9, str(cols))
        check("P2b 横にはみ出さない", no_overflow())
        layout_ok("P2c", "表に集中")
        pg.locator(".side .icon-btn").first.click(); calm()
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()
        pg.locator(".chart-hit").nth(7).click(force=True); calm()
        pg.evaluate("document.querySelector('.sheet-body').scrollTo(0,260)"); calm()
        dock = pg.locator(".sheet-dock .compare-summary.pinned").count()
        top = pg.evaluate("document.querySelector('.sheet-body').getBoundingClientRect().top")
        dbot = pg.evaluate("document.querySelector('.sheet-dock').getBoundingClientRect().bottom")
        check("P3 固定の1行は見出しの下（重ならない）", dock == 1 and top >= dbot - 1, f"dock {dock} body {top:.0f} dock下 {dbot:.0f}")
        # The pinned line (minimized) moves days with a sideways swipe too.
        dd = lambda: txt(".sheet-dock .cs-line-date")
        before = dd()
        db = pg.locator(".sheet-dock .compare-summary.pinned").bounding_box(); y = db["y"] + db["height"] / 2; x = db["x"] + db["width"] * 0.7
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        check("P3c 固定の1行も横スワイプで日が動く", pg.locator(".sheet-dock .compare-summary.pinned").count() == 1 and dd() != before, f"{before}→{dd()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); calm()
        pg.locator(".sheet-dock .compare-summary.pinned").click(); calm()
        check("P3b 1行をタップで要約に戻る", pg.locator(".sheet-dock .compare-summary").count() == 0)
        # Folded (畳む) after being open: the folded line still moves days.
        pg.locator(".cs-toggle").first.click(); calm()
        ld = lambda: txt(".compare-summary.collapsed .cs-line-date")
        before = ld()
        lb = pg.locator(".compare-summary.collapsed").first.bounding_box(); y = lb["y"] + lb["height"] / 2; x = lb["x"] + lb["width"] * 0.7
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        check("P3d 畳んだ要約も横スワイプで日が動く", ld() != before, f"{before}→{ld()}")
        touch("touchStart", x - 144, y)
        for k in range(1, 9):
            touch("touchMove", x - 144 + k * 18, y); wait(16)
        touch("touchEnd", x, y); calm()
        pg.locator(".cs-toggle").first.click(); calm()
        pg.click(".back-btn"); calm()
        pg.evaluate("__flick('.sheet-handle',600,120)"); calm()
        pg.locator(".side-target .strip-col.is-center .cell-feel.tappable-feel").first.click(); calm()
        c = lambda: txt(".band-map-date.center").split()[0]
        before = c()
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        check("P4a 肌感マップの見出しにマップ／推移の切り替え", pg.locator(".band-face .section-head .seg").count() == 1)
        check("P4 肌感マップを横スワイプで日が進む（ドラム）", c() != before and pg.locator(".msheet").count() == 1, f"{before}→{c()}")
        # During a drag the days follow the finger (the drum), and a pressed cell stays in place.
        bb = pg.locator(".band-map").bounding_box(); y = bb["y"] + 120; x = bb["x"] + bb["width"] * 0.75
        x0 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        touch("touchStart", x, y)
        for k in range(1, 4):
            touch("touchMove", x - k * 10, y); wait(16)
        x1 = pg.evaluate("document.querySelector('.band-cell.center').getBoundingClientRect().left")
        f0 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        touch("touchEnd", x - 30, y); calm()
        check("P4b 指を動かしている間、マスが指についてくる", x1 < x0 - 15, f"{x0:.0f}→{x1:.0f}")
        f1 = pg.evaluate("document.querySelector('.bm-center-frame').getBoundingClientRect().left")
        check("P4c 中心の枠は動かない（マスだけが下を通る）", abs(f1 - f0) < 1 and abs(f0 - x0) < 4, f"frame {f0:.0f}→{f1:.0f}, cell {x0:.0f}")
        esc()
    step("P", pp)

    # T. 日照 › 移り変わり (時刻で・明るさで, 1週間〜1年)
    def tt():
        pg.click(".today-chip") if pg.locator(".today-chip").count() else None; calm()
        pick_item(3); calm()
        check("T1 日照の日別に［移り変わり］", pg.locator(".trend-btn").count() == 1, title())
        pg.click(".trend-btn"); calm()
        check("T2 見出し", title() == "明るさの移り変わり", title())
        check("T3 時刻で：見出しが分で言う", "分" in txt(".lt-head-main"), txt(".lt-head-main"))
        check("T4 時刻で：グラフ", pg.locator(".light-trend svg.lt-chart").count() == 1)
        st = small_text(); check("T4b 11px より小さい文字がない（日照と明るさの推移）", not st, str(st))
        before = txt(".light-trend .readout-card .ro-title")
        pg.evaluate("__flick('.sheet-handle',-600,120)"); calm()  # P left the sheet low; the graph must be on screen
        pg.locator(".light-trend .drum-pane svg").first.scroll_into_view_if_needed(); calm()
        bx = pg.locator(".light-trend .drum-pane svg").first.bounding_box(); y = bx["y"] + min(80, bx["height"] / 2); x = bx["x"] + bx["width"] * 0.75
        touch("touchStart", x, y)
        for k in range(1, 9):
            touch("touchMove", x - k * 18, y); wait(16)
        touch("touchEnd", x - 144, y); calm()
        after = txt(".light-trend .readout-card .ro-title")
        check("T4c 1週間は横に動かすと日が進む（ドラム）", after != before, f"{before}→{after}")
        layout_ok("T4b", "明るさの移り変わり")
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); calm()
            check(f"T5 時刻で {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
        pg.locator(".lt-controls button", has_text="明るさで").click(); calm()
        check("T6 明るさで：読み取りに長さ", "長さ" in txt(".light-trend .readout-card"), txt(".light-trend .readout-card"))
        # Days run across here too (#151): the dates sit under the plot in a row, left to right.
        xs = pg.evaluate("[...document.querySelectorAll('.light-trend .lt-dates .lt-date:not(.sub)')].map(e => e.getBoundingClientRect()).filter(r => r.left >= 30 && r.right <= innerWidth).map(r => [Math.round(r.left), Math.round(r.top)])")
        check("T6b 明るさで：日は横に並ぶ", len(xs) == 7 and len({y for _, y in xs}) == 1 and [x for x, _ in xs] == sorted(x for x, _ in xs), str(xs))
        for span in ["1か月", "1年", "1週間"]:
            pg.locator(".lt-controls button", has_text=span).click(); calm()
            check(f"T7 明るさで {span}", pg.locator(".light-trend svg.lt-chart").count() == 1 and no_overflow())
            layout_ok(f"T7b", f"明るさで {span}")
        pg.locator(".lt-controls button", has_text="時刻で").click(); calm()
        pg.click(".back-btn"); calm()
        check("T8 ‹日別で戻る", title() == "日照の日別", title())
        pick_item(2); calm()
        check("T9 日差しには［移り変わり］がない", pg.locator(".trend-btn").count() == 0)
        pick_item(0); calm()
    step("T", tt)

    # GR. 数字の格子 (#151): decimal points in one line down the table's centre column and down each
    # side of the comparison summary; the units once after the names there.
    def gr():
        esc() if pg.locator(".msheet").count() else None
        pg.evaluate("window.scrollTo(0, 0)")
        # The day's hours: its sheet opens with the comparison summary at the top.
        pg.locator(".side-target .strip-col.is-center .cell-stack").first.dispatch_event("click"); calm()  # under the sheet, perhaps
        if os.environ.get("WN_SHOT"):
            settle(lambda: pg.locator(".compare-summary").count() == 1, 10)
            for first in ("temp", "rain", "radiation", "humidity"):
                if pg.locator(f".item-bar .ib-cat[data-items^='{first}']").count(): pg.locator(f".item-bar .ib-cat[data-items^='{first}']").click(); calm()
                pg.screenshot(path=f"{os.environ['WN_SHOT']}-hours-{first}.png", full_page=True)
            pg.locator(".item-bar .ib-cat[data-items^='temp']").click(); calm()
        # 並べるのは帯で選んだ仲間の項目だけ、ほかは「ほかの項目も見る」（2026-11-24 渡辺さん、1日画面と同じ考え方）。
        settle(lambda: pg.locator(".compare-summary.compact").count() == 1, 10)
        labels = lambda: pg.evaluate("[...document.querySelectorAll('.compare-summary.compact .cs-label')].map(e => e.firstChild.textContent.trim())")
        by = {}
        for first in ("temp", "radiation", "rain", "humidity", "visibility"):
            cat = pg.locator(f".item-bar .ib-cat[data-items^='{first}']")
            if cat.count(): cat.click(); calm()
            by[first] = (labels(), pg.locator(".compare-summary .cs-beta").count())
        pg.locator(".item-bar .ib-cat[data-items^='temp']").click(); calm()
        check("GR7 比較のまとめ：選んだ仲間の項目だけ（気温：最高・最低・平均、空・光：日射・日照・日の出、雨・風：降水・風速・主な風向、大気：湿度・気圧、空気：PM2.5・黄砂・実測・視程最小）、肌感 β は気温だけ",
              by["temp"][0] == ["最高", "最低", "平均"] and by["radiation"][0] == ["日射", "日照", "日の出"] and by["rain"][0] == ["降水", "風速", "主な風向"]
              and by["humidity"][0] == ["湿度", "気圧最高", "気圧最低"] and by["visibility"][0] == ["PM2.5 平均", "黄砂 最大", "実測 PM2.5", "視程最小"] and by["radiation"][1] == 0 and by["rain"][1] == 0 and by["humidity"][1] == 0, str(by))
        pg.locator(".compare-summary .cs-more").click(); calm()
        check("GR8 「ほかの項目も見る」で全部の項目（気温の仲間のあとに、ほかの仲間）", len(labels()) == 16 and labels()[:3] == ["最高", "最低", "平均"], str(labels()))
        r = pg.evaluate("""() => {
          const right = (e) => Math.round(e.getBoundingClientRect().right);
          const col = [...document.querySelectorAll('.side-target .strip-col.is-center .cell-value')].filter(e => /\\d/.test(e.textContent)).map(right);
          const cs = document.querySelector('.compare-summary');
          const a = cs ? [...cs.querySelectorAll('.cs-val.cs-a .cs-num')].map(right) : [];
          const b = cs ? [...cs.querySelectorAll('.cs-val.cs-b .cs-num')].map(right) : [];
          const units = cs ? cs.querySelectorAll('.cs-val .unit').length : -1;
          const straight = (document.body.innerText.match(/'\\d\\d\\//g) || []).length;
          const sun = cs ? [...cs.querySelectorAll('.cs-sun .cs-val')].map(e => e.getClientRects().length === 1 && e.scrollWidth <= e.clientWidth + 1 && Math.round(e.getBoundingClientRect().height) < 26) : [];
          return { col, a, b, units, sun, straight };
        }""")
        # 同じ日の同じ値は、どこに出しても同じ数字（2026-11-24 渡辺さん「揃えてください」「テストで仕様として固める」）。
        same = pg.evaluate("""() => {
          const t = (root, sel) => ((root && root.querySelector(sel)) || {}).textContent?.trim() ?? null;
          const col = document.querySelector('.side-target .strip-col.is-center');
          const rows = [...document.querySelectorAll('.compare-summary .cs-row:not(.cs-sun)')];
          return { table: [t(col, '.cell-value.tone-hot'), t(col, '.cell-value.tone-cold')], cs: rows.slice(0, 2).map(r => t(r, '.cs-a .cs-num')) };
        }""")
        if same["cs"] and all(same["cs"]):
            check("GR6 比較のまとめの最高・最低は、表の同じ日と同じ数字（気象庁の値は整数のまま）", same["cs"] == same["table"], str(same))
        check("GR1 表の列で小数点が縦にそろう（右そろえ）", len(r["col"]) >= 3 and max(r["col"]) - min(r["col"]) <= 1, str(r["col"]))
        if r["a"]:
            check("GR2 比較の要約の両側で小数点が縦にそろう", max(r["a"]) - min(r["a"]) <= 1 and max(r["b"]) - min(r["b"]) <= 1, f'{r["a"]} {r["b"]}')
            check("GR3 比較の要約の単位は名前の後ろ（数字に付けない）", r["units"] == 0, str(r["units"]))
            check("GR4 日の出・日の入りの時刻は1行（折り返さない）", r["sun"] and all(r["sun"]), str(r["sun"]))
            check("GR5 短い年は「’25/」（半角の ' を使わない）", r["straight"] == 0, str(r["straight"]))
        else:
            check("GR2 比較の要約が開いている", False, "no .compare-summary")
        pg.click(".back-btn"); calm()
    step("GR", gr)

    # TD. 対象日は比較のしかたから独立（2026-11-24 渡辺さん「対象日が意図せず動く」）：予報の最後の日を選んで「翌週」に
    # しても対象日はそのまま、比較側に理由。1日 → 比較に戻っても動かない。前日に戻すと比較日が出る。
    def td():
        esc() if pg.locator(".msheet").count() else None
        pg.evaluate("window.scrollTo(0, 0)")
        fwd = pg.locator(".side-target button[aria-label$='1日後へ']").first
        for _ in range(30):
            if fwd.is_disabled(): break
            fwd.click(); calm()
        last = pg.locator(".side-target .date-button").first.get_attribute("aria-label")
        pg.locator("select.chip.mode").first.select_option("nextWeek"); calm()
        after_mode = pg.locator(".side-target .date-button").first.get_attribute("aria-label")
        gap = txt(".compare-gap") if pg.locator(".compare-gap").count() else ""
        pg.locator(".app-head .seg button", has_text="1日").click(); calm()
        pg.locator(".app-head .seg button", has_text="比較").click(); calm()
        after_single = pg.locator(".side-target .date-button").first.get_attribute("aria-label")
        check("TD1 予報の最後の日で「翌週」にしても対象日はそのまま、比較側に「翌週の予報がまだありません」（1日から戻っても同じ）",
              fwd.is_disabled() and last == after_mode == after_single and gap == "翌週の予報がまだありません", (last, after_mode, after_single, gap))
        pg.locator("select.chip.mode").first.select_option("yesterday"); calm()
        check("TD2 前日に戻すと理由は消え、対象日はそのまま", pg.locator(".compare-gap").count() == 0 and pg.locator(".side-target .date-button").first.get_attribute("aria-label") == last)
        pg.locator("select.chip.mode").first.select_option("sameDate"); calm()
        if pg.locator(".side-target .today-chip").count(): pg.locator(".side-target .today-chip").first.click(); calm()
    step("TD", td)

    # TY. 近づいている台風: a card at the top while a typhoon concerns the station; from it, the past typhoon days.
    def ty():
        check("TY0 台風がないときカードは出ない", pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["on"] = True
        reload()
        check("TY1 台風のカード：号・気圧・強風域", pg.locator(".typhoon-card").count() == 1 and "台風14号" in txt(".typhoon-card") and "960" in txt(".typhoon-card") and "強風域に入っています" in txt(".typhoon-card"), txt(".typhoon-card") if pg.locator(".typhoon-card").count() else "")
        check("TY2 出典と気象庁へのリンク", "気象庁" in txt(".typhoon-source") and pg.locator(".typhoon-link[target=_blank]").count() == 1)
        layout_ok("TY3", "台風のカード")
        check("TY3b 表の今日に台（強風域）、明日に破線の台（暴風警戒域）", pg.locator(".side-target .typhoon-tag.gale").count() >= 1 and pg.locator(".side-target .typhoon-tag.warning").count() >= 1, str(pg.locator(".side-target .typhoon-tag").count()))
        # その日の要約 on a typhoon day: 台 by the picture, the typhoon first in the words, and the way in.
        loc = pg.locator(".side-target .cell-icon[data-summary^='2026-11-10']").first
        loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()
        check("TY8 要約：絵の横に台、一言の最初に台風14号", pg.locator(".day-summary-sheet .ds-head .typhoon-tag").count() == 1 and txt(".day-summary-sheet .ds-comment").startswith("台風14号"), txt(".day-summary-sheet .ds-comment") if pg.locator(".ds-comment").count() else "")
        pg.click(".day-summary-sheet .ds-typhoon"); calm(1500)
        check("TY9 台風の詳細が開く：地図（海岸線）と見るもの3つ", pg.locator(".typhoon-sheet").count() == 1 and pg.evaluate("(document.querySelector('.ty-land')?.getAttribute('d') || '').length") > 1000 and pg.locator(".typhoon-sheet .seg button").count() == 3)
        pg.locator(".typhoon-sheet .seg button").nth(2).click(); calm()
        check("TY10 「今」：気象庁の今の発表を重ねる（強風域の円）", pg.locator(".typhoon-sheet .ty-gale").count() >= 1 and "960" in txt(".ty-say"), txt(".ty-say"))
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-now.png")
        pg.locator(".typhoon-sheet .seg button").nth(0).click(); calm()
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-real.png")
        layout_ok("TY11", "台風の詳細")
        st = small_text(); check("TY12 11px より小さい文字がない（台風の詳細）", not st, str(st))
        pg.click(".typhoon-sheet .icon-btn.close"); calm()
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        # A past typhoon day (the made-up 99号 crossing on 10/20) from the calendar: the track and its areas.
        pg.locator(".side-target .date-button").click(); calm()
        pg.locator(".calendar-head .icon-btn").first.click(); calm()
        check("TY13 カレンダーの日にも台", pg.locator(".calendar-grid .typhoon-tag").count() >= 1, str(pg.locator(".calendar-grid .typhoon-tag").count()))
        loc = pg.locator(".calendar-grid [data-summary^='2026-10-20']").first
        loc.scroll_into_view_if_needed(); bx = loc.bounding_box()
        pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2); pg.mouse.down(); wait(700); pg.mouse.up(); calm()
        pg.click(".day-summary-sheet .ds-typhoon"); calm(1500)
        check("TY14 過去の台風：進路と、高知が入った域（暴風域）", pg.locator(".typhoon-sheet .ty-track").count() == 1 and "暴風域" in txt(".typhoon-sheet .ty-row.real"), txt(".typhoon-sheet .ty-row.real") if pg.locator(".ty-row.real").count() else "")
        if os.environ.get("WN_SHOT"): pg.locator(".typhoon-sheet").screenshot(path=os.environ["WN_SHOT"] + "-past.png")
        pg.click(".typhoon-sheet .icon-btn.close"); calm()
        pg.click(".day-summary-sheet .icon-btn.close"); calm()
        pg.click(".msheet.calendar .icon-btn.close"); calm()
        pg.get_by_text("前の台風の日と比べる").click(); calm(4500)
        check("TY4 条件から選ぶが台風の日で開く（気温・雨は問わない、通年）", pg.locator(".msheet.cond-sheet").count() == 1 and "台風の日" in txt(".cond-line[data-cond=typhoon] .cond-value") and "問わない" in txt(".cond-line[data-cond=max] .cond-value") and "通年" in txt(".cond-line[data-cond=period] .cond-value"))
        pg.click(".msheet .icon-btn.close"); calm()
        TYPHOON_ON["on"] = False
        TYPHOON_ON["fail"] = True
        reload()
        check("TY5 取得に失敗したら「取得できませんでした」（台風なしと区別）", pg.locator(".typhoon-failed").count() == 1 and pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["fail"] = False
        reload()
        check("TY6 取れて台風なしなら何も出ない", pg.locator(".typhoon-failed").count() == 0 and pg.locator(".typhoon-card").count() == 0)
        TYPHOON_ON["old"] = True
        reload()
        check("TY7 古い情報で台風なしでも「更新できていません」（カードの有無と別）", pg.locator(".typhoon-failed").count() == 1 and "更新できていません" in txt(".typhoon-failed"))
        TYPHOON_ON["old"] = False
        reload()
    step("TY", ty)

    def rot():
        # 比較の表で横向きにして縦に戻す（11/19）。あとの確かめに響かないよう最後に。
        rotate_ok("RO1", "比較の表")
    step("RO", rot)

    if os.environ.get("WN_SEEN"):
        with open(os.environ["WN_SEEN"], "w") as f: f.write("\n".join(sorted(SMALL_SEEN)))

    # The 500s step FS asks for on purpose are not errors of the app.
    errors = [e for e in errors if not (FAILED_ON_PURPOSE and "status of 500" in e)]
    # So are the tiles RN answers 404 (取れなかったこま).
    errors = [e for e in errors if not (TILES_404 and "status of 404" in e)]
    check("Z コンソールのエラーなし", not errors, "; ".join(errors[:5]))
    b.close()
srv.shutdown()
ok = sum(r[0] for r in results)
print(f"WIDTH {W}{f' part {PART}' if PART else ''}: {ok}/{len(results)} passed")
# Where the time goes (#CI): the slowest steps, so a slow run can be read from its log.
print("STEPS " + " ".join(f"{n}={t:.1f}s" for n, t in sorted(TIMES, key=lambda x: -x[1])[:12]) + f" (all {sum(t for _, t in TIMES):.0f}s)")
for r in results:
    if not r[0] or os.environ.get("WN_ALL"): print("  NG" if not r[0] else "  ok", r[1], r[2][:80])
sys.exit(0 if ok == len(results) else 1)
