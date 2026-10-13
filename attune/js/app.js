import { TASKS, CONCEPT_TEST, SURVEY, SURVEY_OPEN, REPLY_NEUTRAL, REPLY_CONFIDENT } from './tasks.js';
import { TECHNIQUES, choose } from './policy.js';
import { FaceSensor, KeystrokeTracker } from './sensing.js';
import { PythonRunner } from './python.js';

const VERSION = '0.2.0';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (code) => code.replace(/\s+/g, ' ').trim();
const r2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);

// Feature overrides for demos and for piloting the policy without acting states out.
const SIMS = {
  reliant: { aiRequests: 3, lastAcceptLatency: 3500, runsBeforeLastAccept: 0 },
  struggling: { idleRatio: 0.7, backspaceRatio: 0.3, failedRuns: 2, browZ: 2.2 },
  distracted: { camera: true, calibrating: false, facePresent: 0.4, onScreen: 0.2 },
};

const S = {
  pid: '', condition: 'adaptive', flawed: new Set(), explain: true, t0: 0, started: false,
  concept: { pre: null, post: null }, survey: null,
  taskIdx: 0, task: null, taskStart: 0,
  inter: null,       // per-task interaction counters
  suggestion: null,  // latest AI suggestion on this task
  events: [], timeline: [], perTask: [],
  override: '', sim: '', lastDecision: null,
};

const editor = $('#editor');
const keys = new KeystrokeTracker(editor);
const face = new FaceSensor($('#cam'));
const py = new PythonRunner((st) => setPill('#py-status', 'python: ' + st, st === 'ready' ? 'on' : st === 'error' ? 'warn' : ''));

// ── Utilities ──
function setPill(sel, text, cls) {
  const el = $(sel);
  el.textContent = text;
  el.className = 'pill' + (cls ? ' ' + cls : '');
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function now() { return Math.round(performance.now() - S.t0); }

function log(type, data = {}) {
  S.events.push({ t: now(), task: S.task ? S.task.id : null, type, ...data });
}

function features() {
  const f = {
    ...face.summary(30000),
    ...keys.summary(30000),
    aiRequests: S.inter ? S.inter.aiRequests : 0,
    lastAcceptLatency: S.inter ? S.inter.lastAcceptLatency : null,
    runsBeforeLastAccept: S.inter ? S.inter.runsBeforeLastAccept : null,
    failedRuns: S.inter ? S.inter.failedRuns : 0,
  };
  if (S.sim) Object.assign(f, SIMS[S.sim], { simulated: S.sim });
  return f;
}

function rounded(f) {
  const o = {};
  for (const k in f) o[k] = r2(f[k]);
  return o;
}

// Which technique to use for a help request. In static conditions the policy still runs in
// "shadow" mode and is logged, so its decisions can be compared offline with what happened.
function decide() {
  const f = features();
  const policy = choose(f);
  let technique = policy.technique, source = 'policy';
  if (S.condition.startsWith('static-')) { technique = S.condition.slice('static-'.length); source = 'static'; }
  if (S.override) { technique = S.override; source = 'override'; }
  return { technique, source, policy, features: f };
}

// ── Session start ──
(function prefill() {
  const q = new URLSearchParams(location.search);
  if (q.get('pid')) $('#pid').value = q.get('pid');
  if (q.get('condition')) $('#condition').value = q.get('condition');
  if (q.get('flawed') != null) $('#flawed').value = q.get('flawed');
  if (q.get('cam') === '1') $('#use-cam').checked = true;
  if (q.get('cam') === '0') $('#use-cam').checked = false;
  if (q.get('explain') != null) $('#explain').value = q.get('explain') === '0' ? '0' : '1';
})();

$('#start').addEventListener('click', () => {
  S.pid = $('#pid').value.trim() || 'anon';
  S.condition = $('#condition').value;
  S.flawed = new Set($('#flawed').value.split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= TASKS.length).map((n) => n - 1));
  S.explain = $('#explain').value === '1';
  S.t0 = performance.now();
  S.started = true;
  S.startedAt = new Date().toISOString();
  log('session_start', { pid: S.pid, condition: S.condition, sycophanticTasks: [...S.flawed].map((i) => i + 1), explain: S.explain, cameraOptIn: $('#use-cam').checked, version: VERSION });
  if ($('#use-cam').checked) startCamera();
  setInterval(tick, 1000);
  showQuiz('pre', () => startTask(0));
});

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setPill('#cam-status', 'camera unavailable', 'warn');
    log('camera_failed', { error: 'getUserMedia unavailable (use http://localhost)' });
    return;
  }
  try {
    await face.start((st) => setPill('#cam-status', 'camera: ' + st, 'warn'));
    log('camera_on');
  } catch (e) {
    setPill('#cam-status', 'camera off', '');
    log('camera_failed', { error: String((e && e.name) || e) });
  }
}

