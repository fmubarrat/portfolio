// Main-thread wrapper around the Pyodide worker, with a timeout that kills runaway code.
export class PythonRunner {
  constructor(onStatus = () => { }) {
    this.onStatus = onStatus;
    this.nextId = 1;
    this.pending = new Map();
    this.spawn();
  }

  spawn() {
    this.onStatus('loading');
    this.worker = new Worker('js/python-worker.js');
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.worker.onmessage = (e) => {
      if (e.data.type === 'ready') { this.onStatus('ready'); this.resolveReady(); return; }
      const done = this.pending.get(e.data.id);
      if (done) { this.pending.delete(e.data.id); done(e.data); }
    };
    this.worker.onerror = () => this.onStatus('error');
  }

  async run(code, task, timeoutMs = 5000) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.worker.terminate();
        this.spawn();
        resolve({ results: [], error: `Timed out after ${timeoutMs / 1000} s (infinite loop?)`, stdout: '', timeout: true });
      }, timeoutMs);
      this.pending.set(id, (data) => { clearTimeout(timer); resolve(data); });
      this.worker.postMessage({ id, code, fn: task.fn, tests: task.tests });
    });
  }
}
