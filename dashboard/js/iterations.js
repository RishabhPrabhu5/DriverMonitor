/* ─────────────────────────────────────────────────────────────
   Sensor iterations for the DriverMonitor prototype.

   Each iteration is one configuration of the monitoring system.
   The ethics analysis evaluates every iteration on three axes:
     • perceived privacy  → survey comfort score (1 = very uncomfortable, 5 = very comfortable)
     • accuracy / safety  → computed by the test suite (js/tests.js)
     • cost               → bill of materials, USD per vehicle

   NOTE: privacy scores and component prices below are PLACEHOLDER
   estimates so the dashboard renders. Replace them with the team's
   survey results and empirical cost data as they come in.
   ───────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // Signals the monitor can reason about, and the human-readable label used in the UI.
  const SIGNALS = {
    handsOff:   { label: 'Hands off wheel',     sensor: 'touch',  icon: '🖐' },
    eyesClosed: { label: 'Eyes closed',          sensor: 'eye',    icon: '😴' },
    gazeOff:    { label: 'Gaze off road',        sensor: 'eye',    icon: '👀' },
    phoneInHand:{ label: 'Phone in hand',        sensor: 'cabin',  icon: '📱' },
    slouched:   { label: 'Slumped posture',      sensor: 'cabin',  icon: '🪑' },
  };

  const SENSORS = {
    touch: { name: 'Steering-wheel touch sensor', sub: 'capacitive, both rim halves' },
    eye:   { name: 'Eye-focused IR camera',       sub: 'steering column, 30 fps, infrared' },
    cabin: { name: 'Full-cabin camera',           sub: 'wide-angle RGB + IR, overhead console' },
  };

  const SHARED_PARTS = [
    { name: 'Dashboard telltale + buzzer', usd: 8 },
    { name: 'Seat vibration motors (×2)', usd: 30 },
  ];

  const ITERATIONS = [
    {
      id: 'A',
      name: 'Iteration A — Hands-only',
      summary: 'Capacitive touch sensor in the steering wheel. No camera at all. The system only knows whether the wheel is being held; it cannot tell if the driver is awake or looking at the road.',
      sensors: { touch: true, eye: false, cabin: false },
      // ms the signal must persist before it counts as a violation
      thresholds: { handsOff: 10000 },
      // ms of sensor pipeline delay before the signal is even seen
      latency: { touch: 200 },
      privacy: {
        comfort: 4.6,
        dataCollected: ['Wheel-contact state (on/off)', 'Timestamps of hands-off intervals'],
        retention: 'No imagery. Contact state is processed in the steering-column ECU and never leaves the vehicle.',
      },
      parts: [
        { name: 'Capacitive steering-wheel touch sensor', usd: 35 },
        ...SHARED_PARTS,
      ],
    },
    {
      id: 'B',
      name: 'Iteration B — Eye-focused IR camera',
      summary: 'Adds a narrow-field infrared camera aimed only at the eye region. Detects eyelid closure and gaze direction. Cannot see hands, phone, or the rest of the cabin.',
      sensors: { touch: true, eye: true, cabin: false },
      thresholds: { handsOff: 10000, eyesClosed: 2000, gazeOff: 4000 },
      latency: { touch: 200, eye: 400 },
      privacy: {
        comfort: 3.4,
        dataCollected: ['Wheel-contact state', 'Eyelid aperture (%)', 'Gaze vector (on-road / off-road)'],
        retention: 'Frames are processed on-device and discarded; only derived metrics (eye openness, gaze zone) are kept for the trip.',
      },
      parts: [
        { name: 'Capacitive steering-wheel touch sensor', usd: 35 },
        { name: 'Near-infrared eye-tracking camera', usd: 75 },
        { name: 'Vision processor (low power)', usd: 40 },
        ...SHARED_PARTS,
      ],
    },
    {
      id: 'C',
      name: 'Iteration C — Full-cabin camera',
      summary: 'Wide-angle cabin camera that sees the whole driver: face, hands, posture, and objects such as phones. Most accurate and earliest detection, but records the most about the occupant.',
      sensors: { touch: true, eye: true, cabin: true },
      thresholds: { handsOff: 10000, eyesClosed: 1500, gazeOff: 3000, phoneInHand: 3000, slouched: 5000 },
      latency: { touch: 200, eye: 250, cabin: 300 },
      privacy: {
        comfort: 2.1,
        dataCollected: ['Wheel-contact state', 'Eyelid aperture & gaze vector', 'Hand position / held objects', 'Body pose', 'Passenger presence (incidental)'],
        retention: 'Full-cabin frames processed on-device; a 30 s rolling buffer may be uploaded to the manufacturer after a safety event.',
      },
      parts: [
        { name: 'Capacitive steering-wheel touch sensor', usd: 35 },
        { name: 'Wide-angle RGB-IR cabin camera', usd: 140 },
        { name: 'Vision processor (neural accelerator)', usd: 90 },
        ...SHARED_PARTS,
      ],
    },
  ];

  function totalCost(iter) {
    return iter.parts.reduce((s, p) => s + p.usd, 0);
  }

  function canSense(iter, signalKey) {
    const sig = SIGNALS[signalKey];
    return !!(sig && iter.sensors[sig.sensor]);
  }

  global.DM = global.DM || {};
  Object.assign(global.DM, { SIGNALS, SENSORS, ITERATIONS, totalCost, canSense });
})(window);
