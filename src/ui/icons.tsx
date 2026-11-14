// Control icons, drawn from Lucide (https://lucide.dev, lucide-static 1.64.0; ISC licence below) so
// every control shares one line: a 24-unit grid, round caps, a 2-unit stroke. Copied as paths, not a
// package (#151: no new dependency). The weather pictures are the app's own (WeatherIcon): filled,
// in the sky's colours, read at a glance in a dense table, which Lucide's outlines are not.
//
// ISC License — Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify,
// and/or distribute this software for any purpose with or without fee is hereby granted, provided
// that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS
// PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
// SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF
// USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING
// OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import type { ReactNode } from "react";

const Line = ({ size, children, flip }: { size: number; children: ReactNode; flip?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: "block", flex: "none", ...(flip ? { transform: "scaleX(-1)" } : {}) }}
  >
    {children}
  </svg>
);

export const GearIcon = () => (
  <Line size={20}>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </Line>
);

export const ExpandIcon = () => (
  <Line size={16}>
    <path d="M15 3h6v6M21 3l-7 7M3 21l7-7M9 21H3v-6" />
  </Line>
);

export const ShrinkIcon = () => (
  <Line size={16}>
    <path d="M14 10l7-7M20 10h-6V4M3 21l7-7M4 14h6v6" />
  </Line>
);

/** ‹ for 戻る and the calendar's months (Lucide chevron-left; right is its mirror). */
export const ChevronIcon = ({ dir = "left", size = 18 }: { dir?: "left" | "right"; size?: number }) => (
  <Line size={size} flip={dir === "right"}>
    <path d="M15 18l-6-6 6-6" />
  </Line>
);

/** Chain (linked) or broken chain (separate). */
export const LinkIcon = ({ linked }: { linked: boolean }) => (
  <Line size={14}>
    {linked ? (
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    ) : (
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-.12-7.07 5 5 0 0 0-6.95 0l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 .12 7.07 5 5 0 0 0 6.95 0l1.71-1.71M8 2v3M2 8h3M16 19v3M19 16h3" />
    )}
  </Line>
);

export const CloseIcon = () => (
  <Line size={16}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Line>
);

/** Each item's picture beside its sheet title (気温の日別 …), in the quiet ink: colour stays with the data. */
const ITEM: Record<string, string> = {
  temp: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
  rain: "M12 13v7a2 2 0 0 0 4 0M12 2v2M20.992 13a1 1 0 0 0 .97-1.274 10.284 10.284 0 0 0-19.923 0A1 1 0 0 0 3 13z",
  radiation: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  light: "M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",
  humidity: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  wind: "M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2",
  pressure: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
};
export const ItemIcon = ({ id }: { id: string }) =>
  ITEM[id] ? (
    <span className="item-icon">
      <Line size={18}>
        <path d={ITEM[id]} />
      </Line>
    </span>
  ) : null;
