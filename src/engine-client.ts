// Runs engine jobs in workers, at most two at a time; the rest wait in a queue.
import type { InFile } from './engine/ops';

export interface Job {
  id: number; op: string; title: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number; text: string; started: number; ended: number; inputBytes: number;
  result?: unknown; error?: { code: string; message: string };
  promise: Promise<unknown>;
}
type Listener = (jobs: Job[]) => void;

let nextId = 1;
const MAX = 2;
const jobs: Job[] = [];
const workers = new Map<number, Worker>();
const waiting: (() => void)[] = [];
const listeners = new Set<Listener>();
const emit = () => listeners.forEach(l => l(jobs));
export const onJobs = (l: Listener) => { listeners.add(l); l(jobs); return () => listeners.delete(l); };
export const allJobs = () => jobs;

function running() { return jobs.filter(j => j.status === 'running').length; }
function pump() { while (running() < MAX && waiting.length) waiting.shift()!(); }

export class JobError extends Error { constructor(public code: string, message: string) { super(message); } }

/** Run an engine operation. `quiet` jobs (listing, previews) don't show in the queue dock. */
export function run<T>(op: string, args: Record<string, unknown>, title: string, { quiet = false } = {}): { job: Job; promise: Promise<T> } {
  const id = nextId++;
  const inputs = (args.inputs as InFile[] | undefined) ?? [];
  const job: Job = { id, op, title, status: 'queued', progress: 0, text: '', started: 0, ended: 0, inputBytes: inputs.reduce((s, f) => s + f.data.size, 0) + ((args.blob as Blob | undefined)?.size ?? 0), promise: null as never };
  if (!quiet) jobs.unshift(job);
  job.promise = new Promise<T>((resolve, reject) => {
    const start = () => {
      if (job.status === 'cancelled') return;
      job.status = 'running'; job.started = performance.now(); emit();
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      workers.set(id, w);
      const finish = () => { w.terminate(); workers.delete(id); job.ended = performance.now(); emit(); pump(); };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.kind === 'progress') { job.progress = m.p; job.text = m.text ?? job.text; emit(); }
        else if (m.kind === 'done') { job.status = 'done'; job.progress = 1; job.result = m.result; finish(); resolve(m.result); }
        else if (m.kind === 'error') { job.status = 'error'; job.error = { code: m.code, message: m.message }; finish(); reject(new JobError(m.code, m.message)); }
      };
      w.onerror = (e) => { job.status = 'error'; job.error = { code: 'WORKER', message: e.message || 'The engine stopped' }; finish(); reject(new JobError('WORKER', job.error.message)); };
      w.postMessage({ id, op, args });
    };
    (job as Job & { reject?: (e: unknown) => void }).reject = reject;
    waiting.push(start); emit(); pump();
  }) as Promise<unknown>;
  return { job, promise: job.promise as Promise<T> };
}

export function cancel(id: number) {
  const job = jobs.find(j => j.id === id); if (!job || (job.status !== 'running' && job.status !== 'queued')) return;
  workers.get(id)?.terminate(); workers.delete(id);
  job.status = 'cancelled'; job.ended = performance.now();
  (job as Job & { reject?: (e: unknown) => void }).reject?.(new JobError('CANCELLED', 'Cancelled'));
  emit(); pump();
}
export function clearFinished() { for (let i = jobs.length - 1; i >= 0; i--) if (!['running', 'queued'].includes(jobs[i].status)) jobs.splice(i, 1); emit(); }
