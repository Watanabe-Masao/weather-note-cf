// 似た日から選ぶ: a way of choosing the comparison day, so it opens from the compare menu.
// Picking a day makes it the comparison day and closes the sheet.

import type { WeatherStore } from "../data/store";
import { ModalSheet, SheetCloseButton, useSheetClose } from "./ModalSheet";
import { SimilarFace } from "./SimilarFace";

interface Props {
  store: WeatherStore | null;
  station: string;
  target: string;
  compareDate: string | null;
  onPick: (date: string) => void;
  onClose: () => void;
}

function Body({ store, station, target, compareDate, onPick }: Omit<Props, "onClose">) {
  const close = useSheetClose();
  return (
    <SimilarFace
      store={store}
      station={station}
      target={target}
      compareDate={compareDate}
      onPick={(d) => {
        onPick(d);
        close();
      }}
    />
  );
}

export function SimilarSheet({ onClose, ...props }: Props) {
  return (
    <ModalSheet label="似た日" onClose={onClose} className="similar-sheet">
      <header className="day-head">
        <h2>似た日から選ぶ</h2>
        <SheetCloseButton />
      </header>
      <Body {...props} />
    </ModalSheet>
  );
}
