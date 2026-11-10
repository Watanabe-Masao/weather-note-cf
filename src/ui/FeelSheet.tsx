// The temperature-band map (seven days × five bands) and its trend, opened from the table's
// 肌感 row: it is all about 肌感, so it lives next to it rather than among the graph tabs.

import { useContext, useEffect } from "react";
import type { WeatherStore } from "../data/store";
import { BandMap, bandMapDays } from "./BandMap";
import { FeelContext, LEVEL_COLORS } from "./FeelBar";
import { LEVELS } from "../../shared/feel";
import { ModalSheet, SheetCloseButton } from "./ModalSheet";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (date: string) => string | null;
  onClose: () => void;
}

export function FeelSheet({ store, station, target, partner, onClose }: Props) {
  const settings = useContext(FeelContext);
  useEffect(() => {
    if (!store) return;
    store.wantHours(station, bandMapDays(target, partner), 0, "feelmap");
    return () => store.wantHours(station, [], 0, "feelmap");
  }, [store, station, target, partner]);

  return (
    <ModalSheet label="肌感マップ" onClose={onClose} className="feel-sheet">
      <header className="day-head">
        <h2>肌感（{settings.sun ? "日なた温度" : "日かげ温度"}）</h2>
        <SheetCloseButton />
      </header>
      {/* The colours are explained here, where they are read closely. */}
      <p className="feel-legend sheet-legend">
        {LEVELS.map((label, i) => (
          <span key={label}>
            <i style={{ background: LEVEL_COLORS[i] }} />
            {label}
          </span>
        ))}
        <span>
          <i className="dashed" />
          目安（日別の値から）
        </span>
      </p>
      <BandMap store={store} station={station} target={target} partner={partner} />
    </ModalSheet>
  );
}
