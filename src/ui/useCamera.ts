// 背面カメラの映像（AR 風、2026-11-19）：押されたときに許可をもらって背面カメラを開き、止めたら必ず閉じる（電池と
// 安心のため）。状態：off・starting・on・denied（許可されない）・unsupported（この端末やブラウザでは使えない）。
// 映像は端末の中だけで使い、保存も送信もしない。
import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "off" | "starting" | "on" | "denied" | "unsupported";

export function useCamera() {
  const [state, setState] = useState<CameraState>("off");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const live = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    live.current?.getTracks().forEach((t) => t.stop());
    live.current = null;
    setStream(null);
    setState("off");
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return setState("unsupported");
    setState("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      live.current = s;
      setStream(s);
      setState("on");
    } catch (e) {
      setState(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "unsupported");
    }
  }, []);

  useEffect(() => () => live.current?.getTracks().forEach((t) => t.stop()), []);
  return { state, stream, start, stop };
}
