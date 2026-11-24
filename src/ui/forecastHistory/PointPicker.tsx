// 時点を選ぶ（2026-11-24 渡辺さん、見本の OK）：その時刻までに出ていた発表のいちばん新しいものに印（shared/forecastPoint.ts）。
// よく使う時刻はボタン（前日 9時・14時・18時、当日 7時）、ほかは30分ごとに選ぶ。「やめる」でいつもの一覧へ。
import type { Slot } from "../../../shared/forecastHistoryModel";
import { issueLabel } from "../../../shared/forecastHistoryModel";
import { corrected, POINT_PRESETS, pointIso, pointLabel, pointOptions } from "../../../shared/forecastPoint";
import { Badge, Chip } from "../kit";

export function PointPicker({ day, point, latest, onPoint }: { day: string; point: string | null; latest: Slot | null; onPoint: (iso: string | null) => void }) {
  const presets = POINT_PRESETS.map((p) => pointIso(day, p.lead, p.h, p.m));
  return (
    <section className="fh-point" aria-label="時点を選ぶ">
      <p className="fh-point-head">
        <b>時点を選ぶ</b>
        <small>その時刻までに出ていた発表に印</small>
      </p>
      <div className="chip-row fh-point-chips">
        {presets.map((iso) => (
          <Chip key={iso} size="sm" on={point === iso} onClick={() => onPoint(point === iso ? null : iso)}>
            {pointLabel(day, iso)}
          </Chip>
        ))}
        <select className="chip sm fh-point-any" value={point && !presets.includes(point) ? point : ""} onChange={(e) => onPoint(e.target.value || null)} aria-label="時刻を選ぶ（30分ごと）">
          <option value="">ほかの時刻…</option>
          {pointOptions(day).map((iso) => (
            <option key={iso} value={iso}>
              {pointLabel(day, iso)}
            </option>
          ))}
        </select>
        {point && (
          <Chip size="sm" onClick={() => onPoint(null)}>
            やめる
          </Chip>
        )}
      </div>
      {point && (
        <p className="fh-point-say" role="status">
          {latest ? (
            <>
              <span>
                保存している記録のうち、{pointLabel(day, point)}までの最新は <b>{issueLabel(latest.at)}の発表</b> <Badge kind={latest.kind === "VPFD51" ? "府県" : "週間"} />
              </span>
              {corrected(latest) && <small>この発表には、あとで訂正あり（訂正がいつ出たかは記録に無いので、その時点で見えていたかは言い切れない）</small>}
              <small>それより後の発表は薄く（その時点ではまだ出ていない）</small>
            </>
          ) : (
            <>保存している記録には、{pointLabel(day, point)}までにこの日を予報した発表がありません</>
          )}
        </p>
      )}
    </section>
  );
}
