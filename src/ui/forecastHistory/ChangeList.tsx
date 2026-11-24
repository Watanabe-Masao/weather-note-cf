// この日の予報の変化（2026-11-24 渡辺さん、見本の②）：予報の移り変わりのいちばん上に、変化を新しい順に3つまで。
// 行を押すと、その発表を選ぶ（上の枠・グラフ・一覧がその発表に）。決まりは shared/forecastChanges.ts。
import type { DayChange } from "../../../shared/forecastChanges";
import { Badge, Button } from "../kit";

const SHOWN = 3;

/** pairs：比べられた組の数。0 なら「変化なし」と言わず、比べる発表がそろっていないと言う。 */
export function ChangeList({ changes, pairs, onPick }: { changes: DayChange[]; pairs: number; onPick: (key: string) => void }) {
  return (
    <section className="fc-changes" aria-label="この日の予報の変化">
      <p className="fc-changes-head">
        <b>この日の予報の変化</b>
        <small>気象庁の同じ種類の発表どうし</small>
      </p>
      {changes.length === 0 && pairs === 0 ? (
        <p className="fc-changes-none lack">変化を確かめられる発表がそろっていません（同じ種類の発表が2つ以上いる）。</p>
      ) : changes.length === 0 ? (
        <p className="fc-changes-none">大きな変化はありません（比べた {pairs} 組：雨の有無・降水確率 20 ポイント以上・最高と最低 2℃ 以上）。</p>
      ) : (
        changes.slice(0, SHOWN).map((c) => (
          <Button key={`${c.key}/${c.kind}`} kind="quiet" className={`fc-change ${c.kind}`} onClick={() => onPick(c.key)}>
            <span className="fc-change-what">
              {c.when}
              <Badge kind={c.issueKind === "VPFD51" ? "府県" : "週間"} />
              <b>{c.what}</b>
            </span>
            <small className="fc-change-detail">{c.detail}</small>
          </Button>
        ))
      )}
    </section>
  );
}
