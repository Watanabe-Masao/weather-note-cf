// Settings, in three groups that match how the app is used: 地点 (where), 肌感の基準 (how a
// temperature feels: the five levels drawn as the same coloured band as the 肌感 bar), 表示 (日なた /
// 日かげ). Saved data (spec chapter 1), refresh and clear sit folded at the end.

import { ModalSheet, useSheetClose } from "./ModalSheet";
import { useEffect, useRef, useState } from "react";

/** A number field that commits when editing ends (blur or Enter), so half-typed values never apply. */
function NumberField({ value, onCommit, label, ...rest }: { value: number; onCommit: (v: number) => void; label: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(v)) onCommit(v);
    // Show the saved value again; if the edit was accepted, the new value replaces it on the next render.
    setDraft(String(value));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      {...rest}
    />
  );
}
import { LEVELS, SURROUNDINGS } from "../../shared/feel";
import type { Station } from "../../shared/types";
import { type SavedFeel, SUNSHINE_PRESETS } from "../feelSettings";
import type { StorageReport, WeatherStore } from "../data/store";
import { LEVEL_COLORS } from "./FeelBar";
import { Segmented } from "./kit";
import { ADAPT_SPEEDS, type AdaptSpeed } from "../beta/adaptation";
import type { BetaSettings } from "../beta/settings";

