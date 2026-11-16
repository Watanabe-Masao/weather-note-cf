import { describe, expect, it } from "vitest";
import type { XmlCircle, XmlTelegram, XmlTime } from "../shared/typhoonXml";
import { ensureSchema } from "../worker/src/accounts";
import { ensureTyphoonSchema } from "../worker/src/typhoonArchive";
import { checkTyphoonSettings, inHours, runTyphoonNotify, typhoonMessage } from "../worker/src/typhoonNotify";
import type { Subscription } from "../worker/src/webpush";
import { d1 } from "./d1";

// 高知 (47893): 33°33.8′N 133°33.1′E.
const KOCHI = { lat: 33.563, lon: 133.552 };
const circle = (lat: number, lon: number, km: number): XmlCircle => ({ lat, lon, radius: { long: km, short: km, dir: null } });
const time = (validAt: string, hours: number, x: Partial<XmlTime>): XmlTime => ({
  part: hours ? "予報" : "実況",
  validAt,
  hours,
  typhoonClass: null,
  lat: null,
  lon: null,
  location: null,
  pressure: null,
  windKt: null,
  gustKt: null,
  storm: null,
  gale: null,
  warning: null,
  probability: null,
  ...x,
});
/** A 32号 announcement: now far to the south (or over 高知 with `galeHere`), and, with `warnHere`, a 暴風警戒域 over 高知 a day ahead. */
function telegram(issuedAt: string, { warnHere = false, galeHere = false } = {}): XmlTelegram {
  const t0 = Date.parse(issuedAt);
  const iso = (h: number) => new Date(t0 + h * 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 19) + "+09:00";
  return {
    kind: "VPTW60",
    issuedAt,
    targetAt: issuedAt,
    infoType: "発表",
    number: "2632",
    name: "CEMPAKA",
    nameKana: "チェンパカ",
    remark: null,
    problems: [],
    times: [
      time(iso(0), 0, galeHere ? { lat: 33, lon: 133.5, gale: circle(33, 133.5, 300), storm: circle(33, 133.5, 100) } : { lat: 25, lon: 131, gale: circle(25, 131, 300) }),
      time(iso(24), 24, { lat: 30, lon: 133, warning: warnHere ? circle(KOCHI.lat, KOCHI.lon, 150) : circle(28, 131, 150) }),
    ],
  };
}

async function setup() {
  const db = d1();
  await ensureSchema(db);
  await ensureTyphoonSchema(db);
  db.raw.prepare("INSERT INTO users (id, login_id, pw_hash, pw_salt, pw_iter, research_id, created_at) VALUES ('A', 'A', 'h', 's', 1, 'rA', 0)").run();
  db.raw.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES ('https://push.test/a', 'A', 'p', 'a', 0)").run();
  const settings = (from = "07:00", to = "22:00") =>
    db.raw.prepare("INSERT INTO typhoon_notify_settings (user_id, enabled, station, hours_from, hours_to, updated_at) VALUES ('A', 1, '47893', ?, ?, 0)").run(from, to);
  let n = 0;
  const announce = (t: XmlTelegram) =>
    db.raw
      .prepare("INSERT INTO typhoon_telegrams (id, kind, url, number, issued_at, target_at, fetched_at, hash, xml, parsed, parser) VALUES (?, 'VPTW60', 'u', ?, ?, ?, ?, 'h', '<x/>', ?, 1)")
      .run(`t${++n}`, t.number, t.issuedAt, t.targetAt, t.issuedAt, JSON.stringify(t));
  const sent: { title: string; body: string; url: string }[] = [];
  const send = async (_s: Subscription, m: unknown) => (sent.push(m as { title: string; body: string; url: string }), 201);
  const log = () => db.raw.prepare("SELECT kind, devices FROM typhoon_notify_log ORDER BY kind").all();
  return { db, settings, announce, send, sent, log };
}

describe("台風の目安の通知", () => {
  it("holds a warning found at night until the hours open, then sends it once", async () => {
    const { db, settings, announce, send, sent, log } = await setup();
    settings();
    announce(telegram("2026-11-17T01:45:00+09:00", { warnHere: true }));
    expect(await runTyphoonNotify(db, Date.parse("2026-11-17T02:00:00+09:00"), send)).toBe(0);
    expect(log()).toEqual([{ kind: "warning", devices: null }]); // found, waiting
    expect(await runTyphoonNotify(db, Date.parse("2026-11-17T07:00:00+09:00"), send)).toBe(1);
    expect(sent[0].title).toBe("台風32号：高知が暴風警戒域に入る予報");
    expect(sent[0].body).toMatch(/^11\/18（水）2時ごろから。Weather Note の目安です。/);
    expect(sent[0].url).toBe("/?typhoon=32");
    expect(await runTyphoonNotify(db, Date.parse("2026-11-17T07:05:00+09:00"), send)).toBe(0); // once
  });

  it("tells a gale entry once, and the 暴風域 by its name", async () => {
    const { db, settings, announce, send, sent } = await setup();
    settings();
    announce(telegram("2026-11-18T09:45:00+09:00", { galeHere: true }));
    expect(await runTyphoonNotify(db, Date.parse("2026-11-18T10:00:00+09:00"), send)).toBe(1);
    expect(sent[0].title).toBe("台風32号：高知が暴風域に入りました");
    expect(sent[0].body).toMatch(/^9時の解析。Weather Note の目安です。/);
    announce(telegram("2026-11-18T12:45:00+09:00", { galeHere: true }));
    expect(await runTyphoonNotify(db, Date.parse("2026-11-18T13:00:00+09:00"), send)).toBe(0);
  });

  it("drops what is no longer so when the hours open: a warning no longer forecast, a gale entry long past", async () => {
    const { db, settings, announce, send, sent, log } = await setup();
    settings("09:00", "10:00");
    announce(telegram("2026-11-17T18:45:00+09:00", { warnHere: true, galeHere: true }));
    expect(await runTyphoonNotify(db, Date.parse("2026-11-17T19:00:00+09:00"), send)).toBe(0);
    announce(telegram("2026-11-18T08:45:00+09:00")); // the forecast moved away
    expect(await runTyphoonNotify(db, Date.parse("2026-11-18T09:00:00+09:00"), send)).toBe(0);
    expect(sent).toEqual([]);
    expect(log()).toEqual([
      { kind: "gale", devices: -1 },
      { kind: "warning", devices: -1 },
    ]);
  });

  it("reads 通知の時間帯 across midnight, and refuses a switch with no station", () => {
    const at = (h: string) => Date.parse(`2026-11-17T${h}:00+09:00`);
    expect(inHours({ from: "07:00", to: "22:00" }, at("06:59"))).toBe(false);
    expect(inHours({ from: "07:00", to: "22:00" }, at("07:00"))).toBe(true);
    expect(inHours({ from: "22:00", to: "06:00" }, at("23:30"))).toBe(true);
    expect(inHours({ from: "22:00", to: "06:00" }, at("12:00"))).toBe(false);
    expect(() => checkTyphoonSettings({ enabled: true, station: null, from: "07:00", to: "22:00" })).toThrow();
    expect(checkTyphoonSettings({ enabled: true, station: "47893", from: "07:00", to: "22:00" }).station).toBe("47893");
    expect(typhoonMessage("2632", "高知", { kind: "gale", level: 1, at: "2026-11-18T15:00:00+09:00" }).title).toBe("台風32号：高知が強風域に入りました");
  });
});
