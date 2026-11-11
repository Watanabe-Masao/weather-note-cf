// The temperature-band map (seven days × five bands) and its trend, opened from the table's
// 肌感 row: it is all about 肌感, so it lives next to it rather than among the graph tabs.

import { useContext, useEffect } from "react";
import type { WeatherStore } from "../data/store";
import { BandMap, bandMapDays } from "./BandMap";
import { FeelContext } from "./FeelBar";
import { ModalSheet } from "./ModalSheet";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  partner: (date: string) => string | null;
  /** A/B（feelSwipe）: swipe the map sideways to move the target day. */
  onStep?: (days: number) => void;
  onClose: () => void;
}

export function FeelSheet({ store, station, target, partner, onStep, onClose }: Props) {
  const settings = useContext(FeelContext);
  useEffect(() => {
    if (!store) return;
    store.wantHours(station, bandMapDays(target, partner), 0, "feelmap");
    return () => store.wantHours(station, [], 0, "feelmap");
  }, [store, station, target, partner]);

  return (
    <ModalSheet title={`肌感マップ（${settings.sun ? "日なた温度" : "日かげ温度"}）`} onClose={onClose} className="feel-sheet">
      <BandMap store={store} station={station} target={target} partner={partner} onStep={onStep} />
    </ModalSheet>
  );
}
