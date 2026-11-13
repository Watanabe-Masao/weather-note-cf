// The weather data store (spec chapter 2).
//
// Two kinds of data:
//   fixed    – 3+ days old with the full JMA record. Fetched once, kept forever.
//   variable – everything else. Fetched at most once per session; a new session starts on
//              reload, when the date changes, or when the user presses refresh.
//
// Four rules:
//   1. A day already seen is never fetched again (memory, then IndexedDB).
//   2. The direction of travel is fetched first (plan.ts).
//   3. While a gesture is in progress, nothing on screen changes: notifications are held.
//   4. Navigating never refreshes variable data; only missing days are fetched.

import { addDays, daysBetween, FIRST_DAY, jstToday, monthOf } from "../../shared/dates";
import { type Correction, CORRECTIONS, correctionRev } from "../../shared/corrections";
import { inRevalidation, isFixedDay, isFixedHourlyDay } from "../../shared/fixed";
import type { DailyMonthResponse, HourlyResponse, WeatherRow } from "../../shared/types";
import { decideDay, decideHours, fillFrom } from "./authority";
import { DATA_VERSION, type DayRecord, type HourRecord, type Kind, type Storage } from "./db";
import { type Direction, isRecent, lastDay, Priority, sourceFor, viewPlan } from "./plan";
import { RequestQueue } from "./queue";

export const RETRY_DELAYS = [5_000, 30_000, 120_000];
export const MAX_HOURLY_SPAN = 14;
// Per data version: a version change empties the store on purpose, which is not a loss.
const LAST_COUNT_KEY = `weather-note:last-count:v${DATA_VERSION}`;

export type FetchJson = <T>(path: string) => Promise<T>;

export interface DayView {
  date: string;
  /**
   * empty: not loaded yet (show a skeleton) · ready: loaded (row null = the source has no record) ·
   * error: the last request failed · outside: before 1977 or after the last forecast day (never loads).
   */
  state: "empty" | "ready" | "error" | "outside";
  row: WeatherRow | null;
  kind: Kind | null;
  error?: string;
  /** When the held copy was fetched (ms). */
  fetchedAt?: number;
}

export interface HourView {
  date: string;
  state: "empty" | "ready" | "error" | "outside";
  rows: WeatherRow[];
  kind: Kind | null;
  error?: string;
  /** When the held copy was fetched (ms). */
  fetchedAt?: number;
}

export interface StorageReport {
  days: number;
  hours: number;
  firstSavedAt: number | null;
  lastSavedAt: number | null;
  persisted: "granted" | "denied" | "unsupported";
  /** Set when the stored data was found empty although the last session had saved some. */
  lostSince: number | null;
}

export interface StoreOptions {
  storage: Storage;
  fetchJson: FetchJson;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  localStore?: Pick<globalThis.Storage, "getItem" | "setItem"> | null;
  persist?: () => Promise<boolean>;
  /** The corrections ledger (default: shared/corrections.ts; tests pass their own). */
  corrections?: Correction[];
}

interface Task {
  key: string;
  channel: "jma" | "forecast";
  priority: number;
  days: string[]; // day keys the task fills, for error reporting
  /** `at`: when the request was made; `gen`: the store generation it belongs to. */
  run: (ctx: RunContext) => Promise<void>;
}

interface RunContext {
  at: number;
  gen: number;
  session: number;
}

