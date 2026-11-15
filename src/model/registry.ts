// The model system (#189): parts (部品) that compute one quantity each, drivers (要因) that put
// parts into a model's terms, recipes (レシピ) that say which drivers move what in a learned model,
// and rules (決まり) that use parts without learning (従来版's boundaries). Everything is registered
// so the map (docs/model-map.md) is written from it and the rules are checked on it:
//
//   - every input is registered, with no cycles
//   - データの原則: a part in use reads weather only from sources that both records and forecasts have,
//     except the gaps registered with their issue
//   - a driver says how learning builds it (from what a report stored when it was sent) and how a
//     day's prediction builds it (from the store); where the two differ, the difference is named
//
// S1 (#191): a description of the calculation as it is — `impl` points at the code, and this module
// imports from src/beta, so it cannot be the source of truth yet. In S2 the direction turns: the
// calculation moves into the parts, and src/beta imports from here.

export type Status = "使用中" | "候補" | "表示用";

/**
 * What kind of thing a source is. Only 気象 falls under データの原則 (records and forecasts both).
 * 答え: what the person answered (exists only on a report). 設定: the person's settings.
 * 計算: worked out from the date and the place.
 */
export type SourceKind = "気象" | "答え" | "設定" | "計算";

export interface Source {
  id: string;
  label: string;
  kind: SourceKind;
  /** 気象: which data carries it, records (気象庁) and/or forecasts (Open-Meteo). */
  record?: boolean;
  forecast?: boolean;
  note?: string;
}

export type Family = "太陽" | "時刻" | "雲" | "日射" | "肌感" | "日" | "慣れ" | "変化" | "余熱" | "空";

/** A value a part takes that is not an input: fixed, or learned (by which model). */
export interface Param {
  name: string;
  value: string;
  learnedBy?: string;
}

/** A part: one quantity, from sources and other parts. */
export interface Part {
  id: string;
  label: string;
  family: Family;
  status: Status;
  /** Ids of sources or parts. */
  inputs: string[];
  unit: string;
  /** How far back it looks, and what it needs to give a value, in words. */
  span?: string;
  params?: Param[];
  /** Where the calculation lives now (file and function). */
  impl: string;
  /** Issues it is tied to (132 → #132; numbers, so no "#…" string reads as a colour). */
  issues?: number[];
  note?: string;
  /** A known gap of データの原則: the issue that settles it. */
  ruleGap?: number;
}

/** One way a driver is built: from which parts (or sources), where. */
export interface DriverPath {
  from: string[];
  impl: string;
  /** Learning reads the value the report stored when it was sent (MATH-06), not a recomputed one. */
  stored?: boolean;
}

/** A driver: parts put into a model's terms (a difference, a unit). */
export interface Driver {
  key: string;
  label: string;
  unit: string;
  /** Built for learning (from saved reports). */
  learn: DriverPath;
  /** Built for a day's prediction (from the store), or null when there is none. */
  predict: DriverPath | null;
  /** How the two paths differ, when they do (shown in the map; a test keeps the list). */
  differs?: string;
}

/** What a driver moves in a learned model: the comfort centre, the range's width, or the place temperature (MATH-04). */
export type Role = "中心" | "幅" | "場所";

/** A recipe: a learned model, as which drivers move what. */
export interface Recipe {
  id: string;
  label: string;
  family: "温冷感" | "選好";
  /** Drivers every model of the family reads (the place temperature, the felt wind…). */
  base: string[];
  roles: Partial<Record<Role, string[]>>;
  impl: string;
  note?: string;
}

/** A rule: parts used by a fixed rule, without learning (従来版's boundaries). */
export interface Rule {
  id: string;
  label: string;
  reads: string[];
  params?: Param[];
  impl: string;
  note?: string;
}

export interface Catalog {
  /** The one version of the learned models (recipes, how drivers are built, starting points). */
  modelVersion: string;
  sources: Source[];
  parts: Part[];
  drivers: Driver[];
  recipes: Recipe[];
  rules: Rule[];
}

/** Problems with a catalog (empty: all good). */
export function validate(c: Catalog): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const id of [...c.sources.map((s) => s.id), ...c.parts.map((p) => p.id)]) {
    if (ids.has(id)) out.push(`ID が重複：${id}`);
    ids.add(id);
  }
  for (const s of c.sources) if (s.kind === "気象" && (s.record == null || s.forecast == null)) out.push(`気象の入力 ${s.id} に実績・予報の別がない`);
  const parts = new Map(c.parts.map((p) => [p.id, p]));
  for (const p of c.parts) for (const i of p.inputs) if (!ids.has(i)) out.push(`${p.id} の入力 ${i} が登録にない`);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) return void out.push(`循環：${[...path, id].join(" → ")}`);
    state.set(id, 1);
    for (const i of parts.get(id)?.inputs ?? []) visit(i, [...path, id]);
    state.set(id, 2);
  };
  for (const p of c.parts) visit(p.id, []);
  const keys = new Set(c.drivers.map((d) => d.key));
  for (const d of c.drivers)
    for (const path of [d.learn, d.predict]) for (const f of path?.from ?? []) if (!ids.has(f)) out.push(`要因 ${d.key} の ${f} が登録にない`);
  for (const d of c.drivers) {
    const same = d.predict != null && [...d.learn.from].sort().join() === [...d.predict.from].sort().join() && !d.learn.stored;
    if (!same && !d.differs) out.push(`要因 ${d.key}：学習と予測の作り方が違うのに、違いが書かれていない`);
  }
  for (const r of c.recipes) for (const k of [...r.base, ...Object.values(r.roles).flat()]) if (!keys.has(k!)) out.push(`レシピ ${r.id} の要因 ${k} が登録にない`);
  for (const r of c.rules) for (const p of r.reads) if (!ids.has(p)) out.push(`決まり ${r.id} の ${p} が登録にない`);
  return out;
}

/** The sources an id reads in the end (through its parts). */
export function leaves(c: Catalog, id: string, seen = new Set<string>()): Source[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const s = c.sources.find((x) => x.id === id);
  if (s) return [s];
  return (c.parts.find((x) => x.id === id)?.inputs ?? []).flatMap((i) => leaves(c, i, seen));
}

const onlyOne = (s: Source) => s.kind === "気象" && !(s.record && s.forecast);

/**
 * データの原則: parts in use, and the prediction path of every driver, whose weather sources are not
 * in both records and forecasts. A part may do so only when it names the issue (`ruleGap`).
 */
export function ruleGaps(c: Catalog): { what: string; sources: string[]; known?: number }[] {
  const gapOf = (ids: string[]) => [...new Set(ids.flatMap((i) => leaves(c, i)).filter(onlyOne).map((s) => s.id))];
  const known = (ids: string[]) => {
    const ps = ids.flatMap(function walk(i): Part[] {
      const p = c.parts.find((x) => x.id === i);
      return p ? [p, ...p.inputs.flatMap(walk)] : [];
    });
    return ps.find((p) => p.ruleGap)?.ruleGap;
  };
  const parts = c.parts.filter((p) => p.status === "使用中").flatMap((p) => {
    const s = gapOf([p.id]);
    return s.length ? [{ what: p.id, sources: s, known: p.ruleGap ?? known(p.inputs) }] : [];
  });
  const drivers = c.drivers.flatMap((d) => {
    const s = d.predict ? gapOf(d.predict.from) : [];
    return s.length ? [{ what: `要因 ${d.key}`, sources: s, known: known(d.predict!.from) }] : [];
  });
  return [...parts, ...drivers];
}
