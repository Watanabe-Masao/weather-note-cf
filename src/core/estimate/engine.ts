// 推測値の形 (docs/engineering-principles.md 2, 5): a formula is only a shape; its numbers come from
// a parameter set with a name, a unit and a basis for each. A value is there or says why it is not.
// No engine beyond that: needs present and in range → compute, else the reason (KISS).

/** Why a value is not there, in the material (material.ts Absence) or in an estimate. */
export type Reason = string;

/** One input or one result: a number, or why there is none. */
export type Value = { value: number } | { absent: Reason };

/** A run of values, newest first (index 0 = the day before): each a number or why there is none. */
export interface Series {
  series: Value[];
}

export const has = (v: Value | Estimate | undefined): v is { value: number } => v != null && "value" in v;

/** A number with what it is and where it comes from (principles 5). */
export interface Param {
  value: number;
  unit: string;
  basis: string;
}

/** Inclusive `min`/`max`; `above` is exclusive (a height must be more than 0, not 0). */
export interface Range {
  min?: number;
  max?: number;
  above?: number;
}

/** Too little of a series to say anything (principles 2): what was there against what is needed. */
export interface Shortage {
  have: number;
  need: number;
  /** What the two numbers count ("日", "重みの割合"). */
  of: string;
}

/** A series as `compute` sees it: the numbers by position, null where a day has none. */
export type Run = readonly (number | null)[];

/** The inputs as `compute` sees them: numbers, and null for an optional need that is not there. */
export type Inputs<N extends string, O extends string> = { [K in N]: K extends O ? number | null : number };

export interface Formula<N extends string, P extends string, S extends string = never, O extends N = never> {
  /** The estimate's name; issues and notes call it by this. */
  id: string;
  /** Raised when the formula's shape changes. The old version is kept, not rewritten (principles 5). */
  version: number;
  /** How other formulas name this one in their `needs`. */
  key: string;
  label: string;
  unit: string;
  /** Material or other estimates it is computed from: the only way in. */
  needs: readonly N[];
  /**
   * Needs that more than one formula can fill, and which (by key): the same shape, swapped by the
   * caller (principles 8 LSP) — 慣れ-L1 or 慣れ-L2 into the same boundary shift. The map draws each.
   */
  choices?: Partial<Record<N, readonly string[]>>;
  /**
   * Needs that are not always needed: when one is not there, compute gets null for it — unless
   * `required` says that, with the others as they are, it is needed after all; then the result is
   * missingInput with its own reason. (日照 matters only while the sun can shine: at night JMA's blank
   * cell is no loss.)
   */
  optional?: readonly O[];
  required?: (x: Inputs<N, O>, p: Record<P, number>) => readonly O[];
  /** Runs of past values it is computed from (newest first). */
  series?: readonly S[];
  /** The names of the numbers it uses. */
  params: readonly P[];
  /** Where the formula holds; outside it the result is outOfDomain, never clamped. */
  domain?: Partial<Record<N, Range>>;
  /** Whether a series has enough in it: null when it has, else what is short. Checked before compute. */
  enough?: (s: Record<S, Run>, p: Record<P, number>) => Shortage | null;
  /** Called only with every need present, in range, and every series enough. */
  compute: (x: Inputs<N, O>, p: Record<P, number>, s: Record<S, Run>) => number;
}

/** Any formula, for lists of formulas of different shapes (the map): what can be read of one. */
export interface AnyFormula {
  id: string;
  version: number;
  key: string;
  label: string;
  unit: string;
  needs: readonly string[];
  choices?: Partial<Record<string, readonly string[]>>;
  optional?: readonly string[];
  series?: readonly string[];
  params: readonly string[];
  compute: unknown;
}

export interface ParamSet<P extends string> {
  /** Which set of numbers ("standard", "settings", or a learned fit's name). */
  id: string;
  /** Raised when a number changes. */
  version: number;
  values: Record<P, Param>;
}

export function defineFormula<N extends string, P extends string, S extends string = never, O extends N = never>(f: Formula<N, P, S, O>): Formula<N, P, S, O> {
  return f;
}

