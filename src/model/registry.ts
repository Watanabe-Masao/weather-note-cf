// The model system (#189): parts (部品) that compute one quantity each, drivers (要因) that put a
// part's output into a model's terms, and recipes (レシピ) that say which drivers move what. A model
// is a recipe; a new candidate is one more recipe. Everything is registered here so the map
// (docs/model-map.md) is written from it, and the rules are checked on it:
//
//   - every input of a part is a source (入力) or another part, with no cycles
//   - a part in use reads only sources that both records and forecasts have (データの原則),
//     except the known gaps listed with their issue
//
// S1 (this stage): the registry describes the calculation as it is; `impl` points at the code.
// S2 moves the calculation itself into the parts (the same answers, tested); S3 switches over.

export type Status = "使用中" | "候補" | "表示用";

/** A source: a value read from the weather data, not computed here. */
export interface Source {
  id: string;
  label: string;
  /** Which kind of data carries it: records (気象庁), forecasts (Open-Meteo), both, or calculated. */
  record: boolean;
  forecast: boolean;
  note?: string;
}

export type Family = "太陽" | "雲" | "日射" | "肌感" | "日" | "慣れ" | "変化" | "余熱" | "時刻" | "空";

/** A part: one quantity, from sources and other parts. */
export interface Part {
  id: string;
  label: string;
  family: Family;
  status: Status;
  /** Ids of sources or parts. */
  inputs: string[];
  unit: string;
  /** How far back it looks (a period in words), when it looks back. */
  span?: string;
  /** Where the calculation lives now (file and function). */
  impl: string;
  /** Issues it is tied to (132 → #132; numbers, so no "#…" string reads as a colour). */
  issues?: number[];
  /** A point to keep in mind (a known gap, an open question). */
  note?: string;
  /** A known gap of the data rule (records and forecasts both): the issue that settles it. */
  ruleGap?: number;
}

/** A driver: a part's output in a model's terms (a difference, a unit). */
export interface Driver {
  key: string;
  label: string;
  /** The parts it is made from. */
  from: string[];
  unit: string;
  /** How it is made from the parts, in words. */
  how: string;
}

/** What a driver moves in a model: the comfort centre, the range's width, or the place temperature itself (MATH-04). */
export type Role = "中心" | "幅" | "場所";

/** A recipe: a model as which drivers move what, on which 肌感. */
export interface Recipe {
  id: string;
  label: string;
  status: Status;
  /** Fixed values (従来版) or learned from the reports (β). */
  kind: "固定" | "学習";
  /** The 肌感 part it reads. */
  base: string;
  roles: Partial<Record<Role, string[]>>;
  /** Parts read directly (not through a driver), e.g. 従来版's season shift. */
  parts?: string[];
  version: string;
  impl: string;
  note?: string;
}

export interface Catalog {
  sources: Source[];
  parts: Part[];
  drivers: Driver[];
  recipes: Recipe[];
}

/** Problems with a catalog (empty: all good). */
export function validate(c: Catalog): string[] {
  const out: string[] = [];
  const ids = new Map<string, string>();
  for (const x of [...c.sources.map((s) => ({ id: s.id, kind: "入力" })), ...c.parts.map((p) => ({ id: p.id, kind: "部品" }))]) {
    if (ids.has(x.id)) out.push(`ID が重複：${x.id}`);
    ids.set(x.id, x.kind);
  }
  const parts = new Map(c.parts.map((p) => [p.id, p]));
  for (const p of c.parts) for (const i of p.inputs) if (!ids.has(i)) out.push(`${p.id} の入力 ${i} が登録にない`);
  // No cycles.
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) return void out.push(`循環：${[...path, id].join(" → ")}`);
    state.set(id, 1);
    for (const i of parts.get(id)?.inputs ?? []) visit(i, [...path, id]);
    state.set(id, 2);
  };
  for (const p of c.parts) visit(p.id, []);
  const driverKeys = new Set(c.drivers.map((d) => d.key));
  for (const d of c.drivers) for (const f of d.from) if (!parts.has(f)) out.push(`要因 ${d.key} の部品 ${f} が登録にない`);
  for (const r of c.recipes) {
    if (!parts.has(r.base)) out.push(`レシピ ${r.id} の肌感 ${r.base} が登録にない`);
    for (const k of Object.values(r.roles).flat()) if (!driverKeys.has(k!)) out.push(`レシピ ${r.id} の要因 ${k} が登録にない`);
    for (const p of r.parts ?? []) if (!parts.has(p)) out.push(`レシピ ${r.id} の部品 ${p} が登録にない`);
  }
  return out;
}

/** The sources a part reads in the end (through its parts). */
export function leaves(c: Catalog, id: string, seen = new Set<string>()): Source[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const s = c.sources.find((x) => x.id === id);
  if (s) return [s];
  const p = c.parts.find((x) => x.id === id);
  return (p?.inputs ?? []).flatMap((i) => leaves(c, i, seen));
}

/**
 * データの原則: a part in use whose sources are not in both records and forecasts. A part may
 * read a record-only and a forecast-only source together as one quantity only when it says so
 * (`ruleGap`, with the issue that settles it).
 */
export function ruleGaps(c: Catalog): { part: string; sources: string[]; known?: number }[] {
  return c.parts
    .filter((p) => p.status === "使用中")
    .flatMap((p) => {
      const bad = leaves(c, p.id).filter((s) => !(s.record && s.forecast));
      return bad.length ? [{ part: p.id, sources: [...new Set(bad.map((s) => s.id))], known: p.ruleGap }] : [];
    });
}
