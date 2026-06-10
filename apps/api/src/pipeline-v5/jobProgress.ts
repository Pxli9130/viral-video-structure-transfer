// pipeline-v5/jobProgress.ts
// Tiny in-memory progress registry so the UI can POLL the real server-side stage of a long learn/generate
// (which are single blocking requests — the client otherwise sees a frozen "1/3" bar). The pipeline reports
// coarse stages via setJobProgress(jobId, ...); the route GET /api/v5/jobs/:jobId/progress reads them back.
// Single-process server, so a module-level Map is enough (no persistence needed — progress is ephemeral).

export interface JobProgress {
  step: number;
  total: number;
  detail: string;
  done?: boolean;
  error?: string;
  updatedAt: number;
}

const JOBS = new Map<string, JobProgress>();
const MAX_JOBS = 200; // backstop against unbounded growth across a long-lived server

/** Report (merge) progress for a job. No-op when jobId is falsy so callers can pass an optional id unconditionally. */
export function setJobProgress(jobId: string | undefined | null, partial: Partial<Omit<JobProgress, "updatedAt">>): void {
  if (!jobId) return;
  const prev = JOBS.get(jobId) ?? { step: 0, total: 1, detail: "" };
  JOBS.set(jobId, { ...prev, ...partial, updatedAt: Date.now() });
  if (JOBS.size > MAX_JOBS) {
    // evict the oldest entries (Map preserves insertion order)
    const drop = JOBS.size - MAX_JOBS;
    let i = 0;
    for (const k of JOBS.keys()) { if (i++ >= drop) break; JOBS.delete(k); }
  }
}

export function getJobProgress(jobId: string): JobProgress | null {
  return JOBS.get(jobId) ?? null;
}

/** Mark a job finished (the poller can stop). Kept briefly so a final poll still sees it. */
export function finishJobProgress(jobId: string | undefined | null, detail = "完成"): void {
  if (!jobId) return;
  const prev = JOBS.get(jobId);
  if (!prev) return;
  JOBS.set(jobId, { ...prev, step: prev.total, detail, done: true, updatedAt: Date.now() });
}