// ── Tasks ──
function startTask(i) {
  S.taskIdx = i;
  S.task = TASKS[i];
  S.taskStart = performance.now();
  S.inter = { aiRequests: 0, lastAcceptLatency: null, runsBeforeLastAccept: null, failedRuns: 0, runs: 0, techniques: [], insertedFlawed: false, beliefs: [], lastConfidence: null };
  S.suggestion = null;

  show('#screen-task');
  $('#progress').textContent = `Task ${i + 1} of ${TASKS.length}`;
  $('#task-kicker').textContent = `Task ${i + 1} of ${TASKS.length}`;
  $('#task-title').textContent = S.task.title;
  $('#task-prompt').innerHTML = S.task.prompt;
  $('#task-examples').innerHTML = S.task.examples.map((e) => `<li>${esc(e)}</li>`).join('');
  editor.value = S.task.starter;
  $('#editor-origin').textContent = '';
  $('#results').innerHTML = '';
  const ideas = [['correct', S.task.beliefs.correct], ['misconception', S.task.beliefs.misconception]];
  if (Math.random() < 0.5) ideas.reverse(); // avoid an order cue
  $('#belief').innerHTML = '<option value="">— choose if you have one —</option>' +
    ideas.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('') +
    '<option value="unsure">Not sure yet</option>';
  $('#assist-log').innerHTML = '<div class="assist-empty">The assistant can suggest code.<br>Ask whenever you like.</div>';
  keys.reset();
  log('task_start', { index: i + 1, flawedCondition: S.flawed.has(i) });
  editor.focus();
}

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value } = editor;
    editor.value = value.slice(0, a) + '    ' + value.slice(b);
    editor.selectionStart = editor.selectionEnd = a + 4;
  }
});
editor.addEventListener('input', () => {
  if (S.suggestion && S.suggestion.insertedAt) S.suggestion.editsAfter++;
  if ($('#editor-origin').textContent && S.suggestion && norm(editor.value) !== norm(S.suggestion.code)) {
    $('#editor-origin').textContent = 'AI code, edited';
  }
});

// ── Running tests ──
function renderResults(el, r, total) {
  const passed = r.results.filter((x) => x.pass).length;
  let html = `<div class="summary ${passed === total && !r.error ? 'pass' : 'fail'}">${passed} / ${total} tests passed</div>`;
  if (r.error) html += `<div class="err">${esc(r.error)}</div>`;
  if (r.results.length) {
    html += '<table><tr><th>Input</th><th>Expected</th><th>Got</th><th></th></tr>' +
      r.results.map((x) => `<tr><td>${esc(x.args)}</td><td>${esc(x.expect)}</td><td>${esc(x.got)}</td><td class="${x.pass ? 'pass' : 'fail'}">${x.pass ? '✓' : '✗'}</td></tr>`).join('') +
      '</table>';
  }
  if (r.stdout) html += `<div class="muted" style="margin-top:.4rem">stdout:</div><pre>${esc(r.stdout)}</pre>`;
  el.innerHTML = html;
  return passed;
}

$('#run').addEventListener('click', async () => {
  const btn = $('#run');
  btn.disabled = true;
  $('#results').innerHTML = '<div class="muted">Running…</div>';
  const r = await py.run(editor.value, S.task);
  btn.disabled = false;
  const total = S.task.tests.length;
  const passed = renderResults($('#results'), r, total);
  S.inter.runs++;
  if (r.error || passed < total) S.inter.failedRuns++;
  if (S.suggestion && !S.suggestion.insertedAt) S.suggestion.runsBefore++;
  const fromAI = S.suggestion ? norm(editor.value) === norm(S.suggestion.code) : false;
  log('run', { passed, total, error: r.error || null, editorIsUnchangedAICode: fromAI });
});

// ── Assistant ──
$('#ask-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ask').click(); });

