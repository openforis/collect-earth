// A stand-in for src/qualityWorker.ts in the QualityWorker tests: it answers like the
// real worker, but its jobs say how to behave (`job.mode`): "echo" answers at once
// (with the thread id, to tell a fresh worker from the old one), "hang" never
// answers, "busy" holds the thread in a loop, "oom" fills the heap until the worker
// runs out of memory (saying first that it computes).
import { parentPort, threadId } from 'node:worker_threads';

const held = [];
parentPort.on('message', ({ id, job }) => {
  if (job.mode === 'hang') {
    return;
  }
  if (job.mode === 'busy') {
    for (;;) {
      // never answers, never yields
    }
  }
  if (job.mode === 'oom') {
    // As the real worker: it says it computes, then the figures fill the heap.
    parentPort.postMessage({ id, computing: true });
    setTimeout(() => {
      for (;;) {
        held.push(new Array(1_000_000).fill(held.length));
      }
    }, 50);
    return;
  }
  parentPort.postMessage({ id, report: { echo: job.mode, threadId } });
});
parentPort.postMessage({ ready: true });
