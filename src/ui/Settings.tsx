// Settings, in three groups that match how the app is used: 地点 (where), 肌感の基準 (how a
// temperature feels: the five levels drawn as the same coloured band as the 肌感 bar), 表示 (日なた /
// 日かげ). Saved data (spec chapter 1), refresh and clear sit folded at the end.

import { ModalSheet, useSheetClose } from "./ModalSheet";
import { SyncPanel } from "../beta/SyncPanel";
import { useSync } from "../beta/useSync";
import { useContext, useEffect, useRef, useState } from "react";

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
import { LEVELS, type Scale, SCALES, SURROUNDINGS } from "../../shared/feel";
import type { Station } from "../../shared/types";
import { type SavedFeel, SUNSHINE_PRESETS } from "../feelSettings";
import type { StorageReport, WeatherStore } from "../data/store";
import { LEVEL_COLORS } from "./FeelBar";
import { Segmented } from "./kit";
import { BetaContext } from "../beta/settings";
import { halfLifeDays, updateRate } from "../beta/adaptation";
import { BasisSheet } from "../beta/BasisSheet";
import { toCsv } from "../beta/reports";
import { reports, useReports } from "../beta/useReports";

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
  onClose: () => void;
}

const BAND_LO = -5;
const BAND_HI = 40;
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
 * The seven levels as one coloured band (the same colours as the 肌感 bar), with the six boundaries
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
        {[BAND_LO, 5, 15, 25, 35].map((v) => (
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

/** β②: the reported feelings on this device — how many, a CSV for analysis, and wiping them. */
function ReportData() {
  const list = useReports();
  const synced = useSync().state != null;
  const [confirming, setConfirming] = useState(false);
  const download = async () => {
    const csv = toCsv(await reports.all());
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `weather-note-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="set-row">
      <span className="set-label">
        感じ方の記録
        <small className="set-help">
          {list == null ? "…" : `${list.length}件`}
          {list?.[0] ? `（最後 ${new Date(list[0].at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）` : ""}
          。［保存データを消去］では消えません。{synced ? "［記録を消す］はこの端末の分だけで、サーバーと他の端末には残ります。" : ""}
        </small>
      </span>
      <div className="actions tight">
        <button onClick={() => void download()} disabled={!list?.length}>
          CSVを書き出す
        </button>
        {confirming ? (
          <button
            className="danger"
            onClick={() => {
              void reports.wipe();
              setConfirming(false);
            }}
          >
            本当に消す（元に戻せません）
          </button>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={!list?.length}>
            記録を消す
          </button>
        )}
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
      <p className="set-lead">日なた温度・日かげ温度が、どの段階に入るかの境目です。帯の境目を指で動かすか、− ＋ で0.5℃ずつ変えられます。表示のための区分で、快適の中心と範囲（β）の計算には使いません。</p>
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

function SettingsBody({ store, station, onStation, feel, sun, onSun, onClose: _done }: Props) {
  const beta = useContext(BetaContext);
  const [basis, setBasis] = useState(false);
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
        <div className="set-row">
          <span className="set-label">肌感の段階</span>
          <Segmented
            label="肌感の段階の数"
            value={String(feel.saved.scale ?? 7)}
            options={SCALES.map((n) => ({ id: String(n), label: `${n}段` }))}
            onChange={(v) => feel.update({ scale: Number(v) as Scale })}
          />
          <small className="set-help">
            計算はいつも7段（感じ方の記録と同じ並び）で、表示だけをまとめます。5段：寒い（寒い・涼しい）／肌寒い／適温／暖かい／暑い（暖かい・暑い）。3段：寒い側／適温／暑い側。
          </small>
        </div>
      </section>

      <section className="set-group" aria-labelledby="set-beta">
        <h3 id="set-beta">
          快適の中心と範囲 <span className="beta-tag">β</span>
        </h3>
        <p className="set-lead">
          その瞬間の「快適の中心」と「快適の範囲」を推定し、今の日なた温度・日かげ温度がそこからどれだけ離れているかを出します。中心も範囲も、最近の気温への慣れや湿度で動きます。感じ方の記録から学び続ける研究中の計算です（肌感とは別）。
        </p>
        <div className="set-row">
          <span className="set-label">
            慣れの速さ α
            <small className="set-help">
              基準がどれだけ早く最近の気温に追いつくか。自分では選ばず、感じ方の記録から選びます。
            </small>
          </span>
          <p className="beta-alpha" role="status">
            <b>
              {beta.alpha.toFixed(2)}
              <small>
                半減期 {halfLifeDays(beta.alpha)}日・前日の重み {updateRate(beta.alpha)}
              </small>
            </b>
            {beta.ens.n >= beta.minForAlpha
              ? `記録 ${beta.ens.n}件の当てはまりから選びました。`
              : `規格（EN 16798）の標準値です。記録が${beta.minForAlpha}件たまると、当てはまりで選びます（今 ${beta.ens.n}件）。`}
          </p>
          <p className="beta-alpha" role="status">
            <span>
              モデル {beta.ens.fits.length}つを比べています。いちばん重いのは{" "}
              {(() => {
                const i = beta.ens.weights.indexOf(Math.max(...beta.ens.weights));
                return `${beta.ens.fits[i].model.id} ${beta.ens.fits[i].model.name}（${Math.round(beta.ens.weights[i] * 100)}%）`;
              })()}
              {beta.ens.n === 0 ? "。記録がないうちは、どれも同じ重みです。" : "。"}
              {beta.fitting ? "（計算中）" : ""}
            </span>
          </p>
          <button className="link-btn" onClick={() => setBasis(true)}>
            計算の根拠を見る（今日）
          </button>
          {basis && store && <BasisSheet store={store} station={station} target={store.today} other={null} onClose={() => setBasis(false)} />}
        </div>
        <div className="set-row">
          <span className="set-label">
            予測のずれ
            <small className="set-help">記録のたびに、送信した時点で出した予測（7段階の確率）と答えを比べます。当たり＝最も確率の高い段階が答えだった割合。偏りの＋は予測より暖かく感じたこと。</small>
          </span>
          <p className="beta-alpha" role="status">
            {beta.record.n === 0 ? (
              <span>まだ記録がありません。</span>
            ) : (
              <span>
                {beta.record.n}件　当たり {Math.round((beta.record.hit ?? 0) * 100)}%・対数損失 {beta.record.logLoss?.toFixed(2)}（当てずっぽう 1.95）・偏り {beta.record.bias! > 0 ? "+" : ""}
                {beta.record.bias?.toFixed(1)}・平均のずれ {beta.record.mae?.toFixed(1)}段階（直近10件 {beta.record.recentMae?.toFixed(1)}）
              </span>
            )}
          </p>
        </div>
        <ReportData />
        <SyncPanel />
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