$('#ask').addEventListener('click', () => {
  const text = $('#ask-text').value.trim();
  $('#ask-text').value = '';
  const d = decide();
  S.inter.aiRequests++;

  // The learner's current idea: stated, or detected from their code.
  let belief = $('#belief').value, beliefSource = belief ? 'stated' : 'none';
  if (!belief && S.task.misconceptionPattern && S.task.misconceptionPattern.test(editor.value)) {
    belief = 'misconception';
    beliefSource = 'detected-in-code';
  }
  const sycophantic = S.flawed.has(S.taskIdx);
  let variant, reply;
  if (sycophantic) {
    // Goes along with the learner. Harm happens when the learner holds (or has no) wrong idea.
    variant = belief === 'correct' ? 'correct' : 'flawed';
    reply = belief === 'correct' ? S.task.replies.agreeCorrect : belief === 'misconception' ? S.task.replies.agreeMisconception : REPLY_CONFIDENT;
  } else {
    variant = 'correct';
    reply = belief === 'misconception' ? S.task.replies.correctMisconception : belief === 'correct' ? S.task.replies.agreeCorrect : REPLY_NEUTRAL;
  }
  const sug = {
    n: S.inter.aiRequests, variant, technique: d.technique, code: S.task.ai[variant].code,
    reply, belief: belief || 'none', beliefSource, sycophantic,
    reason: d.source === 'policy' ? d.policy.technique : null,
    shownAt: performance.now(), insertedAt: null, runsBefore: 0, editsAfter: 0, confidence: null, skipped: false,
  };
  S.suggestion = sug;
  S.inter.techniques.push(d.technique);
  S.inter.beliefs.push(sug.belief);
  S.lastDecision = d;
  log('ai_request', {
    text, belief: sug.belief, beliefSource, sycophantic, technique: d.technique, source: d.source, policyTechnique: d.policy.technique,
    scores: rounded(d.policy.scores), reasons: d.policy.reasons, variant, features: rounded(d.features),
  });
  renderSuggestion(sug, text);
  renderDash();
});

function codeBlock(code, visible) {
  const lines = code.replace(/\n$/, '').split('\n');
  const pre = document.createElement('pre');
  pre.innerHTML = lines.map((l, i) => {
    const shown = i < visible;
    const body = shown ? esc(l) : ' '.repeat(Math.max(4, l.length));
    return `<span class="ln">${i + 1}</span><span class="${shown ? '' : 'hidden-line'}">${body}</span>`;
  }).join('\n');
  return pre;
}

