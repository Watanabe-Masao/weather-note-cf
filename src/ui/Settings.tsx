// Settings: observation point, saved data report (spec chapter 1), refresh and clear.

import { ModalSheet, useSheetClose } from "./ModalSheet";
import { useEffect, useState } from "react";

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

const time = (t: number | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");
const PERSISTED = { granted: "許可", denied: "不許可", unsupported: "未対応" } as const;

interface Props {
  store: WeatherStore | null;
  station: string;
  onStation: (id: string) => void;
  feel: { saved: SavedFeel; update: (patch: Partial<SavedFeel>) => void; reset: () => void };
  onClose: () => void;
}

/** Spec 4.8: the boundaries between the five levels, surroundings, sunshine and anemometer height. */
function FeelSection({ station, feel }: { station: string; feel: Props["feel"] }) {
  const { saved, update, reset } = feel;
  const height = saved.heights[station] ?? 10;
  return (
    <>
      <h3>肌感（日なた温度・日かげ温度）</h3>
      <div className="threshold-row">
        {saved.thresholds.map((value, i) => (
          <label key={i} className="threshold">
            <small>
              {LEVELS[i]}｜{LEVELS[i + 1]}
            </small>
            <NumberField
              value={value}
              label={`${LEVELS[i]}と${LEVELS[i + 1]}の境目（℃）`}
              onCommit={(v) => {
                const t = [...saved.thresholds] as SavedFeel["thresholds"];
                t[i] = v;
                update({ thresholds: t });
              }}
            />
          </label>
        ))}
      </div>
      <p className="hint">それぞれの段階の境目の温度（℃）。左から順に大きくなるように入力してください。</p>
      <label className="field">
        周りの様子（風の弱まり方）
        <select value={saved.alpha} onChange={(e) => update({ alpha: Number(e.target.value) })}>
          {SURROUNDINGS.map((s) => (
            <option key={s.alpha} value={s.alpha}>
              {s.label}（α {s.alpha.toFixed(2)}）
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        日なたの日差しの強さ
        <select value={saved.absorb} onChange={(e) => update({ absorb: Number(e.target.value) })}>
          {SUNSHINE_PRESETS.map((p) => (
            <option key={p.absorb} value={p.absorb}>
              {p.label}（k {p.absorb.toFixed(2)}）
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        この観測地点の風速計の高さ（m）
        <NumberField
          value={height}
          label="風速計の高さ（m）"
          min={2}
          max={200}
          onCommit={(v) => update({ heights: { ...saved.heights, [station]: v } })}
        />
      </label>
      <p className="hint">気象庁の観測所の地点情報に載っています。分からない間は10m。</p>
      <button className="reset" onClick={reset}>
        肌感の設定を初期値に戻す
      </button>
    </>
  );
}

function SettingsBody({ store, station, onStation, feel, onClose: _done }: Props) {
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

  return (
    <>
        <label className="field">
          観測地点
          <select value={station} onChange={(e) => onStation(e.target.value)}>
            {stations.map((s) => (
              <option key={s.blockNo} value={s.blockNo}>
                {s.prefecture} / {s.name}
              </option>
            ))}
          </select>
        </label>

        <FeelSection station={station} feel={feel} />

        <h3>保存データ</h3>
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
