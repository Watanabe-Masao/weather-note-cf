// 項目の帯（2026-11-22 渡辺さん）：画面の下に浮かぶ1行の帯。比較・1日とも同じ。グラフのシートはこの上に乗る。
// 項目は5つの仲間に分ける：気温／空・光／雨・風／大気（湿度・気圧）／空気。1日は前に「まとめ」。選んでいる仲間だけが開いて中の項目が並び、ほかは仲間の
// 名前だけ（横に送らずに1行に収まる）。仲間を押すとその最初の項目になる。選んだ項目はテーマの色で塗る
// （項目ごとの色はグラフの線に使う。帯は「いまどこか」を示す操作の部品なので1色、どのテーマにもなじむ）。
import type { Ref } from "react";
import { METRICS } from "../metrics";
import { ItemIcon } from "./icons";

export const ITEM_GROUPS: { id: string; label: string; items: string[] }[] = [
  { id: "temp", label: "気温", items: ["temp"] },
  { id: "sky", label: "空・光", items: ["radiation", "light"] },
  { id: "rainwind", label: "雨・風", items: ["rain", "wind"] },
  { id: "air", label: "大気", items: ["humidity", "pressure"] },
  // 空気（11/25 渡辺さん「項目を分けませんか」→「いっそのこと統合」）：PM2.5・黄砂（CAMS）と視程（気象庁）を1つの項目に。
  // 気象庁は黄砂を見通し（視程）で伝えるので、並べて読む。項目の id は視程の visibility のまま（比較の表は視程の行）。
  { id: "airq", label: "空気", items: ["visibility"] },
];

/** 帯での名前（項目の名前と違うもの）。 */
const BAR_LABEL: Record<string, string> = { visibility: "空気" };

export function ItemBar({
  metric,
  onPick,
  barRef,
  summary,
}: {
  metric: string;
  onPick: (id: string) => void;
  barRef: Ref<HTMLElement>;
  /** 1日だけ：先頭の「まとめ」（2026-11-24 渡辺さん）。on のあいだは、どの仲間も開かない。 */
  summary?: { on: boolean; onPick: () => void };
}) {
  const label = (id: string) => BAR_LABEL[id] ?? METRICS.find((m) => m.id === id)?.label ?? id;
  const groups = ITEM_GROUPS;
  const current = metric;
  const active = summary?.on ? null : (groups.find((g) => g.items.includes(current)) ?? groups[0]);
  const pick = onPick;
  return (
    <nav className="metrics item-bar" aria-label="グラフの項目" ref={barRef}>
      {summary &&
        (summary.on ? (
          <div className="ib-open" role="tablist" aria-label="まとめ">
            <button role="tab" aria-selected data-item="summary" className="chip item on" onClick={summary.onPick}>
              <ItemIcon id="summary" />
              <span>まとめ</span>
            </button>
          </div>
        ) : (
          <button className="ib-cat ib-sum" data-items="summary" aria-label="まとめ（その日の項目を1行ずつ）" onClick={summary.onPick}>
            <ItemIcon id="summary" />
            <span>まとめ</span>
          </button>
        ))}
      {groups.map((g) =>
        g === active ? (
          <div key={g.id} className={g.items.length > 1 ? "ib-open multi" : "ib-open"} role="tablist" aria-label={g.label}>
            {g.items.length > 1 && (
              <span className="ib-legend" aria-hidden>
                {g.label}
              </span>
            )}
            {g.items.map((id) => (
              <button key={id} role="tab" aria-selected={id === current} data-item={id} className={id === current ? "chip item on" : "chip item"} onClick={() => pick(id)}>
                <ItemIcon id={id} />
                <span>{label(id)}</span>
              </button>
            ))}
          </div>
        ) : (
          <button key={g.id} className="ib-cat" data-items={g.items.join(" ")} aria-label={`${g.label}（${g.items.map(label).join("・")}）`} onClick={() => pick(g.items[0])}>
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