function optionButtons(options, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'options';
  options.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = esc(o);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      b.classList.add('chosen');
      onPick(i, b, wrap);
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function feedback(ok, text) {
  const d = document.createElement('div');
  d.className = 'feedback ' + (ok ? 'good' : 'bad');
  d.textContent = text;
  return d;
}

function renderSuggestion(sug, userText) {
  const logEl = $('#assist-log');
  const empty = logEl.querySelector('.assist-empty');
  if (empty) empty.remove();
  if (userText) {
    const u = document.createElement('div');
    u.className = 'msg-user';
    u.textContent = userText;
    logEl.appendChild(u);
  }

  const ai = S.task.ai[sug.variant];
  const T = TECHNIQUES[sug.technique];
  const card = document.createElement('div');
  card.className = 'msg-ai';
  card.innerHTML = (sug.technique !== 'direct' ? `<div class="mode">${esc(T.label)}</div><div>${esc(T.participant)}</div>` : '') +
    (sug.technique !== 'direct' && S.explain ? `<div class="why"><b>Why this step?</b> ${esc(whyText(sug))}</div>` : '') +
    `<p style="margin:.4rem 0">${esc(sug.reply)}</p>`;

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const insert = document.createElement('button');
  insert.className = 'primary';
  insert.textContent = 'Insert into editor';
  insert.addEventListener('click', () => insertSuggestion(sug, insert, card));
  actions.appendChild(insert);
  if (sug.technique !== 'direct') {
    // Learner agency: any engagement step can be skipped. Skips are logged as a friction signal.
    const skip = document.createElement('button');
    skip.className = 'skip';
    skip.textContent = 'Skip this step';
    skip.addEventListener('click', () => {
      sug.skipped = true;
      insert.disabled = false;
      if (card.querySelector('.hidden-line')) card.querySelector('pre').replaceWith(codeBlock(sug.code, 99));
      skip.remove();
      log('skip_engagement', { technique: sug.technique, variant: sug.variant });
    });
    actions.appendChild(skip);
  }

  if (sug.technique === 'direct') {
    card.appendChild(codeBlock(ai.code, 99));
  } else if (sug.technique === 'trace') {
    card.appendChild(codeBlock(ai.code, 99));
    insert.disabled = true;
    const tr = S.task.trace;
    const q = document.createElement('div');
    q.className = 'q';
    q.innerHTML = tr.q;
    card.appendChild(q);
    const truth = tr.answer[sug.variant];
    card.appendChild(optionButtons(tr.options, (i, b, wrap) => {
      const ok = tr.options[i] === truth;
      b.classList.add(ok ? 'right' : 'wrong');
      if (!ok) [...wrap.children].find((x) => x.textContent === truth)?.classList.add('right');
      wrap.after(feedback(ok, ok ? `Correct: it returns ${truth}.` : `Not quite: it actually returns ${truth}.`));
      insert.disabled = false;
      log('trace_answer', { choice: tr.options[i], correct: ok, variant: sug.variant });
    }));
  } else if (sug.technique === 'lead') {
    const reveal = ai.reveal;
    let pre = codeBlock(ai.code, 1);
    card.appendChild(pre);
    insert.disabled = true;
    const steps = S.task.lead;
    const nextStep = (k) => {
      if (k >= steps.length) { insert.disabled = false; return; }
      const st = steps[k];
      const q = document.createElement('div');
      q.className = 'q';
      q.textContent = `Step ${k + 1}/${steps.length}: ${st.q}`;
      card.insertBefore(q, actions);
      const opts = optionButtons(st.options, (i, b, wrap) => {
        const ok = i === st.answer;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) wrap.children[st.answer].classList.add('right');
        wrap.after(feedback(ok, ok ? 'Yes.' : `The intended answer: ${st.options[st.answer]}.`));
        const fresh = codeBlock(ai.code, reveal[k]);
        pre.replaceWith(fresh);
        pre = fresh;
        log('lead_answer', { step: k + 1, correct: ok, variant: sug.variant });
        nextStep(k + 1);
      });
      card.insertBefore(opts, actions);
    };
    card.appendChild(actions);
    nextStep(0);
  } else if (sug.technique === 'verify') {
    card.appendChild(codeBlock(ai.code, 99));
    insert.disabled = true;
    const runBtn = document.createElement('button');
    runBtn.className = 'ghost';
    runBtn.textContent = '▶ Run the tests on this suggestion';
    const out = document.createElement('div');
    out.className = 'results';
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      out.innerHTML = '<div class="muted">Running…</div>';
      const r = await py.run(ai.code, S.task);
      const total = S.task.tests.length;
      const passed = renderResults(out, r, total);
      sug.runsBefore++;
      insert.disabled = false;
      log('verify_run', { passed, total, variant: sug.variant });
    });
    actions.prepend(runBtn);
    card.appendChild(out);
  }

  if (!card.contains(actions)) card.appendChild(actions);
  logEl.appendChild(card);
  logEl.scrollTop = logEl.scrollHeight;
}

function whyText(sug) {
  if (S.condition.startsWith('static-') || !sug.reason) return 'This assistant always works through code with you.';
  return {
    trace: 'You used the last suggestion quickly, without running it first.',
    lead: 'It looked like you might be stuck, so we will go step by step.',
    verify: 'It looked like your attention was elsewhere, so check the code first.',
  }[sug.reason] || 'The assistant adapts to how you are working.';
}

function insertSuggestion(sug, btn, card) {
  editor.value = sug.code;
  const latency = performance.now() - sug.shownAt;
  if (!sug.insertedAt) {
    sug.insertedAt = performance.now();
    S.inter.lastAcceptLatency = latency;
    S.inter.runsBeforeLastAccept = sug.runsBefore;
    if (sug.variant === 'flawed') S.inter.insertedFlawed = true;
  }
  $('#editor-origin').textContent = 'inserted from AI';
  btn.textContent = 'Inserted ✓';
  log('ai_insert', { latencyMs: Math.round(latency), runsBefore: sug.runsBefore, technique: sug.technique, variant: sug.variant, skipped: sug.skipped });
  if (card && !card.querySelector('.confidence')) card.appendChild(confidenceProbe(sug));
  editor.focus();
}