/** A set of numbers for a formula: its names must be the formula's (the formula is only for the type). */
export function defineParams<P extends string>(_formula: { params: readonly P[] }, set: ParamSet<P>): ParamSet<P> {
  return set;
}

/** What made a value: every formula and parameter set on the way, in order. */
export interface Step {
  formula: string;
  params: string;
  /** The numbers as used: a set made from settings has the same id and version for any setting. */
  values: Record<string, number>;
}

export type Estimate =
  | { value: number; trace: Step[] }
  | { absent: "missingInput"; inputs: Record<string, Reason>; trace: Step[] }
  | { absent: "outOfDomain"; input: string; got: number; range: Range; trace: Step[] }
  | { absent: "tooShort"; input: string; shortage: Shortage; trace: Step[] };

const tag = (id: string, version: number) => `${id}@${version}`;

/**
 * Compute one formula from its inputs. Inputs that are estimates bring their trace along, so the
 * result names everything it was made from (principles 5: both the formula and the set, by version).
 */
export function evaluate<N extends string, P extends string, S extends string = never, O extends N = never>(
  f: Formula<N, P, S, O>,
  set: ParamSet<P>,
  inputs: Record<N, Value | Estimate> & Record<S, Series>,
): Estimate {
  const p = {} as Record<P, number>;
  for (const k of f.params) p[k] = set.values[k].value;
  const before = f.needs.flatMap((n) => (inputs[n] && "trace" in inputs[n] ? (inputs[n] as Estimate).trace : []));
  const trace = [...before, { formula: tag(f.id, f.version), params: tag(set.id, set.version), values: { ...p } }];
  const missing: Record<string, Reason> = {};
  const optional = new Set<string>(f.optional ?? []);
  const reasonOf = (n: N): Reason => {
    const v = inputs[n] as Value | Estimate | undefined;
    return v && "absent" in v ? v.absent : "notProvided";
  };
  for (const n of f.needs) {
    const v = inputs[n] as Value | Estimate | undefined;
    if (has(v) || optional.has(n)) continue;
    // An estimate that is itself missing inputs passes down which ones ("windPerson.wind"), so the
    // reason reaches the material it started from.
    if (v && "absent" in v && v.absent === "missingInput" && "inputs" in v) for (const [k, r] of Object.entries(v.inputs)) missing[`${n}.${k}`] = r;
    else if (!(v && "absent" in v && (v.absent === "outOfDomain" || v.absent === "tooShort"))) missing[n] = v && "absent" in v ? v.absent : "notProvided";
  }
  for (const s of f.series ?? []) if (!inputs[s]) missing[s] = "notProvided";
  if (Object.keys(missing).length) return { absent: "missingInput", inputs: missing, trace };
  // An estimate input out of its range or too short: so is the result, at the same place.
  for (const n of f.needs) {
    const v = inputs[n] as Value | Estimate | undefined;
    if (!optional.has(n) && v && "absent" in v && "input" in v) return { ...v, input: `${n}.${v.input}`, trace };
  }
  const x = {} as Record<N, number | null>;
  for (const n of f.needs) {
    const given = inputs[n] as Value | Estimate | undefined;
    if (!has(given)) {
      x[n] = null; // only an optional need gets here
      continue;
    }
    const v = given.value;
    const r = f.domain?.[n];
    if (r && ((r.min != null && v < r.min) || (r.max != null && v > r.max) || (r.above != null && v <= r.above))) return { absent: "outOfDomain", input: n, got: v, range: r, trace };
    x[n] = v;
  }
  const needed = f.required?.(x as Inputs<N, O>, p).filter((n) => x[n] == null) ?? [];
  if (needed.length) return { absent: "missingInput", inputs: Object.fromEntries(needed.map((n) => [n, reasonOf(n)])), trace };
  const runs = {} as Record<S, Run>;
  for (const s of f.series ?? []) runs[s] = (inputs[s] as Series).series.map((v) => (has(v) ? v.value : null));
  const short = f.enough?.(runs, p);
  if (short) return { absent: "tooShort", input: (f.series ?? []).join(","), shortage: short, trace };
  return { value: f.compute(x as Inputs<N, O>, p, runs), trace };
}
