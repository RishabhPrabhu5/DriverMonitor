/* ─────────────────────────────────────────────────────────────
   DriverMonitor — the detection + escalation state machine.

   Inputs each tick (all booleans unless noted):
     handsOff, eyesClosed, gazeOff, phoneInHand, slouched,
     speed (mph), automationEngaged

   Escalation ladder (level):
     0  attentive
     1  dashboard symbol
     2  + audible beep
     3  + seat vibration
     4  + safe pull-over (needs automation engaged)
     5  + emergency call once stopped and still unresponsive

   The monitor is pure: it does not touch the DOM, so the test
   suite can drive it in accelerated time.
   ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';
  const { SIGNALS, canSense } = global.DM;

  const LADDER = [
    { level: 1, key: 'visual',    title: 'Attention warning',  after: 0 },
    { level: 2, key: 'audible',   title: 'Audible alert',      after: 2500 },
    { level: 3, key: 'haptic',    title: 'Seat vibration',     after: 5000 },
    { level: 4, key: 'pullover',  title: 'Safe pull-over',     after: 9000 },
    { level: 5, key: 'emergency', title: 'Emergency call',     after: 8000 }, // measured from vehicle stop
  ];

  class DriverMonitor {
    constructor(iteration) {
      this.setIteration(iteration);
      this.reset();
    }

    setIteration(iteration) {
      this.iteration = iteration;
    }

    reset() {
      this.clock = 0;
      this.timers = {};              // signal → ms the signal has been continuously present
      for (const k in SIGNALS) this.timers[k] = 0;
      this.level = 0;
      this.escalationMs = 0;         // ms since level 1 began
      this.stoppedMs = null;         // clock when vehicle came to rest during pull-over
      this.pullOverActive = false;
      this.emergencyCalled = false;
      this.violations = [];
      this.status = 'idle';          // idle | monitoring | alert | pullover | emergency
      this.events = [];
      this.onEvent = null;
    }

    log(msg, level) {
      const e = { t: this.clock, msg, level: level ?? this.level };
      this.events.push(e);
      if (this.onEvent) this.onEvent(e);
    }

    /** threshold (ms) after which a signal counts as a violation, incl. sensor latency; null if unsensed */
    thresholdFor(key) {
      if (!canSense(this.iteration, key)) return null;
      const base = this.iteration.thresholds[key];
      if (base == null) return null;
      const lat = this.iteration.latency[SIGNALS[key].sensor] || 0;
      return base + lat;
    }

    /** @param dt ms, @param inp inputs */
    update(dt, inp) {
      this.clock += dt;
      const moving = inp.speed > 0.5;

      // Parked and not mid-intervention → nothing to monitor.
      if (!moving && this.level < 4) {
        for (const k in this.timers) this.timers[k] = 0;
        if (this.level !== 0) this.log('Vehicle stopped — alert cleared', 0);
        this.level = 0; this.escalationMs = 0; this.violations = [];
        this.status = 'idle';
        return this.snapshot();
      }

      // Accumulate per-signal timers for signals this iteration can sense.
      for (const k in SIGNALS) {
        if (!canSense(this.iteration, k)) { this.timers[k] = 0; continue; }
        this.timers[k] = inp[k] ? this.timers[k] + dt : 0;
      }

      // Which signals have crossed their threshold?
      const violations = [];
      for (const k in SIGNALS) {
        const th = this.thresholdFor(k);
        if (th != null && this.timers[k] >= th) {
          violations.push({ key: k, label: SIGNALS[k].label, ms: this.timers[k], threshold: th });
        }
      }
      this.violations = violations;

      if (violations.length) {
        if (this.level === 0) {
          this.level = 1; this.escalationMs = 0;
          this.log(`${violations.map(v => v.label).join(', ')} → dashboard symbol`, 1);
        } else {
          this.escalationMs += dt;
        }
        // climb the ladder
        if (this.level === 1 && this.escalationMs >= LADDER[1].after) {
          this.level = 2; this.log('No response → audible alert', 2);
        }
        if (this.level === 2 && this.escalationMs >= LADDER[2].after) {
          this.level = 3; this.log('No response → seat vibration', 3);
        }
        if (this.level === 3 && this.escalationMs >= LADDER[3].after) {
          if (inp.automationEngaged) {
            this.level = 4; this.pullOverActive = true; this.stoppedMs = null;
            this.log('Driver unresponsive → initiating safe pull-over (hazards on)', 4);
          } else if (!this._warnedNoAuto) {
            this._warnedNoAuto = true;
            this.log('Pull-over unavailable: automation not engaged — holding at seat vibration', 3);
          }
        }
        if (this.level === 4 && !moving) {
          if (this.stoppedMs == null) { this.stoppedMs = this.clock; this.log('Vehicle stopped on shoulder — prompting driver', 4); }
          else if (this.clock - this.stoppedMs >= LADDER[4].after && !this.emergencyCalled) {
            this.level = 5; this.emergencyCalled = true;
            this.log('Still unresponsive → emergency call placed, location shared', 5);
          }
        }
        this.status = this.level >= 5 ? 'emergency' : this.level >= 4 ? 'pullover' : 'alert';
      } else {
        // No active violation.
        if (this.level >= 1 && this.level < 4) {
          this.log('Driver re-engaged — alert cleared', 0);
          this.level = 0; this.escalationMs = 0; this._warnedNoAuto = false;
          this.status = 'monitoring';
        } else if (this.level >= 4) {
          // Pull-over is latched until the car is at rest, then clears when driver responds.
          if (!moving) {
            this.log(this.emergencyCalled ? 'Driver responsive — dispatcher informed, call ended' : 'Pull-over complete — driver responsive', 0);
            this.level = 0; this.escalationMs = 0; this.pullOverActive = false; this.stoppedMs = null;
            this.emergencyCalled = false; this._warnedNoAuto = false;
            this.status = 'idle';
          } else {
            this.status = 'pullover';
          }
        } else {
          this.status = 'monitoring';
        }
      }
      return this.snapshot();
    }

    snapshot() {
      return {
        level: this.level,
        status: this.status,
        violations: this.violations,
        timers: this.timers,
        pullOverActive: this.pullOverActive,
        emergencyCalled: this.emergencyCalled,
        actions: {
          visual: this.level >= 1,
          beep: this.level >= 2,
          vibrate: this.level >= 3,
          pullOver: this.level >= 4,
          emergency: this.level >= 5,
        },
      };
    }
  }

  global.DM.DriverMonitor = DriverMonitor;
  global.DM.LADDER = LADDER;
})(window);
