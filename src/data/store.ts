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
import { isFixedDay, isFixedHourlyDay } from "../../shared/fixed";
import type { DailyMonthResponse, HourlyResponse, WeatherRow } from "../../shared/types";
import type { DayRecord, HourRecord, Kind, Storage } from "./db";
import { type Direction, isRecent, lastDay, Priority, sourceFor, viewPlan } from "./plan";
import { RequestQueue } from "./queue";

export const RETRY_DELAYS = [5_000, 30_000, 120_000];
export const MAX_HOURLY_SPAN = 14;
const LAST_COUNT_KEY = "weather-note:last-count";

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
}

export interface HourView {
  date: string;
  state: "empty" | "ready" | "error" | "outside";
  rows: WeatherRow[];
  kind: Kind | null;
  error?: string;
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
}

interface Task {
  key: string;
  channel: "jma" | "forecast";
  priority: number;
  days: string[]; // day keys the task fills, for error reporting
  run: () => Promise<void>;
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

  private storage: Storage;
  private fetchJson: FetchJson;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (id: unknown) => void;
  private localStore: StoreOptions["localStore"];
  private persist?: () => Promise<boolean>;

  constructor(options: StoreOptions) {
    this.storage = options.storage;
    this.fetchJson = options.fetchJson;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as number));
    this.localStore = options.localStore ?? null;
    this.persist = options.persist;
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
    this.fresh.clear();
    this.latest.clear();
    await this.prunePastForecasts();
    this.emit();
    this.sync();
    return true;
  }

  async clear(): Promise<void> {
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
   * when idle, or the similar-day search. Replaces that owner's previous request; [] cancels it.
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
    if (rec) return { date, state: "ready", rows: rec.rows, kind: rec.kind };
    const error = this.errors.get("h:" + k);
    return { date, state: error ? "error" : "empty", rows: [], kind: null, error };
  }

  getLatest(station: string): WeatherRow | null {
    return this.latest.get(station) ?? null;
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
      if (this.days.get(k)?.kind === "fixed") continue;
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
      if (this.hours.get(k)?.kind === "fixed") continue;
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

  private async hydrate(dayKeys: string[], hourKeys: string[]): Promise<void> {
    const dk = dayKeys.filter((k) => !this.looked.has(k) && !this.days.has(k));
    const hk = hourKeys.filter((k) => !this.looked.has("h:" + k) && !this.hours.has(k));
    if (!dk.length && !hk.length) return;
    const [days, hours] = await Promise.all([this.storage.getDays(dk), this.storage.getHours(hk)]);
    dk.forEach((k) => this.looked.add(k));
    hk.forEach((k) => this.looked.add("h:" + k));
    let changed = false;
    for (const r of days) {
      if (r.source === "forecast" && r.date < this.today) continue;
      if (!this.days.has(r.key)) {
        this.days.set(r.key, r);
        changed = true;
      }
    }
    for (const r of hours) {
      if (r.source === "forecast" && r.date < this.today) continue;
      if (!this.hours.has(r.key)) {
        this.hours.set(r.key, r);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  // ---- tasks -----------------------------------------------------------------------------

  private async execute(task: Task): Promise<void> {
    this.requests++;
    try {
      await task.run();
      this.fresh.add(task.key);
      this.blocked.delete(task.key);
      for (const k of task.days) {
        this.errors.delete("d:" + k);
        this.errors.delete("h:" + k);
      }
      // A finished month can reveal follow-up work (the AMeDAS fill for the latest days).
      if (task.key.startsWith("daily:")) this.sync();
    } catch (e) {
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
      run: async () => {
        const data = await this.fetchJson<DailyMonthResponse>(`/api/daily?station=${station}&month=${month}`);
        const byDate = new Map(data.rows.map((r) => [r.date, r]));
        const records: DayRecord[] = [];
        for (const k of days) {
          const date = k.slice(k.indexOf("/") + 1);
          if (date >= this.today) continue;
          let row = byDate.get(date) ?? null;
          let source: DayRecord["source"] = "jma";
          // Keep AMeDAS values already filled into still-unpublished columns, so a refresh never blanks them.
          const old = this.days.get(dayKey(station, date));
          if (row && old?.source === "recent" && old.row && (row.unpublished?.length ?? 0) > 0) {
            row = mergeRecent(row, old.row);
            source = "recent";
          }
          const fixed = row && source === "jma" && isFixedDay(row, this.today);
          records.push(this.dayRecord(station, date, row, fixed ? "fixed" : "variable", source));
        }
        await this.saveDays(records);
      },
    };
  }

  private recentTask(station: string, date: string, priority: number): Task {
    return {
      key: `recent:${station}:${date}`,
      channel: "jma",
      priority,
      days: [dayKey(station, date)],
      run: async () => {
        const data = await this.fetchJson<{ daily?: WeatherRow; rows?: WeatherRow[] }>(
          `/api/recent?station=${station}&date=${date}`,
        );
        if (!data.daily) throw new Error("速報データがありません");
        const base = this.days.get(dayKey(station, date))?.row ?? null;
        await this.saveDays([this.dayRecord(station, date, mergeRecent(base, data.daily), "variable", "recent")]);
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
      run: async () => {
        const data = await this.fetchJson<{ rows: WeatherRow[]; hourlyRows: WeatherRow[] }>(
          `/api/forecast?station=${station}`,
        );
        await this.saveDays(
          data.rows.filter((r) => r.date >= this.today).map((r) => this.dayRecord(station, r.date, r, "variable", "forecast")),
        );
        const byDate = new Map<string, WeatherRow[]>();
        for (const r of data.hourlyRows ?? []) {
          if (r.date < this.today) continue;
          byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
        }
        const records: HourRecord[] = [];
        for (const [date, rows] of byDate) {
          const existing = this.hours.get(dayKey(station, date));
          // Observed hours (today) win over forecast hours.
          const merged = existing?.source === "current" ? mergeHours(rows, existing.rows) : rows;
          records.push(this.hourRecord(station, date, merged, "variable", existing?.source === "current" ? "current" : "forecast"));
        }
        await this.saveHours(records);
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
      run: async () => {
        const data = await this.fetchJson<{ rows: WeatherRow[]; latest: WeatherRow | null }>(
          `/api/current?station=${station}`,
        );
        if (data.latest && !same(this.latest.get(station), data.latest)) {
          this.latest.set(station, data.latest);
          this.emit();
        }
        const forecastRows = this.hours.get(dayKey(station, date))?.rows.filter((r) => r.type === "forecast") ?? [];
        await this.saveHours([this.hourRecord(station, date, mergeHours(forecastRows, data.rows ?? []), "variable", "current")]);
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
      run: async () => {
        const data = await this.fetchJson<HourlyResponse>(`/api/hourly?station=${station}&from=${from}&to=${to}`);
        const records: HourRecord[] = [];
        let failed: string | null = null;
        for (const day of data.days) {
          const k = dayKey(station, day.date);
          if (day.error) {
            this.errors.set("h:" + k, day.error);
            failed = day.error;
            continue;
          }
          const fixed = day.fixed && isFixedHourlyDay(day.date, day.rows, this.today);
          records.push(this.hourRecord(station, day.date, day.rows, fixed ? "fixed" : "variable", "jma"));
          this.fresh.add(`hour:${station}:${day.date}`);
        }
        await this.saveHours(records);
        if (failed) throw new Error(failed);
      },
    };
  }

  // ---- saving ----------------------------------------------------------------------------

  private dayRecord(station: string, date: string, row: WeatherRow | null, kind: Kind, source: DayRecord["source"]): DayRecord {
    return { key: dayKey(station, date), station, date, row, kind, source, savedAt: this.now() };
  }

  private hourRecord(station: string, date: string, rows: WeatherRow[], kind: Kind, source: HourRecord["source"]): HourRecord {
    return { key: dayKey(station, date), station, date, rows, kind, source, savedAt: this.now() };
  }

  /** Save only what changed; unchanged values neither write nor redraw. */
  private async saveDays(records: DayRecord[]): Promise<void> {
    const changed = records.filter((r) => {
      const old = this.days.get(r.key);
      return !old || old.kind !== r.kind || !same(old.row, r.row);
    });
    if (!changed.length) return;
    for (const r of changed) this.days.set(r.key, r);
    this.emit();
    await this.storage.putDays(changed);
    await this.noteSaved();
  }

  private async saveHours(records: HourRecord[]): Promise<void> {
    const changed = records.filter((r) => {
      const old = this.hours.get(r.key);
      return !old || old.kind !== r.kind || !same(old.rows, r.rows);
    });
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
    for (const [k, r] of this.days) if (r.source === "forecast" && r.date < this.today) dayKeys.push(k);
    for (const [k, r] of this.hours) if (r.source !== "jma" && r.date < this.today) hourKeys.push(k);
    dayKeys.forEach((k) => this.days.delete(k));
    hourKeys.forEach((k) => this.hours.delete(k));
    // Stored ones too: past forecast days have no value once the day is over.
    const all = await this.storage.allDayKeys();
    const stale = (await this.storage.getDays(all.filter((k) => k.slice(k.indexOf("/") + 1) < this.today)))
      .filter((r) => r.source === "forecast")
      .map((r) => r.key);
    await this.storage.deleteDays([...new Set([...dayKeys, ...stale])]);
    const allHours = await this.storage.allHourKeys();
    const staleHours = (await this.storage.getHours(allHours.filter((k) => k.slice(k.indexOf("/") + 1) < this.today)))
      .filter((r) => r.source !== "jma")
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

/** Fill columns the JMA table has not published yet with AMeDAS values. */
export function mergeRecent(base: WeatherRow | null, recent: WeatherRow): WeatherRow {
  if (!base) return recent;
  const missing = new Set(base.unpublished ?? []);
  const row: WeatherRow = { ...base, raw: { ...base.raw }, quality: { ...base.quality }, provisional: true };
  for (const k of missing) {
    if (recent[k] === undefined) continue;
    row[k] = recent[k];
    row.raw[k] = recent.raw[k] ?? "";
    if (recent.quality[k]) row.quality[k] = recent.quality[k];
  }
  return row;
}

/** Observed hours replace forecast hours with the same hour number. */
export function mergeHours(forecast: WeatherRow[], observed: WeatherRow[]): WeatherRow[] {
  const byHour = new Map<number, WeatherRow>();
  for (const r of forecast) byHour.set(r.n, r);
  for (const r of observed) {
    // AMeDAS has no radiation: keep the forecast's for that hour so the sunshine term still works.
    const f = byHour.get(r.n);
    const solar = typeof r.solar === "number" ? r.solar : f?.type === "forecast" ? f.solar : undefined;
    byHour.set(r.n, solar === undefined ? r : { ...r, solar, solarSource: r.solar === solar ? "observed" : "forecast" });
  }
  return [...byHour.values()].sort((a, b) => a.n - b.n);
}
