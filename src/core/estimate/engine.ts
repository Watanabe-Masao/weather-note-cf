// 推測値の形 (docs/engineering-principles.md 2, 5): a formula is only a shape; its numbers come from
// a parameter set with a name, a unit and a basis for each. A value is there or says why it is not.
// No engine beyond that: needs present and in range → compute, else the reason (KISS).

/** Why a value is not there, in the material (material.ts Absence) or in an estimate. */
export type Reason = string;

/** One input or one result: a number, or why there is none. */
export type Value = { value: number } | { absent: Reason };

export const has = (v: Value | undefined): v is { value: number } => v != null && "value" in v;

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

export interface Formula<N extends string, P extends string> {
  /** The estimate's name; issues and notes call it by this. */
  id: string;
  /** Raised when the formula's shape changes. */
  version: number;
  label: string;
  unit: string;
  /** Material or other estimates it is computed from: the only way in. */
  needs: readonly N[];
  /** The names of the numbers it uses. */
  params: readonly P[];
  /** Where the formula holds; outside it the result is outOfDomain, never clamped. */
  domain?: Partial<Record<N, Range>>;
  /** Called only with every need present and in range. */
  compute: (x: Record<N, number>, p: Record<P, number>) => number;
}

export interface ParamSet<P extends string> {
  /** Which set of numbers ("standard", "settings", or a learned fit's name). */
  id: string;
  /** Raised when a number changes. */
  version: number;
  values: Record<P, Param>;
}

export function defineFormula<N extends string, P extends string>(f: Formula<N, P>): Formula<N, P> {
  return f;
}

export function defineParams<P extends string>(_formula: Formula<string, P>, set: ParamSet<P>): ParamSet<P> {
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
  | { absent: "outOfDomain"; input: string; got: number; range: Range; trace: Step[] };

const tag = (id: string, version: number) => `${id}@${version}`;

/**
 * Compute one formula from its inputs. Inputs that are estimates bring their trace along, so the
 * result names everything it was made from (principles 5: both the formula and the set, by version).
 */
export function evaluate<N extends string, P extends string>(
  f: Formula<N, P>,
  set: ParamSet<P>,
  inputs: Record<N, Value | Estimate>,
): Estimate {
  const p = {} as Record<P, number>;
  for (const k of f.params) p[k] = set.values[k].value;
  const before = f.needs.flatMap((n) => (inputs[n] && "trace" in inputs[n] ? (inputs[n] as Estimate).trace : []));
  const trace = [...before, { formula: tag(f.id, f.version), params: tag(set.id, set.version), values: { ...p } }];
  const missing: Record<string, Reason> = {};
  for (const n of f.needs) {
    const v = inputs[n];
    if (has(v)) continue;
    // An estimate that is itself missing inputs passes down which ones ("windPerson.wind"), so the
    // reason reaches the material it started from.
    if (v && "absent" in v && v.absent === "missingInput" && "inputs" in v) for (const [k, r] of Object.entries(v.inputs)) missing[`${n}.${k}`] = r;
    else if (!(v && "absent" in v && v.absent === "outOfDomain")) missing[n] = v && "absent" in v ? v.absent : "notProvided";
  }
  if (Object.keys(missing).length) return { absent: "missingInput", inputs: missing, trace };
  // An estimate input out of its range: the result is out of range too, at the same place.
  for (const n of f.needs) {
    const v = inputs[n];
    if (v && "absent" in v && v.absent === "outOfDomain" && "input" in v) return { ...v, input: `${n}.${v.input}`, trace };
  }
  const x = {} as Record<N, number>;
  for (const n of f.needs) {
    const v = (inputs[n] as { value: number }).value;
    const r = f.domain?.[n];
    if (r && ((r.min != null && v < r.min) || (r.max != null && v > r.max) || (r.above != null && v <= r.above))) return { absent: "outOfDomain", input: n, got: v, range: r, trace };
    x[n] = v;
  }
  return { value: f.compute(x, p), trace };
}