const dayKey = (station: string, date: string) => `${station}/${date}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class WeatherStore {
  private days = new Map<string, DayRecord>();
  private hours = new Map<string, HourRecord>();
  private looked = new Set<string>(); // day/hour keys already looked up in storage
  private fresh = new Set<string>(); // task keys completed in this session
  private errors = new Map<string, string>(); // "d:" / "h:" + key -> message
  private blocked = new Map<string, { until: number; attempt: number }>(); // task key -> retry state
  private timers = new Set<unknown>();
  private listeners = new Set<() => void>();
  private holding = false;
  private dirty = false;
  private scheduled = false;
  private latest = new Map<string, WeatherRow>(); // station -> latest observation today
  private view: { station: string; centers: string[]; direction: Direction } | null = null;
  private extra = new Map<string, Map<string, { station: string; priority: number }>>(); // owner -> dayKey -> request
  private hourRequests = new Map<string, Map<string, number>>(); // owner -> hour dayKey -> priority
  private persisted: StorageReport["persisted"] = "unsupported";
  private lostSince: number | null = null;
  private countTimer: unknown = null;

  readonly queue = new RequestQueue();
  today: string;
  /** Number of network requests started (for tests and the check page). */
  requests = 0;
  /** Bumped by 保存データを消去: answers to requests made before it are dropped. */
  private gen = 0;
  /**
   * Bumped by the refresh button, a new day and a clear: answers to requests made before it are
   * still saved (正本管理 decides) but do not count as this session's fetch, so the day is asked again.
   */
  private session = 0;

  private storage: Storage;
  private fetchJson: FetchJson;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (id: unknown) => void;
  private localStore: StoreOptions["localStore"];
  private persist?: () => Promise<boolean>;
  private corrections: Correction[];

  constructor(options: StoreOptions) {
    this.storage = options.storage;
    this.fetchJson = options.fetchJson;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as number));
    this.localStore = options.localStore ?? null;
    this.persist = options.persist;
    this.corrections = options.corrections ?? CORRECTIONS;
    this.today = jstToday(this.now());
  }

  // ---- lifecycle -------------------------------------------------------------------------

  /** Ask the browser to keep our data, remove past forecasts, and note whether stored data vanished. */
  async start(): Promise<void> {
    if (this.persist) {
      try {
        this.persisted = (await this.persist()) ? "granted" : "denied";
      } catch {
        this.persisted = "denied";
      }
    }
    await this.prunePastForecasts();
    const { days } = await this.storage.count();
    const previous = Number(this.localStore?.getItem(LAST_COUNT_KEY) ?? 0);
    if (previous > 0 && days === 0) this.lostSince = previous;
    this.localStore?.setItem(LAST_COUNT_KEY, String(days));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Rule 3: hold screen updates while a finger is down; release flushes once. */
  hold(on: boolean): void {
    this.holding = on;
    if (!on && this.dirty) this.emit();
  }

  /** Start a new session for variable data (refresh button). Fixed data is untouched. */
  refresh(): void {
    this.newSession();
    this.fresh.clear();
    this.errors.clear();
    this.blocked.clear();
    this.sync();
  }

  /** Call when the app becomes visible and once a minute: a new day starts a new session. */
  async checkDate(): Promise<boolean> {
    const today = jstToday(this.now());
    if (today === this.today) return false;
    this.today = today;
    this.newSession();
    this.fresh.clear();
    this.latest.clear();
    await this.prunePastForecasts();
    this.emit();
    this.sync();
    return true;
  }

  /** Requests already running belong to the old session: new ones must not join them. */
  private newSession(): void {
    this.session++;
    this.queue.detachStarted();
  }

  async clear(): Promise<void> {
    this.gen++;
    this.newSession();
    for (const t of this.timers) this.clearTimer(t);
    this.timers.clear();
    this.queue.retain(() => false);
    await this.storage.clear();
    this.days.clear();
    this.hours.clear();
    this.looked.clear();
    this.fresh.clear();
    this.errors.clear();
    this.blocked.clear();
    this.latest.clear();
    this.localStore?.setItem(LAST_COUNT_KEY, "0");
    this.lostSince = null;
    this.emit();
    this.sync();
  }

  async report(): Promise<StorageReport> {
    const counts = await this.storage.count();
    return {
      ...counts,
      firstSavedAt: (await this.storage.getMeta<number>("firstSavedAt")) ?? null,
      lastSavedAt: (await this.storage.getMeta<number>("lastSavedAt")) ?? null,
      persisted: this.persisted,
      lostSince: this.lostSince,
    };
  }

  // ---- what the screen asks for ----------------------------------------------------------

  // Everything the screen asks for is declared, not accumulated: each call replaces the previous
  // request of its kind, so closed views and old stations stop costing requests.

  /** The current view: one centre (linked or one side) or two (both sides). */
  setView(station: string, centers: string[], direction: Direction = 0): void {
    if (this.view && this.view.station !== station) {
      this.extra.clear();
      this.hourRequests.clear();
    }
    this.view = { station, centers, direction };
    this.sync();
  }

  /**
   * Extra days to have ready, declared by one part of the screen (`owner`): the comparison presets
   * when idle, or 条件から選ぶ. Replaces that owner's previous request; [] cancels it.
   */
  prefetch(station: string, dates: string[], owner = "presets", priority: number = Priority.Prefetch): void {
    const wanted = new Map(
      dates.filter((d) => this.inRange(d)).map((d) => [dayKey(station, d), { station, priority }] as const),
    );
    if (wanted.size) this.extra.set(owner, wanted);
    else this.extra.delete(owner);
    this.sync();
  }

  /**
   * Hourly data wanted by one part of the screen (`owner`, e.g. the table's feel row or the sheet).
   * Replaces that owner's previous request; [] withdraws it. Owners do not cancel each other.
   */
  wantHours(station: string, dates: string[], priority: number = Priority.Visible, owner = "sheet"): void {
    const wanted = new Map(dates.filter((d) => this.inRange(d)).map((d) => [dayKey(station, d), priority] as const));
    if (wanted.size) this.hourRequests.set(owner, wanted);
    else this.hourRequests.delete(owner);
    this.sync();
  }

  /** All owners' hour requests, keeping the highest priority for each day. */
  private get hourWants(): Map<string, number> {
    const out = new Map<string, number>();
    for (const requests of this.hourRequests.values())
      for (const [k, p] of requests) if (!out.has(k) || out.get(k)! > p) out.set(k, p);
    return out;
  }

  /** Days that can have data: from 1977 to the last forecast day. */
  inRange(date: string): boolean {
    return date >= FIRST_DAY && date <= lastDay(this.today);
  }

  getDay(station: string, date: string): DayView {
    if (!this.inRange(date)) return { date, state: "outside", row: null, kind: null };
    const k = dayKey(station, date);
    const rec = this.days.get(k);
    if (rec) return { date, state: "ready", row: rec.row, kind: rec.kind };
    const error = this.errors.get("d:" + k);
    return { date, state: error ? "error" : "empty", row: null, kind: null, error };
  }

  getHours(station: string, date: string): HourView {
    if (!this.inRange(date)) return { date, state: "outside", rows: [], kind: null };
    const k = dayKey(station, date);
    const rec = this.hours.get(k);
    if (rec) return { date, state: "ready", rows: rec.rows, kind: rec.kind, fetchedAt: rec.fetchedAt };
    const error = this.errors.get("h:" + k);
    return { date, state: error ? "error" : "empty", rows: [], kind: null, error };
  }

  getLatest(station: string): WeatherRow | null {
    return this.latest.get(station) ?? null;
  }

  /** Days whose daily or hourly values failed to load (for the status bar). */
  failedDays(): number {
    return new Set([...this.errors.keys()].map((k) => k.slice(2))).size;
  }

  /** The status bar's 再試行, and coming back online: try every failed request again now. */
  retryAll(): void {
    this.errors.clear();
    this.blocked.clear();
    this.emit();
    this.sync();
  }

  /** Tap on a failed cell: try again now. */
  retryDay(station: string, date: string): void {
    const k = dayKey(station, date);
    this.errors.delete("d:" + k);
    this.errors.delete("h:" + k);
    for (const [task] of this.blocked) if (task.split(":")[1] === station) this.blocked.delete(task);
    this.emit();
    this.sync();
  }

  // ---- planning --------------------------------------------------------------------------

  private wantedDays(): Map<string, { station: string; date: string; priority: number }> {
    const out = new Map<string, { station: string; date: string; priority: number }>();
    const put = (station: string, date: string, priority: number) => {
      const k = dayKey(station, date);
      const old = out.get(k);
      if (!old || old.priority > priority) out.set(k, { station, date, priority });
    };
    if (this.view) {
      for (const [date, p] of viewPlan(this.view.centers, this.view.direction, this.today))
        put(this.view.station, date, p);
    }
    for (const requests of this.extra.values())
      for (const [k, v] of requests) put(v.station, k.slice(k.indexOf("/") + 1), v.priority);
    return out;
  }

  private syncing: Promise<void> | null = null;
  private again = false;

  /** Work out which requests are needed now and queue them. Safe to call often. */
  sync(): void {
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = this.plan().finally(() => {
      this.syncing = null;
      if (this.again) {
        this.again = false;
        this.sync();
      }
    });
  }

  /** Resolves when no request is queued or running (for tests and the check page). */
  async idle(): Promise<void> {
    for (;;) {
      await this.syncing;
      await new Promise((r) => setTimeout(r, 0));
      if (!this.syncing && this.queue.pendingKeys.length === 0) return;
      await Promise.race([this.syncing, new Promise((r) => setTimeout(r, 5))]);
    }
  }

  private async plan(): Promise<void> {
    await this.hydrate([...this.wantedDays().keys()], [...this.hourWants.keys()]);
    // The screen may have declared something new while storage was read: plan from the latest
    // declaration, and leave days whose storage lookup is not done yet to the next round.
    const wanted = this.wantedDays();
    const hourWants = this.hourWants;
    const looked = (k: string) => this.looked.has(k) || this.days.has(k);
    const lookedHour = (k: string) => this.looked.has("h:" + k) || this.hours.has(k);

    const tasks = new Map<string, Task>();
    const addTask = (t: Task) => {
      const old = tasks.get(t.key);
      if (!old) tasks.set(t.key, t);
      else old.priority = Math.min(old.priority, t.priority);
    };

    for (const [k, { station, date, priority }] of wanted) {
      if (!looked(k)) continue;
      if (this.days.get(k)?.kind === "fixed" && !this.recheck(this.days.get(k)!)) continue;
      const source = sourceFor(date, this.today);
      if (source.kind === "forecast") {
        addTask(this.forecastTask(station, priority));
        if (date === this.today && priority === Priority.Visible) addTask(this.currentTask(station, priority));
        continue;
      }
      const month = this.monthTask(station, source.month, priority);
      if (!this.fresh.has(month.key)) {
        addTask(month);
        continue;
      }
      // The month is up to date; the two latest days may still need the AMeDAS summary.
      const row = this.days.get(k)?.row;
      if (isRecent(date, this.today) && (!row || (row.unpublished?.length ?? 0) > 0))
        addTask(this.recentTask(station, date, priority));
    }

    // Hourly requests: past days in runs of up to 14, today from observations, later from the forecast.
    const pastHours = new Map<string, { date: string; priority: number }[]>();
    for (const [k, priority] of hourWants) {
      if (!lookedHour(k)) continue;
      const station = k.slice(0, k.indexOf("/"));
      const date = k.slice(k.indexOf("/") + 1);
      if (this.hours.get(k)?.kind === "fixed" && !this.recheck(this.hours.get(k)!)) continue;
      if (date > this.today) {
        addTask(this.forecastTask(station, priority));
      } else if (date === this.today) {
        addTask(this.forecastTask(station, priority));
        addTask(this.currentTask(station, priority));
      } else if (!this.fresh.has(`hour:${station}:${date}`)) {
        const list = pastHours.get(station) ?? [];
        list.push({ date, priority });
        pastHours.set(station, list);
      }
    }
    for (const [station, list] of pastHours) {
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      let run: typeof list = [];
      const flush = () => {
        if (run.length) addTask(this.hourlyTask(station, run[0].date, run.at(-1)!.date, Math.min(...run.map((r) => r.priority))));
        run = [];
      };
      for (const item of list) {
        const prev = run.at(-1);
        if (prev && (addDays(prev.date, 1) !== item.date || run.length >= MAX_HOURLY_SPAN)) flush();
        run.push(item);
      }
      flush();
    }

    // Drop queued requests nobody wants any more; start the rest (unless waiting to retry).
    this.queue.retain((key) => tasks.has(key));
    const now = this.now();
    for (const t of tasks.values()) {
      if (this.fresh.has(t.key)) continue; // rule 4: at most once per session
      const wait = this.blocked.get(t.key);
      if (wait && wait.until > now) continue;
      this.queue.add(t.key, t.channel, t.priority, () => this.execute(t)).catch(() => {});
    }
  }

  /**
   * Fixed is not "never changes" (正本管理): fixed data is fetched again once per session while
   * still in its re-check period, and whenever the corrections ledger lists its day after it was
   * saved. The month/day request itself is still made at most once per session (rule 4).
   */
  private recheck(r: { station: string; date: string; rev?: number }): boolean {
    return inRevalidation(r.date, this.today) || correctionRev(r.station, r.date, r.date, this.corrections) > (r.rev ?? 0);
  }

  private async hydrate(dayKeys: string[], hourKeys: string[]): Promise<void> {
    const dk = dayKeys.filter((k) => !this.looked.has(k) && !this.days.has(k));
    const hk = hourKeys.filter((k) => !this.looked.has("h:" + k) && !this.hours.has(k));
    if (!dk.length && !hk.length) return;
    const gen = this.gen;
    const [days, hours] = await Promise.all([this.storage.getDays(dk), this.storage.getHours(hk)]);
    // Read before 保存データを消去 finished: what was read is gone, never put it back.
    if (gen !== this.gen) return;
    dk.forEach((k) => this.looked.add(k));
    hk.forEach((k) => this.looked.add("h:" + k));
    let changed = false;
    for (const r of days) {
      if (obsoleteDay(r, this.today) || this.days.has(r.key)) continue;
      this.days.set(r.key, checkedDay(r, this.today));
      changed = true;
    }
    for (const r of hours) {
      if (obsoleteHours(r, this.today) || this.hours.has(r.key)) continue;
      this.hours.set(r.key, checkedHours(r, this.today));
      changed = true;
    }
    if (changed) this.emit();
  }

  // ---- tasks -----------------------------------------------------------------------------

  private async execute(task: Task): Promise<void> {
    this.requests++;
    const ctx: RunContext = { at: this.now(), gen: this.gen, session: this.session };
    try {
      await task.run(ctx);
      // Started before a clear (result dropped) or a refresh (saved, but not this session's):
      // the new session asks again on its own.
      if (ctx.gen !== this.gen || ctx.session !== this.session) return;
      this.fresh.add(task.key);
      this.blocked.delete(task.key);
      // Clear only this kind's failures: a day's hours arriving says nothing about its daily row.
      const kind = task.key.startsWith("hourly:") ? "h:" : "d:";
      for (const k of task.days) this.errors.delete(kind + k);
      // A finished month can reveal follow-up work (the AMeDAS fill for the latest days).
      if (task.key.startsWith("daily:")) this.sync();
    } catch (e) {
      if (ctx.gen !== this.gen || ctx.session !== this.session) return; // an old session's failure
      const message = (e as Error)?.message || "取得できませんでした";
      for (const k of task.days) this.errors.set((task.key.startsWith("hourly:") ? "h:" : "d:") + k, message);
      const attempt = (this.blocked.get(task.key)?.attempt ?? 0) + 1;
      const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length) - 1];
      this.blocked.set(task.key, { until: this.now() + delay, attempt });
      const timer = this.setTimer(() => {
        this.timers.delete(timer);
        this.sync();
      }, delay);
      this.timers.add(timer);
      this.emit();
    }
  }

  private monthTask(station: string, month: string, priority: number): Task {
    const key = `daily:${station}:${month}`;
    const days = daysBetween(`${month}-01`, addDays(`${month}-01`, 30))
      .filter((d) => monthOf(d) === month)
      .map((d) => dayKey(station, d));
    return {
      key,
      channel: "jma",
      priority,
      days,
      run: async (ctx) => {
        const data = await this.fetchJson<DailyMonthResponse>(`/api/daily?station=${station}&month=${month}`);
        const byDate = new Map(data.rows.map((r) => [r.date, r]));
        const records: DayRecord[] = [];
        for (const k of days) {
          const date = k.slice(k.indexOf("/") + 1);
          if (date >= this.today) continue;
          // AMeDAS values already filling still-unpublished columns are kept by the 正本管理 rules.
          const row = byDate.get(date) ?? null;
          const fixed = row && isFixedDay(row, this.today);
          records.push(this.dayRecord(ctx, station, date, row, fixed ? "fixed" : "variable", "jma"));
        }
        await this.saveDays(records, ctx);
      },
    };
  }

  private recentTask(station: string, date: string, priority: number): Task {
    return {
      key: `recent:${station}:${date}`,
      channel: "jma",
      priority,
      days: [dayKey(station, date)],
      run: async (ctx) => {
        const data = await this.fetchJson<{ daily?: WeatherRow; rows?: WeatherRow[] }>(
          `/api/recent?station=${station}&date=${date}`,
        );
        if (!data.daily) throw new Error("速報データがありません");
        // Fills only the columns JMA has not published yet (正本管理: AMeDAS ranks below JMA).
        await this.saveDays([this.dayRecord(ctx, station, date, data.daily, "variable", "recent")], ctx);
      },
    };
  }

  private forecastTask(station: string, priority: number): Task {
    const dates = daysBetween(this.today, addDays(this.today, 7));
    return {
      key: `forecast:${station}`,
      channel: "forecast",
      priority,
      days: dates.map((d) => dayKey(station, d)),
      run: async (ctx) => {
        const data = await this.fetchJson<{ rows: WeatherRow[]; hourlyRows: WeatherRow[] }>(
          `/api/forecast?station=${station}`,
        );
        await this.saveDays(
          data.rows.filter((r) => r.date >= this.today).map((r) => this.dayRecord(ctx, station, r.date, r, "variable", "forecast")),
          ctx,
        );
        const byDate = new Map<string, WeatherRow[]>();
        for (const r of data.hourlyRows ?? []) {
          if (r.date < this.today) continue;
          byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
        }
        // Observed hours (today) keep winning over forecast hours: decided hour by hour on save.
        const records = [...byDate].map(([date, rows]) => this.hourRecord(ctx, station, date, rows, "variable", "forecast"));
        await this.saveHours(records, ctx);
      },
    };
  }

  private currentTask(station: string, priority: number): Task {
    const date = this.today;
    return {
      key: `current:${station}`,
      channel: "jma",
      priority,
      days: [dayKey(station, date)],
      run: async (ctx) => {
        const data = await this.fetchJson<{ rows: WeatherRow[]; latest: WeatherRow | null }>(
          `/api/current?station=${station}`,
        );
        if (data.latest && ctx.session === this.session && ctx.gen === this.gen && !same(this.latest.get(station), data.latest)) {
          this.latest.set(station, data.latest);
          this.emit();
        }
        // Observed hours replace forecast hours; the forecast still lends solar radiation (AMeDAS has none).
        await this.saveHours([this.hourRecord(ctx, station, date, data.rows ?? [], "variable", "current")], ctx);
      },
    };
  }

  private hourlyTask(station: string, from: string, to: string, priority: number): Task {
    const dates = daysBetween(from, to);
    return {
      key: `hourly:${station}:${from}:${to}`,
      channel: "jma",
      priority,
      days: dates.map((d) => dayKey(station, d)),
      run: async (ctx) => {
        const data = await this.fetchJson<HourlyResponse>(`/api/hourly?station=${station}&from=${from}&to=${to}`);
        const records: HourRecord[] = [];
        let failed: string | null = null;
        for (const day of data.days) {
          const k = dayKey(station, day.date);
          const current = ctx.gen === this.gen && ctx.session === this.session;
          if (day.error) {
            if (current) this.errors.set("h:" + k, day.error);
            failed = day.error;
            continue;
          }
          const fixed = day.fixed && isFixedHourlyDay(day.date, day.rows, this.today);
          records.push(this.hourRecord(ctx, station, day.date, day.rows, fixed ? "fixed" : "variable", "jma"));
          if (current) this.fresh.add(`hour:${station}:${day.date}`);
        }
        await this.saveHours(records, ctx);
        if (failed) throw new Error(failed);
      },
    };
  }

  // ---- saving ----------------------------------------------------------------------------

  private dayRecord(ctx: RunContext, station: string, date: string, row: WeatherRow | null, kind: Kind, source: DayRecord["source"]): DayRecord {
    const rev = correctionRev(station, date, date, this.corrections);
    return { key: dayKey(station, date), station, date, row, kind, source, savedAt: this.now(), fetchedAt: ctx.at, ...(rev ? { rev } : {}) };
  }

  private hourRecord(ctx: RunContext, station: string, date: string, rows: WeatherRow[], kind: Kind, source: HourRecord["source"]): HourRecord {
    const rev = correctionRev(station, date, date, this.corrections);
    return { key: dayKey(station, date), station, date, rows, kind, source, savedAt: this.now(), fetchedAt: ctx.at, ...(rev ? { rev } : {}) };
  }

  /**
   * Every write goes through the 正本管理 rules (authority.ts): the record kept is decided from the
   * held one and the new one. Save only what changed; unchanged values neither write nor redraw.
   * Results of requests made before the last 保存データを消去 are dropped.
   */
  private async saveDays(records: DayRecord[], ctx: RunContext): Promise<void> {
    if (ctx.gen !== this.gen) return;
    const changed: DayRecord[] = [];
    for (const r of records) {
      const old = this.days.get(r.key);
      const kept = decideDay(old, r);
      if (!old || old.kind !== kept.kind || old.source !== kept.source || !same(old.row, kept.row)) changed.push(kept);
    }
    if (!changed.length) return;
    for (const r of changed) this.days.set(r.key, r);
    this.emit();
    await this.storage.putDays(changed);
    await this.noteSaved();
  }

  private async saveHours(records: HourRecord[], ctx: RunContext): Promise<void> {
    if (ctx.gen !== this.gen) return;
    const changed: HourRecord[] = [];
    for (const r of records) {
      const old = this.hours.get(r.key);
      const kept = decideHours(old, r);
      if (!old || old.kind !== kept.kind || old.source !== kept.source || !same(old.rows, kept.rows)) changed.push(kept);
    }
    if (!changed.length) return;
    for (const r of changed) this.hours.set(r.key, r);
    this.emit();
    await this.storage.putHours(changed);
    await this.noteSaved();
  }

  private async noteSaved(): Promise<void> {
    const at = this.now();
    if (!(await this.storage.getMeta<number>("firstSavedAt"))) await this.storage.setMeta("firstSavedAt", at);
    await this.storage.setMeta("lastSavedAt", at);
    if (this.localStore && !this.countTimer) {
      this.countTimer = this.setTimer(async () => {
        this.countTimer = null;
        const { days } = await this.storage.count();
        this.localStore?.setItem(LAST_COUNT_KEY, String(days));
      }, 2_000);
    }
  }

  private async prunePastForecasts(): Promise<void> {
    const dayKeys: string[] = [];
    const hourKeys: string[] = [];
    for (const [k, r] of this.days) if (obsoleteDay(r, this.today)) dayKeys.push(k);
    for (const [k, r] of this.hours) if (obsoleteHours(r, this.today)) hourKeys.push(k);
    dayKeys.forEach((k) => this.days.delete(k));
    hourKeys.forEach((k) => this.hours.delete(k));
    // Stored ones too: past forecast days have no value once the day is over.
    const all = await this.storage.allDayKeys();
    const stale = (await this.storage.getDays(all.filter((k) => k.slice(k.indexOf("/") + 1) < this.today)))
      .filter((r) => obsoleteDay(r, this.today))
      .map((r) => r.key);
    await this.storage.deleteDays([...new Set([...dayKeys, ...stale])]);
    const allHours = await this.storage.allHourKeys();
    const staleHours = (await this.storage.getHours(allHours.filter((k) => k.slice(k.indexOf("/") + 1) < this.today)))
      .filter((r) => obsoleteHours(r, this.today))
      .map((r) => r.key);
    await this.storage.deleteHours([...new Set([...hourKeys, ...staleHours])]);
  }

  private emit(): void {
    if (this.holding) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const fn of this.listeners) fn();
    });
  }
}

/** Fill columns the JMA table has not published yet with AMeDAS values (正本管理: kept for callers). */
export function mergeRecent(base: WeatherRow | null, recent: WeatherRow): WeatherRow {
  return base ? fillFrom(base, "jma", recent, "amedas") : recent;
}

/** Observed hours replace forecast hours with the same hour; the forecast lends solar radiation. */
export function mergeHours(forecast: WeatherRow[], observed: WeatherRow[]): WeatherRow[] {
  const date = (observed[0] ?? forecast[0])?.date ?? "";
  const held: HourRecord = { key: "", station: "", date, rows: forecast, kind: "variable", source: "forecast", savedAt: 0 };
  const next: HourRecord = { ...held, rows: observed, source: "current" };
  return decideHours(held, next).rows;
}

// ---- what stored data is still worth (one rule for reading back and for pruning) ----------

/** A day kept only for its forecast, once the day is over: nothing left to show. */
export function obsoleteDay(r: Pick<DayRecord, "source" | "date">, today: string): boolean {
  return r.source === "forecast" && r.date < today;
}

/** Hours of a past day that are not JMA's table (today's observations and forecast): JMA's replaces them. */
export function obsoleteHours(r: Pick<HourRecord, "source" | "date">, today: string): boolean {
  return r.source !== "jma" && r.date < today;
}

/**
 * Stored "fixed" data is checked again by today's rule when read back: data saved under an older,
 * weaker rule (before hours were checked one by one) is treated as not fixed, so it is fetched again
 * and the 正本管理 rules decide.
 */
export function checkedDay(r: DayRecord, today: string): DayRecord {
  return r.kind === "fixed" && !(r.source === "jma" && isFixedDay(r.row, today)) ? { ...r, kind: "variable" } : r;
}

export function checkedHours(r: HourRecord, today: string): HourRecord {
  return r.kind === "fixed" && !(r.source === "jma" && isFixedHourlyDay(r.date, r.rows, today)) ? { ...r, kind: "variable" } : r;
}
