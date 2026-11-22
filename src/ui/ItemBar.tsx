// 項目の帯（2026-11-22 渡辺さん）：画面の下に浮かぶ1行の帯。比較・1日とも同じ。グラフのシートはこの上に乗る。
// 項目は4つの仲間に分ける：気温／空・光／雨・風／大気。選んでいる仲間だけが開いて中の項目が並び、ほかは仲間の
// 名前だけ（横に送らずに1行に収まる）。仲間を押すとその最初の項目になる。選んだ項目はテーマの色で塗る
// （項目ごとの色はグラフの線に使う。帯は「いまどこか」を示す操作の部品なので1色、どのテーマにもなじむ）。
import type { Ref } from "react";
import { METRICS } from "../metrics";
import { ItemIcon } from "./icons";

export const ITEM_GROUPS: { id: string; label: string; items: string[] }[] = [
  { id: "temp", label: "気温", items: ["temp"] },
  { id: "sky", label: "空・光", items: ["radiation", "light"] },
  { id: "rainwind", label: "雨・風", items: ["rain", "wind"] },
  { id: "air", label: "大気", items: ["humidity", "visibility", "pressure"] },
];

export function ItemBar({ metric, onPick, barRef }: { metric: string; onPick: (id: string) => void; barRef: Ref<HTMLElement> }) {
  const label = (id: string) => METRICS.find((m) => m.id === id)?.label ?? id;
  const active = ITEM_GROUPS.find((g) => g.items.includes(metric)) ?? ITEM_GROUPS[0];
  return (
    <nav className="metrics item-bar" aria-label="グラフの項目" ref={barRef}>
      {ITEM_GROUPS.map((g) =>
        g === active ? (
          <div key={g.id} className={g.items.length > 1 ? "ib-open multi" : "ib-open"} role="tablist" aria-label={g.label}>
            {g.items.length > 1 && (
              <span className="ib-legend" aria-hidden>
                {g.label}
              </span>
            )}
            {g.items.map((id) => (
              <button key={id} role="tab" aria-selected={id === metric} data-item={id} className={id === metric ? "chip item on" : "chip item"} onClick={() => onPick(id)}>
                <ItemIcon id={id} />
                <span>{label(id)}</span>
              </button>
            ))}
          </div>
        ) : (
          <button key={g.id} className="ib-cat" data-items={g.items.join(" ")} aria-label={`${g.label}（${g.items.map(label).join("・")}）`} onClick={() => onPick(g.items[0])}>
            <ItemIcon id={g.items[0]} />
            <span>{g.label}</span>
            {/* 中の項目の数（2つ以上のとき）：押すと開く仲間だと分かるように */}
            {g.items.length > 1 && (
              <span className="ib-dots" aria-hidden>
                {g.items.map((id) => (
                  <i key={id} />
                ))}
              </span>
            )}
          </button>
        ),
      )}
    </nav>
  );
}
