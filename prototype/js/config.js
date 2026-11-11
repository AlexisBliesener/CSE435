/* Lane Management System prototype v2: shared constants.
   Values marked SRS come straight from the SRS. The rest are prototype choices. */
(function () {
  'use strict';
  const L = (window.LMS = window.LMS || {});

  L.MPH = 0.44704; // m/s per mph

  L.CFG = {
    vMin: 35, vMax: 85,          // SRS 2: active only between 35 and 85 mph, exclusive
    qMin: 60,                     // SRS 12.1: image quality threshold (prototype value)
    carW: 1.85, carL: 4.7,
    torqueNm: 5,                  // full steering input = 5 Nm at the wheel
    torqueSig: 3,                 // SRS 10: significant torque (prototype value)
    kd: 0.0016,                   // path curvature per unit of driver steering input
    ldwX: 1.0,                    // SRS 14.2: notify after x seconds out of lane
    lksDelay: 0.6,                // SRS 15.1: driver response window before LKS steers
    captureMs: 100,               // SRS 6: image capture period
    speedCheckMs: 1000,           // SRS Fig 14: speed bounds checked once per second
    noticeS: 5,                   // SRS Fig 19: notifications shown for 5 seconds
    predT: 1.5,                   // path prediction horizon, seconds
    wLcs: 0.5, wLks: 0.8,         // controller bandwidths
    lcsFbClip: 0.00012,           // LCS: small adjustments only
    lksFbClip: 0.0009,            // LKS: larger adjustments
    edgeFbClip: 0.0013,           // LKS next to a road edge (SRS 15.2)
    latAccMax: 2.5,               // LCS steering limit as lateral acceleration, m/s^2 (SRS Fig 4)
    limitHold: 0.6,               // seconds at the limit before "take control"
    resumeDelay: 3,               // seconds without significant steering torque before LMS reactivates after an override
    kAbsMax: 0.012,               // SRS 17.5: valid steering command range (curvature, 1/m)
    laneWMin: 2.8, laneWMax: 4.3, // SRS 3.1: road too narrow or too wide
    disagreeM: 0.5,               // SRS 17.4: camera vs vehicle state disagreement threshold
    driftK: 0.00024,              // drift of a distracted driver
    degPerK: 2407                 // steering wheel degrees per unit curvature (2.8 m wheelbase, 15:1)
  };

  // Requirement trace, numbered as in SRS section 3 (F4 = sequence diagram, Figure 4)
  L.REQS = [
    ['1', 'LMS is made of LDWS, LKS and LCS'],
    ['2', 'Active only between 35 and 85 mph'],
    ['2.1', 'Out of range activation shows the required speed'],
    ['3.1', 'Disabled when the road is too wide or narrow'],
    ['3.2', 'Disabled when lane markings are obscured'],
    ['3.3', 'Disabled when lane markings are faded'],
    ['3.4', 'Disabled when markings are overly complicated'],
    ['3.5', 'Disabled when there are no lane markings'],
    ['4', 'Sensing failure gives a visual and audio alert'],
    ['4.3', 'Activation with a fault shows a diagnostic message'],
    ['5', 'Purposeful shutdown shows a visual alert'],
    ['6', 'Periodic capture: markings, curvature, future and current position'],
    ['7', 'Decision log of position, speed, status, alerts, commands'],
    ['8', 'Driver steering overrides LMS at any time'],
    ['9', 'Turn signal deactivates LMS'],
    ['10', 'Significant steering torque deactivates LMS'],
    ['10.1', 'Reactivates on its own a set time after the driver stops overriding (new)'],
    ['11', 'Turn signal off reactivates LMS'],
    ['12', 'Image capture quality is graded'],
    ['12.1', 'Quality threshold needed to stay active'],
    ['13', 'Driver can enable and disable LMS'],
    ['13.1', 'Audio alert on every enable'],
    ['13.2', 'LMS state shown on the dashboard'],
    ['14.1', 'Departure warning: dashboard, beep, seat and wheel vibration'],
    ['14.2', 'Out of lane notice after x seconds'],
    ['14.3', 'Warning clears once back in the lane'],
    ['14.4', 'Repeated infractions: distracted or tired warning'],
    ['15.1', 'LKS steers back when the driver takes no action'],
    ['15.2', 'LKS prevents drifting off the road'],
    ['15.3', 'LKS inoperable when LDWS is inoperable'],
    ['16.1', 'LCS continuously checks lane markings'],
    ['16.2', 'LCS steers to keep the path centered'],
    ['F4', 'Steering limit reached: warn driver to take control'],
    ['17.3', 'Reject unauthenticated or stale messages'],
    ['17.4', 'Cross-check camera position with vehicle state'],
    ['17.5', 'Validate every steering command range'],
    ['17.6', 'Log every rejected message']
  ];

  // Road environments. Lanes are counted in the driver's direction, left to right.
  L.ROADS = {
    rural2: { name: 'Two-lane rural road', short: 'Rural 2-lane', lanes: 1, oncoming: 1, shoulderL: 0, shoulderR: 0.8, median: false, leftLine: 'double-yellow', leftType: 'solid' },
    hwy2:   { name: 'Divided highway, 2 lanes', short: 'Highway 2 lanes', lanes: 2, oncoming: 0, shoulderL: 1.2, shoulderR: 3.0, median: true, leftLine: 'solid-yellow', leftType: 'solid' },
    hwy3:   { name: 'Divided highway, 3 lanes', short: 'Highway 3 lanes', lanes: 3, oncoming: 0, shoulderL: 1.2, shoulderR: 3.0, median: true, leftLine: 'solid-yellow', leftType: 'solid' },
    hwy4:   { name: 'Divided highway, 4 lanes', short: 'Highway 4 lanes', lanes: 4, oncoming: 0, shoulderL: 1.2, shoulderR: 3.0, median: true, leftLine: 'solid-yellow', leftType: 'solid' }
  };

  // Weather: pen = image quality penalty at full intensity
  L.WEATHER = {
    clear: { name: 'Clear', pen: 0 },
    rain:  { name: 'Rain', pen: 26 },
    fog:   { name: 'Fog', pen: 48 },
    snow:  { name: 'Snow', pen: 24 }
  };

  L.TRAFFIC = { none: { name: 'No traffic', spacing: 0 }, light: { name: 'Light traffic', spacing: 150 }, heavy: { name: 'Heavy traffic', spacing: 55 } };

  L.MARKS = { clear: 'Clear', faded: 'Faded', obscured: 'Obscured', complex: 'Overly complicated', none: 'None' };

  // small shared helpers
  L.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  L.gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v); };
  L.hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  L.fmtT = t => { const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(1).padStart(4, '0'); };
})();
