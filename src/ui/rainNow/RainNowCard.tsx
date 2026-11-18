// 今日の 1日モードの「雨の見込み」(2026-11-18 渡辺さん「天気図や雨予報を移しましょう」)：雨の見込みは選んだ日ではなく
// 「今」のもの（3時間前〜15時間後）なので、今日の 1日モードにだけ出す。この先1時間・15時間の言葉（地図の板と同じ
// aheadItems）と、「直近の雨雲レーダー」ボタン（2026-11-18 渡辺さんの言葉）。押すと雨の見込みのシート（地図・再生・グラフ）が開く。過去・先の日には出さない
// （その日の雨と取り違えないように）。
import { useMemo } from "react";
import { rainPlace } from "../../../shared/rainNow";
import { Button, SectionHead } from "../kit";
import { aheadItems } from "./RainNowBoard";
import { useLevels, useRainNow } from "./rainNowData";

export function RainNowCard({ station, onOpen }: { station: string; onOpen: () => void }) {
  const [loaded] = useRainNow(station);
  if (!rainPlace(station)) return null;
  return (
    <div className="rn-card">
      <SectionHead title="雨の見込み" as="h3">
        <Button size="sm" onClick={onOpen}>
          直近の雨雲レーダー
        </Button>
      </SectionHead>
      {loaded.s === "loading" ? (
        <p className="rn-note">読んでいます…</p>
      ) : loaded.s === "failed" || !loaded.data.now ? (
        <p className="rn-note">雨雲の一覧が取れませんでした（雨がないという意味ではありません）。</p>
      ) : (
        <Say station={station} data={loaded.data} />
      )}
    </div>
  );
}

function Say({ station, data }: { station: string; data: NonNullable<Extract<ReturnType<typeof useRainNow>[0], { s: "ok" }>["data"]> }) {
  const all = useMemo(() => [...data.frames.filter((f) => f.kind !== "hourly"), ...data.hours], [data.frames, data.hours]);
  const levels = useLevels(station, all);
  const items = aheadItems(data.now!, data.frames, data.hours, levels);
  // 1時間と15時間の2枚だけ（板と同じ並び。こまの詳しい言葉は地図の板で）
  const one = items.find((x) => x.label !== "この先15時間") ?? null;
  const long = items.find((x) => x.label === "この先15時間") ?? null;
  return (
    <div className="rn-say">
      {[one, long].filter(Boolean).map((it) => (
        <div key={it!.label} className="rn-say-item">
          <small>{it!.label}</small>
          <b>{it!.value}</b>
          {it!.sub && <span>{it!.sub}</span>}
        </div>
      ))}
    </div>
  );
}
