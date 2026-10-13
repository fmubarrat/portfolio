// On-device face sensing with MediaPipe FaceLandmarker.
// Privacy: video frames and landmarks never leave this module. Each frame is reduced to five
// numbers (face present, head yaw, head pitch, brow lowering, blink) kept in memory for 2 minutes;
// only 30-second aggregates reach the study log.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SAMPLE_MS = 100;        // ~10 Hz is plenty for these signals and keeps CPU low
const CALIBRATION_MS = 20000; // personal baseline while the participant reads the first task
const KEEP_MS = 120000;

export class FaceSensor {
  constructor(video) {
    this.video = video;
    this.samples = [];
    this.blinks = [];
    this.eyesClosed = false;
    this.baseline = null;
    this.running = false;
    this.lastSample = 0;
  }

  async start(onStatus = () => { }) {
    onStatus('loading model');
    const vision = await import(MP + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try { this.lm = await vision.FaceLandmarker.createFromOptions(files, opts('GPU')); }
    catch (e) { this.lm = await vision.FaceLandmarker.createFromOptions(files, opts('CPU')); }

    onStatus('requesting camera');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.t0 = performance.now();
    this.calibUntil = this.t0 + CALIBRATION_MS;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    onStatus('calibrating');
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get calibrating() {
    return this.running && !this.baseline;
  }

  tick() {
    const now = performance.now();
    if (now - this.lastSample < SAMPLE_MS || this.video.readyState < 2) return;
    this.lastSample = now;

    const res = this.lm.detectForVideo(this.video, now);
    const s = { t: now, present: false, yaw: null, pitch: null, brow: null, blink: null };
    if (res.faceBlendshapes && res.faceBlendshapes.length) {
      const b = {};
      res.faceBlendshapes[0].categories.forEach((c) => { b[c.categoryName] = c.score; });
      s.present = true;
      s.brow = ((b.browDownLeft || 0) + (b.browDownRight || 0)) / 2;
      s.blink = ((b.eyeBlinkLeft || 0) + (b.eyeBlinkRight || 0)) / 2;
      const m = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
      if (m) {
        const d = m.data; // 4x4, column-major
        s.yaw = Math.atan2(d[8], d[10]) * 180 / Math.PI;
        s.pitch = Math.atan2(-d[9], Math.hypot(d[8], d[10])) * 180 / Math.PI;
      }
      // Blink = rising edge of eye closure with hysteresis.
      if (!this.eyesClosed && s.blink > 0.5) { this.eyesClosed = true; this.blinks.push(now); }
      else if (this.eyesClosed && s.blink < 0.3) this.eyesClosed = false;
    }
    this.samples.push(s);

    while (this.samples.length && now - this.samples[0].t > KEEP_MS) this.samples.shift();
    while (this.blinks.length && now - this.blinks[0] > KEEP_MS) this.blinks.shift();

    if (!this.baseline && now >= this.calibUntil) this.baseline = this.computeBaseline();
  }

  computeBaseline() {
    const p = this.samples.filter((s) => s.present && s.yaw != null);
    if (p.length < 20) { this.calibUntil = performance.now() + 5000; return null; } // retry
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const brows = p.map((s) => s.brow);
    const mean = brows.reduce((a, b) => a + b, 0) / brows.length;
    const sd = Math.sqrt(brows.reduce((a, b) => a + (b - mean) ** 2, 0) / brows.length);
    return { yaw: med(p.map((s) => s.yaw)), pitch: med(p.map((s) => s.pitch)), browMean: mean, browSd: sd };
  }

  // Aggregates over the last windowMs.
  summary(windowMs = 30000) {
    if (!this.running) return { camera: false, calibrating: false, facePresent: null, onScreen: null, browZ: null, blinkRate: null };
    const now = performance.now();
    const w = this.samples.filter((s) => now - s.t <= windowMs);
    if (!w.length) return { camera: true, calibrating: this.calibrating, facePresent: null, onScreen: null, browZ: null, blinkRate: null };

    const present = w.filter((s) => s.present);
    const out = {
      camera: true,
      calibrating: this.calibrating,
      facePresent: present.length / w.length,
      onScreen: null,
      browZ: null,
      blinkRate: this.blinks.filter((t) => now - t <= windowMs).length * 60000 / Math.min(windowMs, now - this.t0),
    };
    if (this.baseline) {
      const b = this.baseline;
      // "On screen" = face present and head within ±20° yaw / ±15° pitch of the participant's own baseline.
      out.onScreen = w.filter((s) => s.present && s.yaw != null && Math.abs(s.yaw - b.yaw) < 20 && Math.abs(s.pitch - b.pitch) < 15).length / w.length;
      if (present.length) {
        const brow = present.reduce((a, s) => a + s.brow, 0) / present.length;
        out.browZ = (brow - b.browMean) / (b.browSd + 0.02);
      }
    }
    return out;
  }
}

// Typing dynamics in the code editor: rate, deletion and pauses (a keystroke analogue of the
// kinematic features used for drawing in the Parkinson's work).
export class KeystrokeTracker {
  constructor(el) {
    this.events = [];
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') this.push('del');
      else if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab') this.push('char');
    });
    el.addEventListener('paste', () => this.push('paste'));
  }

  push(type) {
    const t = performance.now();
    this.events.push({ t, type });
    while (this.events.length && t - this.events[0].t > KEEP_MS) this.events.shift();
  }

  reset() { this.events = []; this.since = performance.now(); }

  summary(windowMs = 30000) {
    const now = performance.now();
    const start = Math.max(now - windowMs, this.since || 0);
    const span = Math.max(1000, now - start);
    const w = this.events.filter((e) => e.t >= start);
    const chars = w.filter((e) => e.type === 'char').length;
    const dels = w.filter((e) => e.type === 'del').length;

    // Idle = time spent in pauses longer than 3 s (including before the first and after the last key).
    const times = [start, ...w.map((e) => e.t), now];
    let idle = 0;
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > 3000) idle += gap;
    }
    return {
      keysPerMin: (chars + dels) * 60000 / span,
      backspaceRatio: chars + dels ? dels / (chars + dels) : 0,
      idleRatio: Math.min(1, idle / span),
      pastes: w.filter((e) => e.type === 'paste').length,
    };
  }
}
