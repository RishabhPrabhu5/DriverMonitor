/* ─────────────────────────────────────────────────────────────
   App wiring: gauges, simulation loop, alerts (visual / audio /
   haptic / pull-over / emergency), iteration panel, test runner.
   ───────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const DM = window.DM;
  const $ = id => document.getElementById(id);
  const LADDER_TITLES = { 0: 'Driver attentive', 1: 'Attention warning', 2: 'Audible alert', 3: 'Seat vibration', 4: 'Safe pull-over', 5: 'Emergency call' };

  /* ── state ─────────────────────────────────────────────── */
  const sim = {
    speed: 0, targetSpeed: 0, fuel: 68, automation: true,
    hazards: { handsOff: false, eyesClosed: false, gazeOff: false, phoneInHand: false, slouched: false },
    pullingOver: false,
  };
  let iteration = DM.ITERATIONS[1];
  const monitor = new DM.DriverMonitor(iteration);

  /* ── gauges ───────────────────────────────────────────── */
  const speedo = new DM.Gauge($('speedo'), {
    min: 0, max: 160, startAngle: -135, endAngle: 135, majorStep: 20, minorStep: 10,
    label: 'SPEED', unit: 'MPH',
    zones: [{ from: 80, to: 160, color: '#e3b341' }],
    subtext: v => (sim.automation ? 'AUTO · SUPERVISED' : 'MANUAL'),
  });
  const fuelGauge = new DM.Gauge($('fuel'), {
    min: 0, max: 100, startAngle: -70, endAngle: 70, majorStep: 25, minorStep: 12.5,
    label: 'FUEL', unit: '%', needleLength: 100,
    tickLabels: { 0: 'E', 25: '¼', 50: '½', 75: '¾', 100: 'F' },
    zones: [{ from: 0, to: 12, color: '#ff5c5c' }],
    format: v => String(Math.round(v)),
    subtext: v => `≈ ${Math.round(v / 100 * 14 * 30)} mi range`,   // 14 gal tank, 30 mpg
  });

  /* ── audio (Web Audio beep) ────────────────────────────── */
  const audio = { ctx: null, muted: false, next: 0 };
  function beep(freq, ms) {
    if (audio.muted) return;
    try {
      audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + ms / 1000 + 0.02);
    } catch (_) { /* audio unavailable */ }
  }
  $('mute-btn').addEventListener('click', e => {
    audio.muted = !audio.muted;
    e.currentTarget.textContent = audio.muted ? '🔇 Sound off' : '🔊 Sound on';
    e.currentTarget.setAttribute('aria-pressed', String(audio.muted));
  });

  /* ── alert icon SVGs ───────────────────────────────────── */
  const ICONS = {
    ok: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="#3fb950" stroke-width="4"/><path d="M20 33l8 8 16-18" fill="none" stroke="#3fb950" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    eye: `<svg viewBox="0 0 64 64"><path d="M4 32c8-12 18-18 28-18s20 6 28 18c-8 12-18 18-28 18S12 44 4 32z" fill="none" stroke="#e3b341" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="#e3b341"/><path d="M12 12l40 40" stroke="#e3b341" stroke-width="4" stroke-linecap="round"/></svg>`,
    hands: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#e3b341" stroke-width="4"/><circle cx="32" cy="32" r="7" fill="none" stroke="#e3b341" stroke-width="4"/><path d="M8 32h17M39 32h17M32 39v17" stroke="#e3b341" stroke-width="4"/><path d="M10 10l12 12M54 10L42 22" stroke="#e3b341" stroke-width="4" stroke-linecap="round"/></svg>`,
    warn: `<svg viewBox="0 0 64 64"><path d="M32 6L60 56H4z" fill="none" stroke="#f0883e" stroke-width="4" stroke-linejoin="round"/><path d="M32 24v16" stroke="#f0883e" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="48" r="3" fill="#f0883e"/></svg>`,
    pull: `<svg viewBox="0 0 64 64"><rect x="8" y="26" width="48" height="20" rx="6" fill="none" stroke="#ff5c5c" stroke-width="4"/><path d="M16 26l6-10h20l6 10" fill="none" stroke="#ff5c5c" stroke-width="4"/><circle cx="18" cy="48" r="5" fill="#ff5c5c"/><circle cx="46" cy="48" r="5" fill="#ff5c5c"/><path d="M4 56h56" stroke="#ff5c5c" stroke-width="3" stroke-dasharray="6 4"/></svg>`,
    sos: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="#ff5c5c" stroke-width="4"/><path d="M22 20c0 10 12 22 22 22l4-6-8-4-4 4c-4-2-8-6-10-10l4-4-4-8z" fill="#ff5c5c"/></svg>`,
  };
  function iconFor(level, violations) {
    if (level === 0) return ICONS.ok;
    if (level >= 5) return ICONS.sos;
    if (level >= 4) return ICONS.pull;
    if (level >= 2) return ICONS.warn;
    const keys = violations.map(v => v.key);
    if (keys.includes('eyesClosed') || keys.includes('gazeOff')) return ICONS.eye;
    if (keys.includes('handsOff')) return ICONS.hands;
    return ICONS.warn;
  }

  /* ── event log ─────────────────────────────────────────── */
  const logEl = $('event-log');
  function fmtT(ms) { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; }
  monitor.onEvent = e => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${fmtT(e.t)}</span><span class="l${e.level}">${e.msg}</span>`;
    logEl.prepend(li);
    while (logEl.children.length > 60) logEl.lastChild.remove();
  };

  /* ── iteration panel ───────────────────────────────────── */
  const sel = $('iteration-select');
  DM.ITERATIONS.forEach((it, i) => {
    const o = document.createElement('option');
    o.value = it.id; o.textContent = it.name; if (it === iteration) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    iteration = DM.ITERATIONS.find(i => i.id === sel.value);
    monitor.setIteration(iteration);
    monitor.log(`Switched to ${iteration.name}`, 0);
    renderIteration(); renderSensors(); buildHazardButtons();
    $('test-results').innerHTML = ''; $('m-accuracy').textContent = '–';
  });

  function renderIteration() {
    $('iter-name').textContent = iteration.name;
    $('iter-summary').textContent = iteration.summary;
    $('m-privacy').textContent = iteration.privacy.comfort.toFixed(1);
    $('m-cost').textContent = '$' + DM.totalCost(iteration);
    $('iter-data').innerHTML = iteration.privacy.dataCollected.map(d => `<li>${d}</li>`).join('') + `<li><em>${iteration.privacy.retention}</em></li>`;
    $('iter-bom').querySelector('tbody').innerHTML =
      iteration.parts.map(p => `<tr><td>${p.name}</td><td class="num">${p.usd}</td></tr>`).join('') +
      `<tr><td><strong>Total added cost</strong></td><td class="num"><strong>${DM.totalCost(iteration)}</strong></td></tr>`;
    $('iter-thresholds').querySelector('tbody').innerHTML = Object.keys(DM.SIGNALS).map(k => {
      const s = DM.SIGNALS[k], sensed = DM.canSense(iteration, k);
      const th = iteration.thresholds[k], lat = iteration.latency[s.sensor];
      return `<tr${sensed ? '' : ' style="opacity:.45"'}><td>${s.icon} ${s.label}</td><td class="num">${sensed && th != null ? (th / 1000).toFixed(1) + ' s' : 'not sensed'}</td><td class="num">${sensed ? lat + ' ms' : '–'}</td></tr>`;
    }).join('');
  }

  function renderSensors() {
    const snap = monitor.snapshot();
    $('sensor-list').innerHTML = Object.keys(DM.SENSORS).map(key => {
      const s = DM.SENSORS[key], present = !!iteration.sensors[key];
      const sigs = Object.keys(DM.SIGNALS).filter(k => DM.SIGNALS[k].sensor === key);
      let state = 'not installed', cls = 'na';
      if (present) {
        const active = sigs.filter(k => sim.hazards[k]);
        if (active.length) { state = active.map(k => `${DM.SIGNALS[k].label} ${(snap.timers[k] / 1000).toFixed(1)}s`).join(' · '); cls = 'bad'; }
        else { state = 'nominal'; cls = 'ok'; }
      }
      const glyph = key === 'touch' ? '🖐' : key === 'eye' ? '👁' : '📷';
      return `<li class="${present ? '' : 'absent'}"><span>${glyph}</span><span><div class="s-name">${s.name}</div><div class="s-sub">${s.sub}</div></span><span class="s-state ${cls}">${state}</span></li>`;
    }).join('');
  }

  /* ── hazard buttons ────────────────────────────────────── */
  function buildHazardButtons() {
    document.querySelectorAll('#hazard-toggles .hazard').forEach(btn => {
      const k = btn.dataset.hazard;
      btn.classList.toggle('unsensed', !DM.canSense(iteration, k));
      btn.title = DM.canSense(iteration, k) ? '' : 'This iteration has no sensor for this behaviour — the monitor will not see it.';
      btn.setAttribute('aria-pressed', String(sim.hazards[k]));
    });
  }
  document.querySelectorAll('#hazard-toggles .hazard').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.hazard;
      sim.hazards[k] = !sim.hazards[k];
      btn.setAttribute('aria-pressed', String(sim.hazards[k]));
      if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    });
  });
  $('ack-btn').addEventListener('click', () => {
    for (const k in sim.hazards) sim.hazards[k] = false;
    buildHazardButtons();
    monitor.log('Driver pressed acknowledge', 0);
  });
  $('reset-btn').addEventListener('click', () => {
    for (const k in sim.hazards) sim.hazards[k] = false;
    sim.speed = 0; sim.targetSpeed = 0; sim.fuel = 68; sim.pullingOver = false;
    $('speed-slider').value = 0; $('fuel-slider').value = 68; $('speed-slider').disabled = false;
    monitor.reset(); monitor.onEvent = monitor.onEvent; logEl.innerHTML = '';
    $('emergency-banner').hidden = true;
    buildHazardButtons();
  });

  /* ── sliders / toggles ─────────────────────────────────── */
  $('speed-slider').addEventListener('input', e => { sim.targetSpeed = +e.target.value; });
  $('fuel-slider').addEventListener('input', e => { sim.fuel = +e.target.value; });
  $('auto-toggle').addEventListener('change', e => { sim.automation = e.target.checked; });

  /* ── main loop ─────────────────────────────────────────── */
  let last = performance.now(), beepTimer = 0, vibTimer = 0;
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;

    // vehicle dynamics
    if (sim.pullingOver) {
      sim.targetSpeed = 0;
      sim.speed = Math.max(0, sim.speed - 4 * dt / 1000);              // 4 mph/s controlled decel
    } else {
      const k = 1 - Math.exp(-dt / 600);
      sim.speed += (sim.targetSpeed - sim.speed) * k;
    }
    if (sim.speed > 0.5) sim.fuel = Math.max(0, sim.fuel - (sim.speed / 65) * 0.004 * dt / 1000 * 60); // ~0.24 %/min at 65 mph
    speedo.set(sim.speed); fuelGauge.set(sim.fuel);
    speedo.tick(dt); fuelGauge.tick(dt);
    $('speed-out').textContent = Math.round(sim.speed);
    $('fuel-out').textContent = Math.round(sim.fuel);
    if (!$('fuel-slider').matches(':active')) $('fuel-slider').value = Math.round(sim.fuel);

    // monitor
    const snap = monitor.update(dt, { ...sim.hazards, speed: sim.speed, automationEngaged: sim.automation });

    // pull-over handling
    if (snap.actions.pullOver && !sim.pullingOver) { sim.pullingOver = true; $('speed-slider').disabled = true; }
    if (!snap.actions.pullOver && sim.pullingOver) { sim.pullingOver = false; $('speed-slider').disabled = false; $('speed-slider').value = 0; sim.targetSpeed = 0; }
    $('emergency-banner').hidden = !snap.actions.emergency;

    // audible
    if (snap.actions.beep) {
      beepTimer -= dt;
      if (beepTimer <= 0) {
        const period = snap.level >= 4 ? 300 : snap.level === 3 ? 500 : 1000;
        beep(snap.level >= 4 ? 1200 : 880, 120);
        beepTimer = period;
      }
    } else beepTimer = 0;

    // haptic
    document.body.classList.toggle('vibrating', snap.actions.vibrate);
    if (snap.actions.vibrate) {
      vibTimer -= dt;
      if (vibTimer <= 0) { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); vibTimer = 1000; }
    } else vibTimer = 0;

    renderStatus(snap);
    requestAnimationFrame(frame);
  }

  function renderStatus(snap) {
    const card = $('alert-card');
    card.className = `alert-card level-${snap.level}`;
    $('alert-icon').innerHTML = iconFor(snap.level, snap.violations);
    $('alert-title').textContent = LADDER_TITLES[snap.level];
    let detail;
    if (snap.status === 'idle') detail = 'Monitoring idle — vehicle parked';
    else if (snap.level === 0) detail = `Monitoring · ${iteration.name.split(' — ')[0]}`;
    else if (snap.level >= 5) detail = 'Stopped on shoulder · 911 contacted · awaiting driver response';
    else if (snap.level >= 4) detail = sim.speed > 0.5 ? `Pulling over · ${Math.round(sim.speed)} mph · hazards on` : 'Stopped on shoulder · please respond';
    else detail = snap.violations.map(v => `${v.label} (${(v.ms / 1000).toFixed(1)} s)`).join(' · ') || 'Please pay attention to the road';
    $('alert-detail').textContent = detail;

    document.querySelectorAll('.escalation .step').forEach(s => {
      const lvl = +s.dataset.level;
      s.classList.toggle('active', snap.level >= lvl);
      s.classList.toggle('unavailable', lvl >= 4 && !sim.automation);
    });

    setTT('tt-auto', sim.automation ? 'on' : '');
    setTT('tt-hands', !DM.canSense(iteration, 'handsOff') ? '' : sim.hazards.handsOff ? (snap.violations.some(v => v.key === 'handsOff') ? 'crit' : 'warn') : 'on');
    const eyeSensed = iteration.sensors.eye;
    const eyeBad = sim.hazards.eyesClosed || sim.hazards.gazeOff;
    setTT('tt-eyes', !eyeSensed ? '' : eyeBad ? (snap.violations.some(v => v.key === 'eyesClosed' || v.key === 'gazeOff') ? 'crit' : 'warn') : 'on');
    setTT('tt-seat', snap.actions.vibrate ? 'crit' : '');
    setTT('tt-hazard', snap.actions.pullOver ? 'crit' : '');
    setTT('tt-fuel', sim.fuel <= 12 ? 'warn' : '');

    if ((performance.now() | 0) % 4 === 0) renderSensors();   // throttle DOM rebuild
  }
  function setTT(id, cls) { const e = $(id); e.className = 'telltale' + (cls ? ' ' + cls : ''); }

  /* ── tests ─────────────────────────────────────────────── */
  const OUTCOME = { tp: ['Detected', 'tp'], tn: ['Correctly quiet', 'tn'], fn: ['MISSED', 'fn'], fp: ['False alarm', 'fp'] };
  function resultsTable(suite) {
    const rows = suite.results.map(r => {
      const [txt, cls] = OUTCOME[r.outcome];
      const extra = r.pullOverOk === null ? '' : r.pullOverOk ? ' · pulled over' : ' · <strong>no pull-over</strong>';
      return `<tr><td>${r.scenario.name}</td><td>${r.scenario.inattentive ? 'inattentive' : 'normal'}</td><td><span class="pill ${cls}">${txt}</span>${extra}</td><td class="num">${r.firstAlertLatency == null ? '–' : (r.firstAlertLatency / 1000).toFixed(1) + ' s'}</td><td class="num">${r.maxLevel}</td></tr>`;
    }).join('');
    return `<div class="result-block">
      <h3>${suite.iteration.name}</h3>
      <div class="summary-grid">
        <div class="metric"><span class="metric-label">Accuracy</span><span class="metric-value">${Math.round(suite.accuracy * 100)}%</span><span class="metric-sub">${suite.results.filter(r => r.correct).length} / ${suite.results.length} scenarios</span></div>
        <div class="metric"><span class="metric-label">Recall</span><span class="metric-value">${Math.round(suite.recall * 100)}%</span><span class="metric-sub">inattentive cases caught</span></div>
        <div class="metric"><span class="metric-label">False alarms</span><span class="metric-value">${suite.falsePositives}</span><span class="metric-sub">normal driving flagged</span></div>
        <div class="metric"><span class="metric-label">Mean time to alert</span><span class="metric-value">${suite.meanLatencyMs == null ? '–' : (suite.meanLatencyMs / 1000).toFixed(1) + ' s'}</span><span class="metric-sub">from onset of behaviour</span></div>
      </div>
      <table class="table"><thead><tr><th>Scenario</th><th>Ground truth</th><th>Outcome</th><th class="num">Time to alert</th><th class="num">Max level</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }
  $('run-tests-btn').addEventListener('click', () => {
    const suite = DM.runSuite(iteration);
    $('test-results').innerHTML = resultsTable(suite);
    $('m-accuracy').textContent = Math.round(suite.accuracy * 100) + '%';
    monitor.log(`Test suite: ${Math.round(suite.accuracy * 100)}% accuracy on ${iteration.name}`, 0);
  });
  $('run-all-btn').addEventListener('click', () => {
    const suites = DM.runAll();
    const cmp = `<div class="result-block"><h3>Comparison — privacy vs. accuracy vs. cost</h3>
      <table class="table"><thead><tr><th>Iteration</th><th class="num">Privacy comfort (1–5)</th><th class="num">Accuracy</th><th class="num">Recall</th><th class="num">False alarms</th><th class="num">Mean time to alert</th><th class="num">Added cost</th></tr></thead><tbody>
      ${suites.map(s => `<tr><td>${s.iteration.name}</td><td class="num">${s.iteration.privacy.comfort.toFixed(1)}</td><td class="num">${Math.round(s.accuracy * 100)}%</td><td class="num">${Math.round(s.recall * 100)}%</td><td class="num">${s.falsePositives}</td><td class="num">${s.meanLatencyMs == null ? '–' : (s.meanLatencyMs / 1000).toFixed(1) + ' s'}</td><td class="num">$${DM.totalCost(s.iteration)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('test-results').innerHTML = cmp + suites.map(resultsTable).join('');
    const mine = suites.find(s => s.iteration === iteration);
    $('m-accuracy').textContent = Math.round(mine.accuracy * 100) + '%';
  });

  /* ── boot ──────────────────────────────────────────────── */
  renderIteration(); renderSensors(); buildHazardButtons();
  monitor.log('System ready — drive off to begin monitoring', 0);
  requestAnimationFrame(frame);
})();
