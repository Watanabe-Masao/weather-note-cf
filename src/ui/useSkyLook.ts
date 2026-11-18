// 端末の向きで空を見る（2026-11-18）：iPhone の向きのセンサーを、押されたときに許可をもらって読み、背面カメラの向き
// （真北基準の方位と高さ）をならして返す。計算は shared/skyLook.ts。止めたら聞くのもやめる。
// 状態：off（使っていない）・on（読めている）・waiting（許可は出たが値がまだ）・denied（許可されなかった）・
// unsupported（この端末やブラウザでは読めない）・noHeading（傾きは読めるが方位が無い）。読めないのと許可されないのは分ける。
import { useCallback, useEffect, useRef, useState } from "react";
import { lookFrom, type Orientation, smooth } from "../../shared/skyLook";

export type SkyLookState = "off" | "waiting" | "on" | "denied" | "unsupported" | "noHeading";
type Look = { azimuth: number; altitude: number };

interface PermissionCapable {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** ならしの重み（新しい値の割合）：手の揺れを抑えつつ、向きを変えたら 0.3 秒ほどで追いつく。 */
const SMOOTH = 0.25;

export function useSkyLook(declination: number, offset: number) {
  const [state, setState] = useState<SkyLookState>("off");
  const [look, setLook] = useState<Look | null>(null);
  const last = useRef<Look | null>(null);
  const frame = useRef<number | null>(null);
  const listening = useRef(false);
  const params = useRef({ declination, offset });
  params.current = { declination, offset };

  const onEvent = useCallback((ev: Event) => {
    const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const o: Orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, webkitCompassHeading: e.webkitCompassHeading ?? null, absolute: e.absolute || ev.type === "deviceorientationabsolute" };
    const l = lookFrom(o, params.current.declination - params.current.offset);
    if (!l) {
      if (e.beta != null) setState((s) => (s === "on" ? s : "noHeading"));
      return;
    }
    last.current = smooth(last.current, l, SMOOTH);
    if (frame.current == null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setLook(last.current);
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
  return { state, look, start, stop };
}
