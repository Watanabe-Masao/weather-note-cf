// 満月の呼び名（2026-11-20 渡辺さん「満月ページには別途ページ。今年だけの情報は一度切り離し、毎年使い回せる部分のみ」）。
// 上に呼び名の共通の注意、その下に選んだ年の満月の一覧（日時・呼び名・その年だけのこと）。行を押すと、その呼び名の
// 由来・自然との関係・象徴（毎年同じ文、shared/fullMoonNames.ts）が開く。その年だけのこと（月食・ブルームーン・
// いちばん近い／遠い満月）は計算から（shared/moon.ts fullMoonsOfYear）。
import { useEffect, useMemo, useRef, useState } from "react";
import { clockOf } from "../../shared/dayParts";
import { BLUE_MOON, FULL_MOON_NOTE, fullMoonInfo, type FullMoonNameInfo } from "../../shared/fullMoonNames";
import { fullMoonAlias, fullMoonsOfYear, type FullMoonFacts } from "../../shared/moon";
import { ModalSheet } from "./ModalSheet";
import { Glyph, IconButton, InfoNote } from "./kit";
import { PhaseIcon } from "./moonParts";

const jst = (ms: number) => {
  const d = new Date(ms + 9 * 3_600_000);
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: "日月火水木金土"[d.getUTCDay()] };
};

/** その年だけのこと（計算から）を短い札に。 */
export function factTags(f: FullMoonFacts, where: string): string[] {
  const out: string[] = [];
  if (f.blue) out.push("ブルームーン");
  if (f.eclipse) out.push(`${f.eclipse.kind}（${f.eclipse.visible ? `${where}から見える` : `${where}からは見えない`}）`);
  if (f.nearest) out.push("この年いちばん近い満月");
  if (f.farthest) out.push("この年いちばん遠い満月");
  return out;
}

/** 呼び名の説明（由来・自然との関係・象徴）。毎年同じ文。 */
export function NameDetail({ info }: { info: FullMoonNameInfo | Omit<FullMoonNameInfo, "short"> }) {
  return (
    <div className="fm-detail">
      <p className="fm-gloss">
        {info.en}　{info.gloss}
      </p>
      <p className="fm-symbols">象徴：{info.symbols.join("・")}</p>
      <h5>名前の由来</h5>
      {info.origin.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      <h5>自然との関係</h5>
      {info.nature.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      <h5>この満月が象徴するもの</h5>
      <p>{info.meaning}</p>
    </div>
  );
}

export function FullMoonSheet({ at, lat, lon, where, onClose }: { at: number; lat: number; lon: number; where: string; onClose: () => void }) {
  const [year, setYear] = useState(() => new Date(at + 9 * 3_600_000).getUTCFullYear());
  const list = useMemo(() => fullMoonsOfYear(year, lat, lon), [year, lat, lon]);
  const [open, setOpen] = useState<number | null>(() => at);
  const openRow = useRef<HTMLButtonElement>(null);
  // 開いたときは、押した満月の行を見える所へ。
  useEffect(() => {
    openRow.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ModalSheet title="満月の呼び名" onClose={onClose} className="fm-sheet">
      <InfoNote className="fm-note" more={FULL_MOON_NOTE[1]}>{FULL_MOON_NOTE[0]}</InfoNote>
      <div className="moon-cal-head">
        <IconButton size="sm" label="前の年" onClick={() => setYear(year - 1)}>
          <Glyph name="prev" />
        </IconButton>
        <b>{year}年の満月</b>
        <IconButton size="sm" label="次の年" onClick={() => setYear(year + 1)}>
          <Glyph name="next" />
        </IconButton>
      </div>
      <ul className="fm-list">
        {list.map((f) => {
          const j = jst(f.at);
          const info = fullMoonInfo(f.name);
          const isOpen = open === f.at;
          const tags = factTags(f, where);
          return (
            <li key={f.at}>
              <button type="button" ref={isOpen && Math.abs(f.at - at) < 1 ? openRow : undefined} className={isOpen ? "fm-row on" : "fm-row"} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.at)}>
                <PhaseIcon kind={2} size={16} />
                <span className="fm-when">
                  {j.md}（{j.wd}）{clockOf(j.min)}
                </span>
                <span className="fm-name">
                  <b>{f.blue ? "ブルームーン" : f.name}</b>
                  <small>{f.blue ? `${f.name}の月の2回目` : `${fullMoonAlias(f.name, f.at) ? `別名 ${fullMoonAlias(f.name, f.at)}。` : ""}${info?.short ?? ""}`}</small>
                  {tags.length > 0 && (
                    <span className="fm-tags">
                      {tags.map((t) => (
                        <em key={t}>{t}</em>
                      ))}
                    </span>
                  )}
                </span>
                <Glyph name={isOpen ? "up" : "down"} />
              </button>
              {isOpen && (
                <div className="fm-open">
                  {f.blue && <NameDetail info={BLUE_MOON} />}
                  {info && <NameDetail info={info} />}
                  {f.eclipse && (
                    <p className="fm-eclipse">
                      {f.eclipse.kind}：最大 {jst(f.eclipse.peak).md} {clockOf(jst(f.eclipse.peak).min)}。
                      {f.eclipse.visible ? `${where}では月が地平線の上にあり、見られます（天気しだい）。` : `${where}では月が地平線の下で、見られません。`}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <small className="set-help">日時は日本時間。月食・いちばん近い満月などは、その年ごとに計算しています（Astronomy Engine）。</small>
    </ModalSheet>
  );
}