const time = (t: number | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");
const PERSISTED = { granted: "許可", denied: "不許可", unsupported: "未対応" } as const;

interface Props {
  store: WeatherStore | null;
  station: string;
  onStation: (id: string) => void;
  feel: { saved: SavedFeel; update: (patch: Partial<SavedFeel>) => void; reset: () => void };
  /** 日なた (true) or 日かげ (false): the shared display setting. */
  sun: boolean;
  onSun: (sun: boolean) => void;
  beta: { beta: BetaSettings; update: (patch: Partial<BetaSettings>) => void };
  onClose: () => void;
}

const BAND_LO = -5;
const BAND_HI = 35;
const STEP = 0.5;
const GAP = 0.5; // neighbouring boundaries stay at least this far apart

/** Move boundary `i` to `v`, kept between its neighbours and on the 0.5℃ grid. */
export function moveThreshold(t: SavedFeel["thresholds"], i: number, v: number): SavedFeel["thresholds"] {
  const lo = i > 0 ? t[i - 1] + GAP : BAND_LO;
  const hi = i < t.length - 1 ? t[i + 1] - GAP : BAND_HI;
  const next = [...t] as SavedFeel["thresholds"];
  next[i] = Math.min(hi, Math.max(lo, Math.round(v / STEP) * STEP));
  return next;
}

/**
 * The five levels as one coloured band (the same colours as the 肌感 bar), with the four boundaries
 * as handles: drag one along the band, or use − ＋ under it. What is set is what the bar will show.
 */
function LevelBand({ thresholds, onChange }: { thresholds: SavedFeel["thresholds"]; onChange: (t: SavedFeel["thresholds"]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const pct = (v: number) => ((v - BAND_LO) / (BAND_HI - BAND_LO)) * 100;
  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return BAND_LO + ((clientX - r.left) / r.width) * (BAND_HI - BAND_LO);
  };
  const edges = [BAND_LO, ...thresholds, BAND_HI];
  return (
    <div className="level-set">
      <div
        ref={ref}
        className="level-band"
        onPointerDown={(e) => {
          const v = valueAt(e.clientX);
          // The nearest boundary follows the finger.
          let best = 0;
          thresholds.forEach((t, i) => Math.abs(t - v) < Math.abs(thresholds[best] - v) && (best = i));
          drag.current = best;
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange(moveThreshold(thresholds, best, v));
        }}
        onPointerMove={(e) => drag.current != null && onChange(moveThreshold(thresholds, drag.current, valueAt(e.clientX)))}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {LEVELS.map((name, i) => (
          <span
            key={name}
            className="level-seg"
            style={{ left: `${pct(edges[i])}%`, width: `${pct(edges[i + 1]) - pct(edges[i])}%`, background: LEVEL_COLORS[i] }}
          >
            {/* Names only where they fit; the steppers below name every boundary. */}
            {pct(edges[i + 1]) - pct(edges[i]) >= 22 && <span>{name}</span>}
          </span>
        ))}
        {thresholds.map((t, i) => (
          <span key={i} className="level-handle" style={{ left: `${pct(t)}%` }} aria-hidden>
            <b>{t % 1 ? t.toFixed(1) : t}</b>
          </span>
        ))}
      </div>
      <div className="level-scale" aria-hidden>
        {[BAND_LO, 5, 15, 25, BAND_HI].map((v) => (
          <span key={v} style={{ left: `${pct(v)}%` }}>
            {v}
          </span>
        ))}
      </div>
      <div className="level-steppers">
        {thresholds.map((t, i) => (
          <div key={i} className="level-stepper" role="group" aria-label={`${LEVELS[i]}と${LEVELS[i + 1]}の境目`}>
            <small>
              <i style={{ background: LEVEL_COLORS[i] }} />
              {LEVELS[i]}｜{LEVELS[i + 1]}
              <i style={{ background: LEVEL_COLORS[i + 1] }} />
            </small>
            <div>
              <button onClick={() => onChange(moveThreshold(thresholds, i, t - STEP))} aria-label={`${LEVELS[i]}と${LEVELS[i + 1]}の境目を0.5度下げる`}>
                −
              </button>
              <output aria-live="polite">{t.toFixed(1)}℃</output>
              <button onClick={() => onChange(moveThreshold(thresholds, i, t + STEP))} aria-label={`${LEVELS[i]}と${LEVELS[i + 1]}の境目を0.5度上げる`}>
                ＋
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Spec 4.8: the boundaries between the five levels, surroundings and sunshine. */
function FeelSection({ feel }: { feel: Props["feel"] }) {
  const { saved, update, reset } = feel;
  return (
    <section className="set-group" aria-labelledby="set-feel">
      <h3 id="set-feel">肌感の基準</h3>
      <p className="set-lead">日なた温度・日かげ温度が、どの段階に入るかの境目です。帯の境目を指で動かすか、− ＋ で0.5℃ずつ変えられます。</p>
      <LevelBand thresholds={saved.thresholds} onChange={(thresholds) => update({ thresholds })} />
      <div className="set-row">
        <span className="set-label">周りの様子</span>
        <Segmented
          label="周りの様子（風の弱まり方）"
          value={String(saved.alpha)}
          options={SURROUNDINGS.map((s) => ({ id: String(s.alpha), label: s.label }))}
          onChange={(v) => update({ alpha: Number(v) })}
        />
        <small className="set-help">建物が多いほど風が弱まり、暖かく感じる計算になります。</small>
      </div>
      <div className="set-row">
        <span className="set-label">日差しの強さ</span>
        <Segmented
          label="日なたの日差しの強さ"
          value={String(saved.absorb)}
          options={SUNSHINE_PRESETS.map((p) => ({ id: String(p.absorb), label: p.label }))}
          onChange={(v) => update({ absorb: Number(v) })}
        />
        <small className="set-help">日なた温度で、日差しをどれだけ足すか。</small>
      </div>
      <button className="reset" onClick={reset}>
        肌感の基準を初期値に戻す
      </button>
    </section>
  );
}

function SettingsBody({ store, station, onStation, feel, sun, onSun, beta, onClose: _done }: Props) {
  void _done;
  const onClose = useSheetClose();
  const [stations, setStations] = useState<Station[]>([]);
  const [report, setReport] = useState<StorageReport | null>(null);

  useEffect(() => {
    fetch("/api/stations")
      .then((r) => r.json())
      .then(setStations, () => {});
  }, []);
  useEffect(() => {
    if (!store) return;
    const update = () => void store.report().then(setReport);
    update();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = store.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        update();
      }, 1_000);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [store]);

  const height = feel.saved.heights[station] ?? 10;
  const current = stations.find((s) => s.blockNo === station);
  return (
    <>
      <section className="set-group" aria-labelledby="set-station">
        <h3 id="set-station">地点</h3>
        <label className="set-row">
          <span className="set-label">観測地点</span>
          <select value={station} onChange={(e) => onStation(e.target.value)}>
            {stations.map((s) => (
              <option key={s.blockNo} value={s.blockNo}>
                {s.prefecture} / {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="set-row inline">
          <span className="set-label">
            風速計の高さ
            <small className="set-help">{current ? `${current.name}の観測所。` : ""}気象庁の地点情報に載っています。分からなければ10m。</small>
          </span>
          <span className="set-number">
            <NumberField
              value={height}
              label="風速計の高さ（m）"
              min={2}
              max={200}
              onCommit={(v) => feel.update({ heights: { ...feel.saved.heights, [station]: v } })}
            />
            m
          </span>
        </label>
      </section>

      <FeelSection feel={feel} />

      <section className="set-group" aria-labelledby="set-view">
        <h3 id="set-view">表示</h3>
        <div className="set-row">
          <span className="set-label">肌感の温度</span>
          <Segmented
            label="肌感の温度"
            value={sun ? "sun" : "shade"}
            options={[
              { id: "sun", label: "日なた温度" },
              { id: "shade", label: "日かげ温度" },
            ]}
            onChange={(v) => onSun(v === "sun")}
          />
          <small className="set-help">表・グラフ・時間帯の肌感に共通です。グラフのチップからも切り替えられます。</small>
        </div>
      </section>

      <section className="set-group" aria-labelledby="set-beta">
        <h3 id="set-beta">
          最近との差 <span className="beta-tag">β</span>
        </h3>
        <p className="set-lead">
          最近の日平均気温の移動平均を「慣れの基準」にして、その日の気温・日なた温度・日かげ温度が基準からどれだけ離れているかを出します。体感の予測ではなく、検証中の目安です（肌感とは別の計算）。
        </p>
        <div className="set-row">
          <span className="set-label">慣れの速さ</span>
          <Segmented
            label="慣れの速さ"
            value={beta.beta.speed}
            options={ADAPT_SPEEDS.map((s) => ({ id: s.id, label: s.label }))}
            onChange={(v) => beta.update({ speed: v as AdaptSpeed })}
          />
          <small className="set-help">基準がどれだけ早く最近の気温に追いつくか。標準は建物の快適性の規格（EN 16798）の値。春・秋の急な変化に合わせたいときは「速い」。</small>
        </div>
      </section>

      <details className="set-group set-data">
        <summary>
          <h3>保存データ</h3>
          <small>
            日別 {report?.days ?? "…"}・時間別 {report?.hours ?? "…"}
          </small>
        </summary>
        <dl className="report">
          <dt>保存件数</dt>
          <dd>
            日別 {report?.days ?? "…"} / 時間別 {report?.hours ?? "…"}
          </dd>
          <dt>最初の保存</dt>
          <dd>{time(report?.firstSavedAt ?? null)}</dd>
          <dt>最後の保存</dt>
          <dd>{time(report?.lastSavedAt ?? null)}</dd>
          <dt>保存の永続化</dt>
          <dd>{PERSISTED[report?.persisted ?? "unsupported"]}</dd>
          <dt>この起動での通信</dt>
          <dd>{store?.requests ?? 0}回</dd>
        </dl>
        {report?.lostSince ? <p className="warn">保存データが消えていました（前回 {report.lostSince}件）</p> : null}
      </details>

        <div className="actions">
          <button
            onClick={() => {
              store?.refresh();
              onClose();
            }}
          >
            予報・速報を更新
          </button>
          <button
            onClick={() => {
              if (confirm("保存したデータを消去して、取り直しますか？")) void store?.clear();
            }}
          >
            保存データを消去
          </button>
        </div>
        <p className="credit">
          出典：<a href="https://www.jma.go.jp/">気象庁ホームページ</a>（実績）／
          <a href="https://open-meteo.com/">Open-Meteo</a>（予報・CC BY 4.0）
        </p>
    </>
  );
}

export function Settings(props: Props) {
  return (
    <ModalSheet title="設定" onClose={props.onClose} className="settings">
      <SettingsBody {...props} />
    </ModalSheet>
  );
}