// Trust-calibration probe: confidence in a suggestion vs. whether it was actually correct.
function confidenceProbe(sug) {
  const box = document.createElement('div');
  box.className = 'confidence';
  box.textContent = 'How sure are you that this code is correct?';
  const scale = document.createElement('div');
  scale.className = 'scale';
  scale.innerHTML = '<span class="ends">not sure</span>';
  for (let v = 1; v <= 5; v++) {
    const b = document.createElement('button');
    b.textContent = v;
    b.addEventListener('click', () => {
      scale.querySelectorAll('button').forEach((x) => x.classList.toggle('chosen', x === b));
      sug.confidence = v;
      S.inter.lastConfidence = { value: v, variant: sug.variant };
      log('confidence', { value: v, variant: sug.variant, technique: sug.technique });
    });
    scale.appendChild(b);
  }
  scale.insertAdjacentHTML('beforeend', '<span class="ends">certain</span>');
  box.appendChild(scale);
  return box;
}

// ── Submit + comprehension check ──
$('#submit').addEventListener('click', async () => {
  const btn = $('#submit');
  btn.disabled = true;
  const r = await py.run(editor.value, S.task);
  btn.disabled = false;
  const total = S.task.tests.length;
  const passed = r.results.filter((x) => x.pass).length;
  const rec = {
    task: S.task.id,
    index: S.taskIdx + 1,
    sycophanticCondition: S.flawed.has(S.taskIdx),
    aiRequests: S.inter.aiRequests,
    techniques: S.inter.techniques,
    insertedFlawed: S.inter.insertedFlawed,
    submittedFlawedUnchanged: norm(editor.value) === norm(S.task.ai.flawed.code),
    passed, total,
    runs: S.inter.runs,
    failedRuns: S.inter.failedRuns,
    lastAcceptLatencyMs: S.inter.lastAcceptLatency == null ? null : Math.round(S.inter.lastAcceptLatency),
    beliefs: S.inter.beliefs,
    confidence: S.inter.lastConfidence || null,
    timeSec: Math.round((performance.now() - S.taskStart) / 1000),
    finalCode: editor.value,
    check: null,
  };
  S.perTask.push(rec);
  log('task_submit', { ...rec, finalCode: undefined });
  showCheck(rec);
});

function showCheck(rec) {
  show('#screen-check');
  const c = S.task.check;
  $('#check-q').innerHTML = c.q;
  const next = $('#check-next');
  next.disabled = true;
  const box = $('#check-options');
  box.innerHTML = '';
  box.appendChild(optionButtons(c.options, (i) => {
    rec.check = { choice: i, correct: i === c.answer };
    log('check_answer', rec.check);
    next.disabled = false;
  }));
}

$('#check-next').addEventListener('click', () => {
  if (S.taskIdx + 1 < TASKS.length) startTask(S.taskIdx + 1);
  else { S.task = null; showQuiz('post', showSurvey); }
});

// ── Concept test (pre and post) ──
function showQuiz(phase, then) {
  show('#screen-quiz');
  $('#progress').textContent = phase === 'pre' ? 'Before the tasks' : 'After the tasks';
  $('#quiz-kicker').textContent = phase === 'pre' ? 'Before you start' : 'One last check';
  $('#quiz-title').textContent = phase === 'pre' ? 'Three quick questions' : 'The same three questions again';
  const answers = new Array(CONCEPT_TEST.length).fill(null);
  const box = $('#quiz-items');
  box.innerHTML = '';
  const next = $('#quiz-next');
  next.disabled = true;
  CONCEPT_TEST.forEach((item, k) => {
    const wrap = document.createElement('div');
    wrap.className = 'quiz-item';
    wrap.innerHTML = `<div class="q" style="font-weight:600;margin-bottom:.4rem">${k + 1}. ${item.q}</div>`;
    wrap.appendChild(optionButtons(item.options, (i) => {
      answers[k] = { id: item.id, choice: i, correct: i === item.answer };
      next.disabled = answers.some((a) => a === null);
    }));
    box.appendChild(wrap);
  });
  next.onclick = () => {
    S.concept[phase] = { answers, score: answers.filter((a) => a.correct).length };
    log('concept_test', { phase, score: S.concept[phase].score, answers });
    then();
  };
}

