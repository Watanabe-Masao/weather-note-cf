// イベントの日の見出しの絵の台帳（2026-11-20 渡辺さん、docs/event-banner.md）：空のイベントの種類ごとに、配る絵
// （public/event/<種類>-<テーマ>.webp）の版・文字の入れ方・止めるかどうか。いつ出すかは shared/skyEvents.ts の計算。
// 絵を足す・差し替える・止めるのは、ここと public/event/ だけ（手順は docs/event-banner.md の E-01〜E-03）。
// 絵の無い種類・止めた種類・読めなかったときは、手描きの帯（src/design/eventLogo.ts）で出す。
import type { BrandTheme } from "./brand";
import type { SkyEvent, SkyEventKind } from "../../shared/skyEvents";

/** 絵の種類（ファイル名の英字）。満月は呼び名ごと、日食・月食は食の種類ごと。 */
export type EventArtKey =
  | "wolf"
  | "snow"
  | "worm"
  | "pink"
  | "flower"
  | "strawberry"
  | "buck"
  | "sturgeon"
  | "corn"
  | "harvest"
  | "hunter"
  | "beaver"
  | "cold"
  | "blue"
  | Exclude<SkyEventKind, "full">;

export interface EventArt {
  /** 版。絵を差し替えたら1つ上げる（URL に付くので、古い絵が端末に残らない）。 */
  rev: number;
  /**
   * 文字の入れ方。baked：絵に「Weather Note」が描いてある（11/20 の見本から切り抜いた仮の絵）。overlay：文字の無い絵に、
   * アプリの文字を重ねる（決まった形、docs/event-banner.md 3章）。
   */
  text: "baked" | "overlay";
  /** まちがいなどで止める（E-02）。止めると手描きの帯。 */
  off?: boolean;
}

/** 満月の呼び名 → 絵の種類（shared/fullMoonNames.ts の呼び名と一対一、test/data/event-assets.test.ts）。 */
export const FULL_MOON_ART: Record<string, EventArtKey> = {
  ウルフムーン: "wolf",
  スノームーン: "snow",
  ワームムーン: "worm",
  ピンクムーン: "pink",
  フラワームーン: "flower",
  ストロベリームーン: "strawberry",
  バックムーン: "buck",
  スタージョンムーン: "sturgeon",
  コーンムーン: "corn",
  ハーベストムーン: "harvest",
  ハンターズムーン: "hunter",
  ビーバームーン: "beaver",
  コールドムーン: "cold",
};

/** 台帳。null は絵がまだ無い（手描きの帯で出る）。 */
export const EVENT_ART: Record<EventArtKey, EventArt | null> = {
  wolf: { rev: 1, text: "baked" },
  snow: { rev: 1, text: "baked" },
  worm: { rev: 1, text: "baked" },
  pink: { rev: 1, text: "baked" },
  flower: { rev: 1, text: "baked" },
  strawberry: { rev: 1, text: "baked" },
  buck: { rev: 1, text: "baked" },
  sturgeon: { rev: 1, text: "baked" },
  corn: null,
  harvest: { rev: 1, text: "baked" },
  hunter: { rev: 1, text: "baked" },
  beaver: { rev: 1, text: "baked" },
  cold: { rev: 1, text: "baked" },
  blue: { rev: 1, text: "baked" },
  "lunar-total": null,
  "lunar-partial": null,
  "lunar-penumbral": null,
  "solar-total": null,
  "solar-annular": null,
  "solar-partial": null,
};

/** 絵の形（横：縦）と、配る大きさ（画面の2倍）。 */
export const EVENT_ART_SIZE = { width: 640, height: 160 } as const;
/** 1枚の重さの上限（バイト）。 */
export const EVENT_ART_MAX_BYTES = 40_000;
export const EVENT_ART_THEMES: readonly BrandTheme[] = ["navy", "warm", "mist"];

/** そのイベントの絵の種類（満月で呼び名の分からないときは null）。 */
export function eventArtKey(event: Pick<SkyEvent, "kind" | "name" | "blue">): EventArtKey | null {
  if (event.kind !== "full") return event.kind;
  if (event.blue) return "blue";
  return (event.name && FULL_MOON_ART[event.name]) || null;
}

/** 配る絵の URL と文字の入れ方。絵が無い・止めているときは null（手描きの帯）。 */
export function eventArt(event: Pick<SkyEvent, "kind" | "name" | "blue">, theme: BrandTheme): { src: string; text: EventArt["text"] } | null {
  const key = eventArtKey(event);
  const art = key ? EVENT_ART[key] : null;
  if (!key || !art || art.off) return null;
  return { src: `/event/${key}-${theme}.webp?v=${art.rev}`, text: art.text };
}
