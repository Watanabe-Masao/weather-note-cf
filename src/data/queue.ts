// A small priority queue for network jobs.
// - one job per key: asking again only raises its priority and shares the same promise
// - a limit per channel (JMA: 2 at a time, forecast: 1)
// - queued jobs that are no longer wanted can be dropped; running jobs always finish so their data is kept

export type Channel = "jma" | "forecast";

interface Job<T = unknown> {
  key: string;
  channel: Channel;
  priority: number;
  order: number;
  run: () => Promise<T>;
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  started: boolean;
}

export class RequestQueue {
  private jobs = new Map<string, Job>();
  private running: Record<Channel, number> = { jma: 0, forecast: 0 };
  private sequence = 0;

  constructor(private limits: Record<Channel, number> = { jma: 2, forecast: 1 }) {}

  add<T>(key: string, channel: Channel, priority: number, run: () => Promise<T>): Promise<T> {
    const existing = this.jobs.get(key) as Job<T> | undefined;
    if (existing) {
      if (!existing.started && priority < existing.priority) existing.priority = priority;
      this.pump();
      return existing.promise;
    }
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job<T> = {
      key,
      channel,
      priority,
      order: this.sequence++,
      run,
      promise,
      resolve,
      reject,
      started: false,
    };
    this.jobs.set(key, job as Job);
    queueMicrotask(() => this.pump());
    return promise;
  }

  has(key: string): boolean {
    return this.jobs.has(key);
  }

  /** Drop queued (not yet started) jobs that `keep` rejects. Their promises resolve to null. */
  retain(keep: (key: string, priority: number) => boolean): void {
    for (const job of [...this.jobs.values()]) {
      if (job.started || keep(job.key, job.priority)) continue;
      this.jobs.delete(job.key);
      job.resolve(null);
    }
  }

  get activeCount(): number {
    return this.running.jma + this.running.forecast;
  }

  /**
   * Stop sharing the jobs already running: a new request for the same key starts a new job. Used
   * when a refresh or a clear must not be answered by a request made before it. The detached jobs
   * still finish (and still count against the channel limit).
   */
  detachStarted(): void {
    for (const job of [...this.jobs.values()]) if (job.started) this.jobs.delete(job.key);
  }

  get pendingKeys(): string[] {
    return [...this.jobs.keys()];
  }

  private pump(): void {
    const waiting = [...this.jobs.values()]
      .filter((j) => !j.started)
      .sort((a, b) => a.priority - b.priority || a.order - b.order);
    for (const job of waiting) {
      if (this.running[job.channel] >= this.limits[job.channel]) continue;
      job.started = true;
      this.running[job.channel]++;
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running[job.channel]--;
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); // not a newer job with the same key
          this.pump();
        });
    }
  }
}