// ── Questionnaire ──
function showSurvey() {
  show('#screen-survey');
  $('#progress').textContent = 'Questionnaire';
  const resp = {};
  const box = $('#survey-items');
  box.innerHTML = '';
  const next = $('#survey-next');
  next.disabled = true;
  SURVEY.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'likert';
    row.innerHTML = `<span>${esc(item.text)}</span>`;
    const scale = document.createElement('div');
    scale.className = 'scale';
    for (let v = 1; v <= 7; v++) {
      const b = document.createElement('button');
      b.textContent = v;
      b.addEventListener('click', () => {
        scale.querySelectorAll('button').forEach((x) => x.classList.toggle('chosen', x === b));
        resp[item.id] = v;
        next.disabled = Object.keys(resp).length < SURVEY.length;
      });
      scale.appendChild(b);
    }
    row.appendChild(scale);
    box.appendChild(row);
  });
  $('#survey-open-q').textContent = SURVEY_OPEN;
  $('#survey-open').value = '';
  next.onclick = () => {
    S.survey = { likert: resp, open: $('#survey-open').value.trim() };
    log('survey', S.survey);
    finish();
  };
}

function finish() {
  log('session_end');
  face.stop();
  setPill('#cam-status', 'camera off', '');
  S.task = null;
  $('#progress').textContent = 'Done';
  show('#screen-done');
  const yes = (b) => (b ? 'yes' : 'no');
  const pre = S.concept.pre ? S.concept.pre.score : '—', post = S.concept.post ? S.concept.post.score : '—';
  $('#summary').innerHTML = `<p>Concept test: <b>${pre} / ${CONCEPT_TEST.length}</b> before → <b>${post} / ${CONCEPT_TEST.length}</b> after</p>` +
    '<table class="sum-table"><tr><th>Task</th><th>Sycophantic AI</th><th>Idea stated</th><th>AI requests</th><th>Techniques</th><th>Inserted flawed</th><th>Submitted flawed as-is</th><th>Confidence</th><th>Tests</th><th>Check</th><th>Time</th></tr>' +
    S.perTask.map((t) => `<tr><td>${t.index}. ${esc(t.task)}</td><td>${yes(t.sycophanticCondition)}</td><td>${t.beliefs.join(', ') || '—'}</td><td>${t.aiRequests}</td><td>${t.techniques.join(', ') || '—'}</td><td>${yes(t.insertedFlawed)}</td><td>${yes(t.submittedFlawedUnchanged)}</td><td>${t.confidence ? t.confidence.value + '/5' : '—'}</td><td>${t.passed}/${t.total}</td><td>${t.check ? (t.check.correct ? '✓' : '✗') : '—'}</td><td>${t.timeSec}s</td></tr>`).join('') +
    '</table>';
}

// ── Export ──
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => S.startedAt.slice(0, 19).replace(/[:T]/g, '-');

