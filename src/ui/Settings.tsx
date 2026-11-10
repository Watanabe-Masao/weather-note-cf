// Settings: observation point, saved data report (spec chapter 1), refresh and clear.

import { useEffect, useState } from "react";
import type { Station } from "../../shared/types";
import type { StorageReport, WeatherStore } from "../data/store";

const time = (t: number | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");
const PERSISTED = { granted: "許可", denied: "不許可", unsupported: "未対応" } as const;

interface Props {
  store: WeatherStore | null;
  station: string;
  onStation: (id: string) => void;
  onClose: () => void;
}

export function Settings({ store, station, onStation, onClose }: Props) {
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>
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
        <button className="close" onClick={onClose}>
          閉じる
        </button>
        <p className="credit">
          出典：<a href="https://www.jma.go.jp/">気象庁ホームページ</a>（実績）／
          <a href="https://open-meteo.com/">Open-Meteo</a>（予報・CC BY 4.0）
        </p>
      </div>
    </div>
  );
}
