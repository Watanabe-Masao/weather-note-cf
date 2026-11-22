// 項目の帯（2026-11-22 渡辺さん）：画面の下に固定。比較・1日とも同じ。グラフのシートはこの上に乗る。
// 項目は4つの仲間に分ける（渡辺さん）：気温／空・光／雨・風／大気。
import type { CSSProperties, Ref } from "react";
import { METRICS } from "../metrics";
import { ItemIcon } from "./icons";

/** Each item's own colour (the colour of its line in the graphs). */
const ITEM_TONE: Record<string, string> = {
  temp: "temp",
  rain: "rain",
  radiation: "radiation",
  light: "sun",
  humidity: "humidity",
  visibility: "visibility",
  wind: "wind",
  pressure: "pressure",
};

export const ITEM_GROUPS: { id: string; label: string; items: string[] }[] = [
  { id: "temp", label: "気温", items: ["temp"] },
  { id: "sky", label: "空・光", items: ["radiation", "light"] },
  { id: "rainwind", label: "雨・風", items: ["rain", "wind"] },
  { id: "air", label: "大気", items: ["humidity", "visibility", "pressure"] },
];

const tone = (id: string) => ({ "--chip-tone": `var(--data-${ITEM_TONE[id] ?? "mean"})` }) as CSSProperties;

export function ItemBar({ metric, onPick, barRef, layout }: { metric: string; onPick: (id: string) => void; barRef: Ref<HTMLElement>; layout: string }) {
  const label = (id: string) => METRICS.find((m) => m.id === id)?.label ?? id;
  const chip = (id: string) => (
    <button key={id} role="tab" aria-selected={id === metric} className={id === metric ? "chip item on" : "chip item"} style={tone(id)} onClick={() => onPick(id)}>
      <ItemIcon id={id} />
      <span className="item-bar-label">{label(id)}</span>
    </button>
  );
  const active = ITEM_GROUPS.find((g) => g.items.includes(metric)) ?? ITEM_GROUPS[0];
  // 2段：上に仲間、下にその仲間の項目（横に送らない）。
  if (layout === "g2")
    return (
      <nav className="metrics item-bar ib-g2" aria-label="グラフの項目" ref={barRef}>
        <div className="ib-cats">
          {ITEM_GROUPS.map((g) => (
            <button key={g.id} className={g === active ? "ib-cat on" : "ib-cat"} style={tone(g.items[0])} onClick={() => onPick(g.items[0])}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="ib-items" role="tablist">{active.items.map(chip)}</div>
      </nav>
    );
  // ひらく：選んでいる仲間だけが開いて項目が並ぶ。ほかは仲間の名前だけ（1行、横に送らない）。
  if (layout === "g3")
    return (
      <nav className="metrics item-bar ib-g3" aria-label="グラフの項目" ref={barRef}>
        {ITEM_GROUPS.map((g) =>
          g === active ? (
            <div key={g.id} className="ib-open" role="tablist" aria-label={g.label}>
              {g.items.length > 1 && <span className="ib-open-cap">{g.label}</span>}
              {g.items.map(chip)}
            </div>
          ) : (
            <button key={g.id} className="ib-cat" style={tone(g.items[0])} onClick={() => onPick(g.items[0])}>
              <ItemIcon id={g.items[0]} />
              <span>{g.label}</span>
            </button>
          ),
        )}
      </nav>
    );
  // 1行で横に送る、仲間ごとに小さな見出しと区切り。
  return (
    <nav className="metrics item-bar ib-g1" aria-label="グラフの項目" ref={barRef}>
      {ITEM_GROUPS.map((g) => (
        <div key={g.id} className="ib-group" role="tablist" aria-label={g.label}>
          <span className="ib-cap">{g.label}</span>
          <div className="ib-chips">{g.items.map(chip)}</div>
        </div>
      ))}
    </nav>
  );
}