$('#export-json').addEventListener('click', () => {
  const data = {
    meta: { app: 'attune', version: VERSION, pid: S.pid, condition: S.condition, sycophanticTasks: [...S.flawed].map((i) => i + 1), explain: S.explain, startedAt: S.startedAt },
    concept: S.concept, survey: S.survey,
    perTask: S.perTask, events: S.events, timeline: S.timeline,
  };
  download(`attune_${S.pid}_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
});

$('#export-csv').addEventListener('click', () => {
  if (!S.timeline.length) return;
  const cols = Object.keys(S.timeline[0]);
  const rows = [cols.join(',')].concat(S.timeline.map((r) => cols.map((c) => (r[c] == null ? '' : r[c])).join(',')));
  download(`attune_${S.pid}_${stamp()}_timeline.csv`, rows.join('\n'), 'text/csv');
});

// ── 1 Hz tick: timeline sample, camera status, dashboard ──
function tick() {
  if (face.running) setPill('#cam-status', face.calibrating ? 'camera: calibrating' : 'camera: sensing', face.calibrating ? 'warn' : 'on');
  if (S.task) {
    const f = features();
    const p = choose(f);
    S.timeline.push({
      t: now(), task: S.task.id,
      camera: f.camera ? 1 : 0, calibrating: f.calibrating ? 1 : 0,
      facePresent: r2(f.facePresent), onScreen: r2(f.onScreen), browZ: r2(f.browZ), blinkRate: r2(f.blinkRate),
      keysPerMin: r2(f.keysPerMin), idleRatio: r2(f.idleRatio), backspaceRatio: r2(f.backspaceRatio),
      aiRequests: f.aiRequests, failedRuns: f.failedRuns,
      reliance: r2(p.scores.reliance), struggle: r2(p.scores.struggle), inattention: r2(p.scores.inattention),
      policy: p.technique, simulated: S.sim || '',
    });
  }
  renderDash();
}

// ── Researcher dashboard ──
const dash = $('#dash');
const toggleDash = () => { dash.classList.toggle('hidden'); renderDash(); };
$('#toggle-dash').addEventListener('click', toggleDash);
$('#close-dash').addEventListener('click', toggleDash);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'd' || e.key === 'D') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) toggleDash();
});

$('#override').addEventListener('change', (e) => {
  S.override = e.target.value;
  if (S.started) log('wizard_override', { technique: S.override || 'auto' });
});
document.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => {
  S.sim = b.dataset.sim;
  document.querySelectorAll('[data-sim]').forEach((x) => x.classList.toggle('active', x === b && !!S.sim));
  if (S.started) log('wizard_simulate', { state: S.sim || 'none' });
  renderDash();
}));

function renderDash() {
  if (dash.classList.contains('hidden')) return;
  const f = features();
  const p = choose(f);
  const fmtPct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const fmt = (x, d = 1) => (x == null ? '—' : x.toFixed(d));

  let policyHtml = `Now: ${TECHNIQUES[p.technique].label}`;
  if (S.condition.startsWith('static-') && S.started) policyHtml += ' <span style="font-size:11px;color:#8a96a1">(shadow, condition is static)</span>';
  if (S.override) policyHtml += ` <span style="font-size:11px;color:#e7a86a">→ forced: ${S.override}</span>`;
  $('#dash-policy').innerHTML = policyHtml;
  let reasons = p.reasons.map(esc).join(' · ');
  if (S.lastDecision) reasons += `<br><span style="color:#8a96a1">Last request used: ${TECHNIQUES[S.lastDecision.technique].label} (${S.lastDecision.source})</span>`;
  if (S.sim) reasons += `<br><span style="color:#e7a86a">Simulating: ${S.sim}</span>`;
  $('#dash-reasons').innerHTML = reasons;

  $('#dash-scores').innerHTML = ['reliance', 'struggle', 'inattention'].map((k) =>
    `<div class="bar"><span>${k}</span><div class="track"><div class="fill" style="width:${Math.round(p.scores[k] * 100)}%;background:${p.scores[k] >= 0.5 ? '#e7a86a' : '#6b9fd4'}"></div><div class="thr"></div></div><span>${p.scores[k].toFixed(2)}</span></div>`).join('');

  const rows = [
    ['camera', f.camera ? (f.calibrating ? 'calibrating' : 'on') : 'off'],
    ['face present', fmtPct(f.facePresent)],
    ['on screen', fmtPct(f.onScreen)],
    ['brow lowering (z)', fmt(f.browZ)],
    ['blinks / min', fmt(f.blinkRate, 0)],
    ['keys / min', fmt(f.keysPerMin, 0)],
    ['typing idle', fmtPct(f.idleRatio)],
    ['backspace ratio', fmtPct(f.backspaceRatio)],
    ['AI requests (task)', f.aiRequests],
    ['last accept latency', f.lastAcceptLatency == null ? '—' : (f.lastAcceptLatency / 1000).toFixed(1) + ' s'],
    ['runs before accept', f.runsBeforeLastAccept == null ? '—' : f.runsBeforeLastAccept],
    ['failing runs', f.failedRuns],
  ];
  $('#dash-signals').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  drawSpark();
}

function drawSpark() {
  const c = $('#dash-spark');
  const x = c.getContext('2d');
  const w = c.width, h = c.height;
  x.clearRect(0, 0, w, h);
  const pts = S.timeline.slice(-60);
  if (pts.length < 2) return;
  const line = (get, color) => {
    x.strokeStyle = color;
    x.lineWidth = 1.5;
    x.beginPath();
    let started = false;
    pts.forEach((p, i) => {
      const v = get(p);
      if (v == null || Number.isNaN(v)) { started = false; return; }
      const px = (i / 59) * (w - 4) + 2, py = h - 4 - Math.max(0, Math.min(1, v)) * (h - 8);
      if (started) x.lineTo(px, py); else { x.moveTo(px, py); started = true; }
    });
    x.stroke();
  };
  line((p) => p.onScreen, '#8fd0a5');
  line((p) => (p.browZ == null ? null : (p.browZ + 1) / 4), '#e7a86a');
  line((p) => p.idleRatio, '#6b9fd4');
}
