// Line icons (1.6 px strokes, round caps) so controls share one drawing style.

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const GearIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden {...base}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    <circle cx="10" cy="10" r="5.4" />
  </svg>
);

export const ExpandIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden {...base}>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </svg>
);

export const ShrinkIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden {...base}>
    <path d="M13.5 6.5h-4v-4M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14" />
  </svg>
);

export const ChevronIcon = ({ dir = "left" }: { dir?: "left" | "right" }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden {...base} style={dir === "right" ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M10 3 5 8l5 5" />
  </svg>
);

/** Chain (linked) or broken chain (separate). */
export const LinkIcon = ({ linked }: { linked: boolean }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden {...base}>
    {linked ? (
      <path d="M6.5 9.5l3-3M5.2 7.3 3.8 8.7a2.3 2.3 0 0 0 3.3 3.3l1.4-1.4M10.8 8.7l1.4-1.4a2.3 2.3 0 0 0-3.3-3.3L7.5 5.4" />
    ) : (
      <path d="M5.2 7.3 3.8 8.7a2.3 2.3 0 0 0 3.3 3.3l1.4-1.4M10.8 8.7l1.4-1.4a2.3 2.3 0 0 0-3.3-3.3L7.5 5.4M3 3l1.5 1.5M13 13l-1.5-1.5" />
    )}
  </svg>
);
