# Driver Monitor Dashboard

A browser-based prototype of the in-car UI for a camera-and-sensor driver
monitoring system (DMS) on a supervised-automation vehicle. It renders a
driver's instrument cluster — speedometer, fuel gauge, and the monitoring
status symbol — and simulates the full escalation ladder described in the
project scope:

1. **Symbol** on the dashboard
2. **Beep** (audible alert)
3. **Seat vibration**
4. **Safe pull-over** (only when the driving-automation feature is engaged)
5. **Emergency call** if the driver is still unresponsive after stopping

No build step, no dependencies. Open `dashboard/index.html` in a browser.

## Layout

| Area | What it shows |
|---|---|
| Instrument cluster | Speedometer (0–160 mph), fuel gauge (E–F with low-fuel zone), the alert symbol, the escalation ladder, and telltale lamps (AUTO, HANDS, EYES, SEAT, HAZARD, LOW fuel). |
| Sensor inputs | Which sensors the selected iteration actually has, and what each is reporting right now. |
| Drive simulation | Speed and fuel sliders, automation on/off, and buttons to act out driver behaviour (hands off, eyes closed, gaze off road, phone in hand, slumped posture). "Driver responds" clears everything, the way a real driver would by re-gripping the wheel and looking up. |
| Iteration | Summary, perceived-privacy score, accuracy, added cost, data collected, bill of materials, and detection thresholds for the selected iteration. |
| Accuracy test suite | Runs scripted scenarios against the monitor in accelerated time and reports detected / missed / false-alarm, time to alert, and max escalation level. "Compare all iterations" produces the privacy-vs-accuracy-vs-cost table. |
| Event log | Timestamped record of every state change. |

## The three iterations

| | A — Hands-only | B — Eye-focused IR camera | C — Full-cabin camera |
|---|---|---|---|
| Steering-wheel touch sensor | ✔ | ✔ | ✔ |
| Eye camera (closure, gaze) | – | ✔ | ✔ |
| Cabin camera (hands, phone, posture) | – | – | ✔ |
| Perceived privacy (1–5) | 4.6 | 3.4 | 2.1 |
| Added cost (USD) | 73 | 188 | 303 |

Privacy scores and part prices are **placeholders** so the UI renders. They
live in `js/iterations.js` — replace them with the survey results and the
empirical cost data as the project collects them. Thresholds and sensor
latencies are in the same file, so new iterations can be added by appending
an object to `ITERATIONS`.

## How the monitor decides

`js/monitor.js` is a pure state machine with no DOM access, so the same code
drives both the live cluster and the test suite.

- Each sensed signal (hands off, eyes closed, …) has a per-iteration
  threshold plus a sensor latency. A signal that persists past
  `threshold + latency` becomes a **violation**.
- Any violation starts the ladder at level 1. Without a response the monitor
  escalates at +2.5 s (beep), +5 s (seat), +9 s (pull-over). Pull-over is
  skipped, with a logged reason, if the automation feature is not engaged —
  the car has no way to steer itself to the shoulder.
- During a pull-over the vehicle decelerates at 4 mph/s. Eight seconds after
  stopping with no response, it places the emergency call.
- When every violation clears, levels 1–3 reset immediately. Levels 4–5 are
  latched until the car is at rest and the driver responds.
- Nothing is monitored while the vehicle is parked.

## Test suite

`js/tests.js` holds 11 scenarios: 7 inattentive behaviours (microsleep, long
glance, hands off, texting, phone call, medical slump, asleep & unresponsive)
and 4 normal behaviours that a good system must *not* flag (blinking, mirror
checks, hand-over-hand steering, briefly reaching for a cup). Each is a
timeline of behaviour segments fed to a fresh monitor at 100 ms steps.

Add a scenario by appending to `SCENARIOS`; set `inattentive: true` when the
monitor should alert and `false` when it should stay quiet. Accuracy is the
share of scenarios where the monitor did the right thing.

## Files

```
dashboard/
├── index.html        page structure
├── css/styles.css    cluster + panel styling (dark, responsive)
└── js/
    ├── iterations.js sensor configs, thresholds, privacy + cost data
    ├── gauges.js     SVG analog gauge with smoothed needle
    ├── monitor.js    detection + escalation state machine
    ├── tests.js      scenario definitions and runner
    └── app.js        wiring: sim loop, audio/haptic, panels
```
