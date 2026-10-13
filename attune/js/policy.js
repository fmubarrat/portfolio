// Adaptive engagement policy.
// Maps a feature snapshot to one of four engagement techniques. The rules are deliberately
// simple and inspectable: every decision returns its scores and human-readable reasons, so it
// can be logged, audited and later replaced by a learned model trained on Study 1 data.

export const TECHNIQUES = {
  direct: {
    label: 'Direct',
    participant: '',
  },
  trace: {
    label: 'Trace & predict',
    participant: 'Before you use this code, predict what it does.',
  },
  lead: {
    label: 'Lead & reveal',
    participant: "Let's build this together, one step at a time.",
  },
  verify: {
    label: 'Verify first',
    participant: 'Check this suggestion against the tests before you use it.',
  },
};

const clamp = (x) => Math.max(0, Math.min(1, x));

// f: feature snapshot from app.features()
//   interaction: aiRequests, lastAcceptLatency (ms|null), runsBeforeLastAccept (int|null), failedRuns
//   typing:      idleRatio, backspaceRatio
//   face:        camera (bool), calibrating (bool), onScreen (0..1|null), browZ (z-score|null)
export function scores(f) {
  // Over-reliance: accepting AI code quickly, without running it, and asking repeatedly.
  let reliance = 0;
  if (f.lastAcceptLatency != null) {
    reliance += f.lastAcceptLatency < 10000 ? 0.4 : f.lastAcceptLatency < 20000 ? 0.2 : 0;
  }
  if (f.runsBeforeLastAccept === 0) reliance += 0.3;
  reliance += Math.min(0.3, 0.15 * Math.max(0, f.aiRequests - 1));

  // Struggle: stalled typing, heavy deletion, failing runs and (if sensed) brow lowering (AU4).
  const faceOk = f.camera && !f.calibrating && f.browZ != null;
  const parts = [
    [0.3, clamp(f.idleRatio / 0.6)],
    [0.2, clamp(f.backspaceRatio / 0.3)],
    [0.25, clamp(f.failedRuns / 3)],
  ];
  if (faceOk) parts.push([0.25, clamp((f.browZ - 0.5) / 1.5)]);
  const wsum = parts.reduce((a, [w]) => a + w, 0);
  const struggle = parts.reduce((a, [w, v]) => a + w * v, 0) / wsum;

  // Inattention: face missing or turned away from the screen (only when the camera is on).
  const inattention = f.camera && !f.calibrating && f.onScreen != null ? clamp((0.7 - f.onScreen) / 0.5) : 0;

  return { reliance: clamp(reliance), struggle: clamp(struggle), inattention };
}

export function choose(f) {
  const s = scores(f);
  const reasons = [];

  if (s.inattention >= 0.5) {
    reasons.push(`attention on screen ${pct(f.onScreen)} in the last 30 s`);
    return { technique: 'verify', scores: s, reasons };
  }
  if (s.reliance >= 0.5) {
    if (f.lastAcceptLatency != null) reasons.push(`last suggestion accepted after ${(f.lastAcceptLatency / 1000).toFixed(1)} s`);
    if (f.runsBeforeLastAccept === 0) reasons.push('accepted without running tests');
    if (f.aiRequests > 1) reasons.push(`${f.aiRequests} AI requests on this task`);
    return { technique: 'trace', scores: s, reasons };
  }
  if (s.struggle >= 0.5) {
    if (f.idleRatio > 0.3) reasons.push(`typing idle ${pct(f.idleRatio)} of the last 30 s`);
    if (f.failedRuns > 0) reasons.push(`${f.failedRuns} failing test run(s)`);
    if (f.backspaceRatio > 0.15) reasons.push(`backspace ratio ${pct(f.backspaceRatio)}`);
    if (f.camera && f.browZ != null && f.browZ > 1) reasons.push(`brow lowering z = ${f.browZ.toFixed(1)}`);
    return { technique: 'lead', scores: s, reasons };
  }
  reasons.push('no reliance, struggle or inattention signal above threshold');
  return { technique: 'direct', scores: s, reasons };
}

const pct = (x) => (x == null ? 'n/a' : Math.round(x * 100) + '%');
