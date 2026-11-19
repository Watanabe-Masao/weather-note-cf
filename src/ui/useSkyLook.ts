// 端末の向きで空を見る（2026-11-18）：iPhone の向きのセンサーを、押されたときに許可をもらって読み、背面カメラの向き
// （真北基準の方位と高さ）をならして返す。計算は shared/skyLook.ts。止めたら聞くのもやめる。
// 状態：off（使っていない）・on（読めている）・waiting（許可は出たが値がまだ）・denied（許可されなかった）・
// unsupported（この端末やブラウザでは読めない）・noHeading（傾きは読めるが方位が無い）。読めないのと許可されないのは分ける。
import { useCallback, useEffect, useRef, useState } from "react";
import { azDiff, deviceLook, lookFrom, type Orientation, smooth } from "../../shared/skyLook";

export type SkyLookState = "off" | "waiting" | "on" | "denied" | "unsupported" | "noHeading";
type Look = { azimuth: number; altitude: number; roll: number };

interface PermissionCapable {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** ならしの重み（新しい値の割合）：手の揺れを抑えつつ、向きを変えたら 0.3 秒ほどで追いつく。 */
const SMOOTH = 0.25;
/**
 * コンパスとの差を測るのは、端末を立てて地平線の方へ向けている間だけ（11/19 実機：上へ 44°・48° に向けると、方位が
 * 155° → 250° → 338° と大きくずれた。iPhone のコンパスの値は、見上げるほど当てにならない）。見上げている間は、
 * 立てていたときに測った差のまま、向きのセンサー（ジャイロ）の回りだけで方位を出す。
 */
const CALIB_ALT = 20;
const CALIB_ROLL = 20;
const OUTLIER_DEG = 25;
/** 向きのセンサーはおよそ 60 回／秒：120 回で約2秒。 */
const OUTLIER_SAMPLES = 120;

/** 画面の向き（PWA は縦に固定なので、ふつうは 0）。 */
const screenAngle = () => {
  const o = typeof screen !== "undefined" ? (screen.orientation as ScreenOrientation | undefined) : undefined;
  if (o && typeof o.angle === "number") return o.angle;
  const w = (window as unknown as { orientation?: number }).orientation;
  return typeof w === "number" ? (w + 360) % 360 : 0;
};

export function useSkyLook(declination: number, offset: number) {
  const [state, setState] = useState<SkyLookState>("off");
  const [look, setLook] = useState<Look | null>(null);
  /** コンパスとの差を測れたか（まだなら、一度端末を立てて地平線の方へ向けてもらう）。 */
  const [calibrated, setCalibrated] = useState(false);
  const last = useRef<Look | null>(null);
  const frame = useRef<number | null>(null);
  const listening = useRef(false);
  const params = useRef({ declination, offset });
  params.current = { declination, offset };

  // 横向き・斜め（2026-11-19、実機の値と調査 #334）：方位・高さ・ロールは回転行列から出す（deviceLook）。iPhone の alpha は
  // 北が基準でないので、端末を立てている間（傾きが小さく、見上げすぎていない）だけコンパスとの差を測ってならし、行列の方位に
  // 足す。コンパスは横に傾けると端末の上の向きに引っ張られ（実機：横で約 −88° ずれた）、そのままは使えないため。
  // 差が測れる前に傾けていたら、今までどおりコンパスの値を使う。真上・真下では方位とロールを保つ。
  const calib = useRef<number | null>(null);
  const outlier = useRef(0);
  const onEvent = useCallback((ev: Event) => {
    const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const o: Orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, webkitCompassHeading: e.webkitCompassHeading ?? null, absolute: e.absolute || ev.type === "deviceorientationabsolute" };
    const decl = params.current.declination - params.current.offset;
    const base = lookFrom(o, decl);
    if (!base) {
      if (e.beta != null) setState((s) => (s === "on" ? s : "noHeading"));
      return;
    }
    let l: Look = { ...base, roll: last.current?.roll ?? 0 };
    if (e.alpha != null && e.beta != null && e.gamma != null) {
      const m = deviceLook(e.alpha, e.beta, e.gamma, screenAngle());
      const compass = o.webkitCompassHeading != null && Number.isFinite(o.webkitCompassHeading) ? o.webkitCompassHeading : null;
      if (m.azimuth != null && m.roll != null) {
        if (compass != null) {
          if (Math.abs(m.roll) < CALIB_ROLL && Math.abs(m.altitude) < CALIB_ALT) {
            const d = azDiff(compass, m.azimuth);
            // 大きく外れた値（25° より）は、2秒ほど続くまで覚えない：傾けたあとしばらくコンパスがずれたままのことがあり、
            // それを覚えると角度を戻してもずれたままになる（11/19 実機）。続くなら本当に変わったので受け入れる。
            const off = calib.current != null && Math.abs(azDiff(d, calib.current)) > OUTLIER_DEG;
            outlier.current = off ? outlier.current + 1 : 0;
            if (calib.current == null) calib.current = d;
            else if (!off || outlier.current > OUTLIER_SAMPLES) calib.current = calib.current + azDiff(d, calib.current) * 0.1;
          }
          if (calib.current != null) l = { azimuth: (((m.azimuth + calib.current - decl) % 360) + 360) % 360, altitude: m.altitude, roll: m.roll };
          else l = { ...base, roll: m.roll };
        } else if (o.absolute) l = { azimuth: (((m.azimuth - decl) % 360) + 360) % 360, altitude: m.altitude, roll: m.roll };
      } else l = { azimuth: last.current?.azimuth ?? base.azimuth, altitude: m.altitude, roll: last.current?.roll ?? 0 };
    }
    const prev = last.current;
    const sm = smooth(prev, l, SMOOTH);
    last.current = { ...sm, roll: prev ? prev.roll + azDiff(l.roll, prev.roll) * SMOOTH : l.roll };
    if (frame.current == null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setLook(last.current);
        setCalibrated(calib.current != null);
        setState("on");
      });
  }, []);

  const stop = useCallback(() => {
    if (listening.current) {
      window.removeEventListener("deviceorientationabsolute", onEvent);
      window.removeEventListener("deviceorientation", onEvent);
      listening.current = false;
    }
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    last.current = null;
    calib.current = null;
    setCalibrated(false);
    setLook(null);
    setState("off");
  }, [onEvent]);

  /** 押されたときに呼ぶ（iPhone は押した操作の中でしか許可を求められない）。 */
  const start = useCallback(async () => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return setState("unsupported");
    const ask = (DeviceOrientationEvent as unknown as PermissionCapable).requestPermission;
    if (typeof ask === "function") {
      try {
        if ((await ask()) !== "granted") return setState("denied");
      } catch {
        return setState("denied");
      }
    }
    setState("waiting");
    window.addEventListener("deviceorientationabsolute", onEvent);
    window.addEventListener("deviceorientation", onEvent);
    listening.current = true;
  }, [onEvent]);

  useEffect(() => stop, [stop]);
  return { state, look, start, stop, calibrated };
}
