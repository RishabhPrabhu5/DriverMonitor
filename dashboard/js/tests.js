/* ─────────────────────────────────────────────────────────────
   Accuracy test suite.

   A scenario is a timeline of segments; each segment lasts `ms`
   and sets some driver-behaviour inputs. Everything else defaults
   to an attentive driver at 65 mph with automation engaged.

   `inattentive: true`  → the monitor SHOULD alert  (miss = false negative)
   `inattentive: false` → the monitor should stay quiet (alert = false positive)
   ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';
  const { DriverMonitor, ITERATIONS } = global.DM;

  const SCENARIOS = [
    { id: 'microsleep',  name: 'Microsleep — eyes closed 4 s, hands on wheel',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 4000, eyesClosed: true }, { ms: 3000 }] },
    { id: 'long-glance', name: 'Long glance — gaze off road 6 s (e.g. infotainment)',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 6000, gazeOff: true }, { ms: 3000 }] },
    { id: 'hands-off',   name: 'Hands off wheel 15 s, eyes on road',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 15000, handsOff: true }, { ms: 3000 }] },
    { id: 'texting',     name: 'Texting — phone in hand, eyes down 5 s, one hand on wheel',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 5000, gazeOff: true, phoneInHand: true }, { ms: 3000 }] },
    { id: 'phone-call',  name: 'Phone held to ear 20 s, eyes on road, one hand on wheel',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 20000, phoneInHand: true }, { ms: 3000 }] },
    { id: 'slump',       name: 'Medical event — driver slumps, eyes open, hands slide off after 8 s',
      inattentive: true,  timeline: [{ ms: 2000 }, { ms: 8000, slouched: true }, { ms: 12000, slouched: true, handsOff: true }] },
    { id: 'asleep',      name: 'Driver asleep & unresponsive 60 s (expects pull-over + 911)',
      inattentive: true,  expectPullOver: true,
      timeline: [{ ms: 2000 }, { ms: 60000, eyesClosed: true, handsOff: true }] },
    { id: 'blink',       name: 'Normal blinking — 300 ms closures every 4 s',
      inattentive: false, timeline: blinkPattern(10, 300, 4000) },
    { id: 'mirror',      name: 'Mirror / shoulder check — gaze off 1.5 s, twice',
      inattentive: false, timeline: [{ ms: 2000 }, { ms: 1500, gazeOff: true }, { ms: 3000 }, { ms: 1500, gazeOff: true }, { ms: 2000 }] },
    { id: 'wheel-shuffle', name: 'Hand-over-hand turn — hands off for 1 s bursts',
      inattentive: false, timeline: [{ ms: 2000 }, { ms: 1000, handsOff: true }, { ms: 1000 }, { ms: 1000, handsOff: true }, { ms: 3000 }] },
    { id: 'brief-hands', name: 'Reaching for a cup — both hands off 4 s, eyes on road',
      inattentive: false, timeline: [{ ms: 2000 }, { ms: 4000, handsOff: true }, { ms: 2000 }] },
  ];

  function blinkPattern(count, closeMs, periodMs) {
    const t = [{ ms: 1000 }];
    for (let i = 0; i < count; i++) { t.push({ ms: closeMs, eyesClosed: true }); t.push({ ms: periodMs - closeMs }); }
    return t;
  }

  const DT = 100;
  const DECEL_MPH_PER_S = 4;

  /** Run one scenario against one iteration. Returns a result record. */
  function runScenario(iteration, scenario) {
    const mon = new DriverMonitor(iteration);
    let speed = 65, t = 0, hazardStart = null, firstAlert = null, maxLevel = 0;
    let firstAlertLatency = null;
    for (const seg of scenario.timeline) {
      const isHazard = !!(seg.handsOff || seg.eyesClosed || seg.gazeOff || seg.phoneInHand || seg.slouched);
      if (isHazard && hazardStart == null) hazardStart = t;
      for (let e = 0; e < seg.ms; e += DT) {
        const snap = mon.update(DT, {
          handsOff: !!seg.handsOff, eyesClosed: !!seg.eyesClosed, gazeOff: !!seg.gazeOff,
          phoneInHand: !!seg.phoneInHand, slouched: !!seg.slouched,
          speed, automationEngaged: true,
        });
        if (snap.actions.pullOver) speed = Math.max(0, speed - DECEL_MPH_PER_S * DT / 1000);
        if (snap.level >= 1 && firstAlert == null) { firstAlert = t; firstAlertLatency = hazardStart != null ? t - hazardStart : t; }
        maxLevel = Math.max(maxLevel, snap.level);
        t += DT;
      }
    }
    const alerted = firstAlert != null;
    let outcome;
    if (scenario.inattentive) outcome = alerted ? 'tp' : 'fn';
    else outcome = alerted ? 'fp' : 'tn';
    const pullOverOk = scenario.expectPullOver ? maxLevel >= 4 : null;
    return { scenario, alerted, firstAlertLatency, maxLevel, outcome, pullOverOk, correct: outcome === 'tp' || outcome === 'tn' };
  }

  function runSuite(iteration) {
    const results = SCENARIOS.map(s => runScenario(iteration, s));
    const n = results.length;
    const correct = results.filter(r => r.correct).length;
    const positives = results.filter(r => r.scenario.inattentive);
    const detected = positives.filter(r => r.alerted);
    const latencies = detected.map(r => r.firstAlertLatency);
    return {
      iteration, results,
      accuracy: correct / n,
      recall: detected.length / positives.length,
      falsePositives: results.filter(r => r.outcome === 'fp').length,
      meanLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    };
  }

  function runAll() { return ITERATIONS.map(runSuite); }

  Object.assign(global.DM, { SCENARIOS, runScenario, runSuite, runAll });
})(window);
