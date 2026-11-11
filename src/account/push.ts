// This device's report notifications: asking permission, subscribing with the server's key, and
// leaving. The schedule (times, days) belongs to the account and is kept on the server.

import { api } from "./account";

export interface NotifySettings {
  enabled: boolean;
  times: string[];
  days: number[];
}

export type DeviceState =
  /** This browser cannot receive notifications at all. */
  | "unsupported"
  /** iPhone / iPad in the browser: notifications need the app added to the home screen. */
  | "needs-home-screen"
  /** The person blocked notifications for this site (only the browser's settings can undo it). */
  | "blocked"
  | "off"
  | "on";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const registration = async () => (await navigator.serviceWorker?.getRegistration()) ?? null;

export async function deviceState(): Promise<DeviceState> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return isIos() && !standalone() ? "needs-home-screen" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = await reg?.pushManager?.getSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Asks permission (must follow a tap) and subscribes this device. */
export async function turnOnDevice(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "通知がブロックされました。ブラウザの設定から、このサイトの通知を許可してください。" : "通知が許可されませんでした。");
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api("/api/push/subscribe", sub.toJSON());
}

/** Stops notifications on this device (the account's schedule stays for its other devices). */
export async function turnOffDevice(): Promise<void> {
  const sub = await (await registration())?.pushManager?.getSubscription().catch(() => null);
  if (!sub) return;
  await api("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

export const loadNotify = () => api<{ settings: NotifySettings; devices: number }>("/api/me/notify");
export const saveNotify = (s: NotifySettings) => api<{ settings: NotifySettings; devices: number }>("/api/me/notify", s);
export const testNotify = () => api<{ devices: number }>("/api/push/test", {});
