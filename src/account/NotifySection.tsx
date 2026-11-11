// Settings › アカウント › 記録の通知: when to be asked for a report (times and days, for the
// account), and whether this device receives the notifications.

import { useEffect, useState } from "react";
import { BANDS } from "../../shared/feel";
import { Segmented } from "../ui/kit";
import { type DeviceState, loadNotify, type NotifySettings, saveNotify, testNotify, turnOffDevice, turnOnDevice, deviceState } from "./push";

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** The 肌感 map's 時間帯, each with a notification at its middle (worker/src/notify.ts: BAND_TIMES). */
const BAND_TIMES = BANDS.map((b) => ({ label: b.label, time: `${String(b.hours[1]).padStart(2, "0")}:00`, hours: b.hours as readonly number[] }));
const bandOf = (t: string) => BAND_TIMES.find((b) => b.hours.includes(Number(t.slice(0, 2))))?.label ?? null;

const DEVICE_TEXT: Record<DeviceState, string> = {
  unsupported: "このブラウザは通知に対応していません。",
  "needs-home-screen": "iPhone・iPad では、ホーム画面に追加したアプリ（共有 →［ホーム画面に追加］）を開くと通知を受け取れます。",
  blocked: "この端末では通知がブロックされています。ブラウザ（またはホーム画面のアプリ）の設定で、通知を許可してください。",
  off: "この端末では受け取っていません。",
  on: "この端末で受け取ります。",
};

export function NotifySection() {
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [devices, setDevices] = useState(0);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [adding, setAdding] = useState("21:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null);

  useEffect(() => {
    loadNotify()
      .then((r) => (setSettings(r.settings), setDevices(r.devices)))
      .catch((e) => setMessage({ text: (e as Error).message, warn: true }));
    void deviceState().then(setDevice);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: (e as Error).message, warn: true });
    } finally {
      setBusy(false);
      setDevice(await deviceState());
    }
  };

  const save = (next: NotifySettings) =>
    run(async () => {
      setSettings(next); // shown at once; the server's answer settles it
      const r = await saveNotify(next);
      setSettings(r.settings);
      setDevices(r.devices);
    });

  if (!settings) return message ? <p className="warn">{message.text}</p> : null;

  return (
    <div className="set-row notify">
      <span className="set-label">
        記録の通知
        <small className="set-help">決めた時刻に「今、外はどう感じますか？」と通知します。押すと記録の画面が開きます。通知がなくても、上の［記録］からいつでも記録できます。</small>
      </span>
      <Segmented
        label="記録の通知"
        value={settings.enabled ? "on" : "off"}
        options={[
          { id: "on", label: "通知する" },
          { id: "off", label: "通知しない" },
        ]}
        onChange={(v) => void save({ ...settings, enabled: v === "on" })}
      />
      {settings.enabled && (
        <>
          <div className="notify-bands" role="group" aria-label="肌感マップの時間帯で通知する">
            {BAND_TIMES.map((b) => {
              const on = settings.times.includes(b.time);
              return (
                <button
                  key={b.time}
                  aria-pressed={on}
                  className={on ? "on" : ""}
                  disabled={busy || (!on && settings.times.length >= 6)}
                  onClick={() => void save({ ...settings, times: on ? settings.times.filter((x) => x !== b.time) : [...settings.times, b.time].sort() })}
                >
                  <b>{b.label}</b>
                  <small>{b.time}</small>
                </button>
              );
            })}
          </div>
          <small className="set-help">肌感マップの時間帯の真ん中に通知します。記録がその時間帯の値と比べられます。ほかの時刻も足せます。</small>
          <div className="notify-times" role="group" aria-label="通知の時刻">
            {settings.times.filter((t) => !BAND_TIMES.some((b) => b.time === t)).map((t) => (
              <span key={t} className="notify-time">
                {bandOf(t) ? <em>{bandOf(t)}</em> : null}
                {t}
                <button aria-label={`${t} の通知をやめる`} disabled={busy} onClick={() => void save({ ...settings, times: settings.times.filter((x) => x !== t) })}>
                  ×
                </button>
              </span>
            ))}
            {settings.times.length < 6 && (
              <span className="notify-add">
                <input type="time" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="追加する時刻" />
                <button disabled={busy || !adding || settings.times.includes(adding)} onClick={() => void save({ ...settings, times: [...settings.times, adding].sort() })}>
                  追加
                </button>
              </span>
            )}
          </div>
          <div className="notify-days" role="group" aria-label="通知する曜日">
            {DAYS.map((d, i) => {
              const on = settings.days.includes(i);
              return (
                <button
                  key={d}
                  aria-pressed={on}
                  className={on ? "on" : ""}
                  disabled={busy}
                  onClick={() => void save({ ...settings, days: on ? settings.days.filter((x) => x !== i) : [...settings.days, i].sort() })}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <small className="set-help">
            {device ? DEVICE_TEXT[device] : "…"}
            {devices ? `（このアカウントで受け取る端末 ${devices}台）` : ""}
          </small>
          <div className="actions tight">
            {device === "off" && (
              <button className="primary" disabled={busy} onClick={() => void run(async () => (await turnOnDevice(), setDevices((await loadNotify()).devices)))}>
                この端末で受け取る
              </button>
            )}
            {device === "on" && (
              <>
                <button disabled={busy} onClick={() => void run(async () => (await testNotify(), setMessage({ text: "テストの通知を送りました。" })))}>
                  テスト通知
                </button>
                <button disabled={busy} onClick={() => void run(async () => (await turnOffDevice(), setDevices((await loadNotify()).devices)))}>
                  この端末では受け取らない
                </button>
              </>
            )}
          </div>
        </>
      )}
      {message ? <p className={message.warn ? "warn" : "set-help"}>{message.text}</p> : null}
    </div>
  );
}
