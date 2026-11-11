/* Scripted scenarios. Scenarios 1 to 4 are the customer's (GM problem statement).
   Scenarios 5 and 6 exercise the road environments: traffic and weather.

   A step fires after dt seconds, and when it has a cond, once cond is true (or after max seconds).
   env   = road, weather, traffic and fault events. Always run.
   drive = what the driver does. Run only when the automatic driver is driving.
   you   = the prompt shown instead when the user has chosen self drive. */
(function () {
  'use strict';
  const L = window.LMS;
  const en = s => s.ctrl.pressEnable();
  const PRESS_L = 'Press L (or Enable LMS in the Driver tab) to turn LMS on.';

  L.SCENARIOS = [
    {
      key: 's1', tab: '1 Ideal road', title: 'Scenario 1: ideal conditions',
      summary: 'Straight road, clear markings, clear day and steady speed. The driver tries to enable LMS too slowly, enables it at 65 mph, then gets distracted. Watch the warning, the LKS correction and the repeated infraction notice.',
      init: s => s.reset({ env: { road: 'hwy2', traffic: 'none', weather: 'clear', curv: 0 }, lane: 1, speed: 25, y: 0.4 }),
      view: 'fpv',
      steps: [
        { dt: 1, text: 'Driver presses LMS at 25 mph. The dashboard shows the required speed range.', drive: en, you: 'Press L while still at 25 mph. The dashboard shows the required speed range.' },
        { dt: 3, text: 'Driver accelerates to 65 mph.', drive: s => { s.ego.target = 65; }, you: 'Hold W to speed up to about 65 mph.' },
        { dt: 11, text: 'Driver enables LMS. A chime plays and the dashboard shows ACTIVE. Lane centering pulls the car in from 40 cm off center.', drive: en, you: PRESS_L + ' A chime plays and lane centering takes over.' },
        { dt: 7, text: 'Driver gets distracted. The car drifts left toward the dashed lane line.', env: s => { s.driver.driftDir = -1; }, drive: s => s.setAttention('distracted'), you: 'Press F to act distracted. The car drifts left toward the dashed line.' },
        { cond: s => s.ctrl.ldw, max: 25, text: 'The car crosses the line. Dashboard notice, beep, and seat and wheel vibration.' },
        { cond: s => s.ctrl.lks, max: 12, text: 'The driver does not react, so LKS gently steers the car back toward the lane center.' },
        { cond: s => !s.ctrl.lks && !s.ctrl.ldw, max: 15, text: 'The car is back near the center and the warning has cleared.' },
        { cond: s => s.ctrl.fatigue > 0, max: 70, text: 'After three departures in a short time the dashboard warns about distracted or tired driving.' },
        { dt: 2, text: 'Driver pays attention again. Lane centering holds the car in the middle.', drive: s => s.setAttention('attentive'), you: 'Press F again to pay attention. Lane centering holds the car.' }
      ]
    },
    {
      key: 's2', tab: '2 Curves', title: 'Scenario 2: changing road curvature',
      summary: 'A sequence of curves stresses the system. LCS adds the measured curvature to its steering, but it has a steering limit. On a tight curve at speed it asks the driver to take control. Very tight curves push the markings out of the camera view.',
      init: s => s.reset({ env: { road: 'hwy2', traffic: 'none', weather: 'clear', curv: 0 }, lane: 1, speed: 65, y: 0.2, active: true }),
      view: 'chase',
      steps: [
        { dt: 3, text: 'Straight road at 65 mph. LCS holds the lane center.' },
        { dt: 1, text: 'Gentle right curve, 800 m radius.', env: s => s.setEnv({ curv: 1 / 800 }) },
        { dt: 12, text: 'Left curve, 400 m radius. LCS steers with the measured curvature.', env: s => s.setEnv({ curv: -1 / 400 }) },
        { dt: 12, text: 'Right curve, 250 m radius. At 65 mph this needs more than the LCS limit of 2.5 m/s² lateral acceleration.', env: s => s.setEnv({ curv: 1 / 250 }) },
        { cond: s => s.ctrl.mode === 'TAKEOVER', max: 16, text: 'LCS is at its steering limit and the car slides off center. The dashboard tells the driver to take control and LMS deactivates.' },
        { dt: 2, text: 'Driver takes the curve and slows to 45 mph.', drive: s => { s.ego.target = 45; }, you: 'Take the curve yourself with A and D, and slow to about 45 mph with S.' },
        { cond: s => s.ego.speed < 46, max: 15, text: 'Driver enables LMS again at 45 mph. The same curve is now within the limit.', drive: en, you: PRESS_L + ' At 45 mph the same curve is within the limit.' },
        { dt: 8, text: 'Tighter left curve, 180 m radius. Image quality falls as the markings bend away.', env: s => s.setEnv({ curv: -1 / 180 }) },
        { dt: 10, text: 'Driver slows to 40 mph.', drive: s => { s.ego.target = 40; }, you: 'Slow to about 40 mph with S.' },
        { dt: 6, text: 'Hairpin to the right, 130 m radius. The camera loses the lane.', env: s => s.setEnv({ curv: 1 / 130 }) },
        { cond: s => s.ctrl.mode === 'FAULT', max: 16, text: 'Image quality falls below 60. LMS disables with a visual and audio alert.' },
        { dt: 4, text: 'Road straightens and the driver speeds up to 60 mph. LMS stays off.', env: s => s.setEnv({ curv: 0 }), drive: s => { s.ego.target = 60; }, you: 'The road straightens. Speed up to about 60 mph with W.' },
        { dt: 10, text: 'Driver enables LMS.', drive: en, you: PRESS_L }
      ]
    },
    {
      key: 's3', tab: '3 Failures', title: 'Scenario 3: failures and confusing lane information',
      summary: 'Lane information becomes confusing or absent and subsystems fail. Each condition disables LMS with a visual and audio alert. An LDWS fault takes lane keeping down with it. Security checks reject bad inputs.',
      init: s => s.reset({ env: { road: 'hwy2', traffic: 'none', weather: 'clear', curv: 0 }, lane: 1, speed: 65, y: 0.2, active: true }),
      view: 'overhead',
      steps: [
        { dt: 3, text: 'Dirt builds up on the camera lens.', env: s => s.tween('dirt', 70, 8) },
        { cond: s => s.ctrl.mode === 'FAULT', max: 14, text: 'Image quality falls below 60. LMS disables with a visual and audio alert.' },
        { dt: 4, text: 'Driver tries to enable LMS anyway. A diagnostic message explains why not.', drive: en, you: 'Press L anyway. A diagnostic message explains why LMS cannot turn on.' },
        { dt: 4, text: 'Lens cleaned. LMS stays off until the driver enables it.', env: s => { s.tweens = []; s.setEnv({ dirt: 0 }); } },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'Construction zone: old and new lines overlap, so more boundaries are detected than expected.', env: s => s.setEnv({ marks: 'complex' }) },
        { dt: 5, text: 'Construction zone ends.', env: s => s.setEnv({ marks: 'clear' }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'The lane markings fade.', env: s => s.setEnv({ marks: 'faded' }) },
        { dt: 5, text: 'Fresh paint again.', env: s => s.setEnv({ marks: 'clear' }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'A freshly paved stretch has no lane markings yet.', env: s => s.setEnv({ marks: 'none' }) },
        { dt: 5, text: 'Markings return.', env: s => s.setEnv({ marks: 'clear' }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'A work zone narrows the lanes to 2.6 m, too narrow for accurate decisions.', env: s => s.setEnv({ laneW: 2.6 }) },
        { dt: 5, text: 'Normal 3.7 m lanes again.', env: s => s.setEnv({ laneW: 3.7 }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'The camera fails.', env: s => s.setEnv({ camFail: true }) },
        { dt: 4, text: 'Camera restored.', env: s => s.setEnv({ camFail: false }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'Vehicle state sensors are lost.', env: s => s.setEnv({ vseFail: true }) },
        { dt: 4, text: 'Sensors restored.', env: s => s.setEnv({ vseFail: false }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'Camera lane position and vehicle state disagree by 0.9 m. LMS treats it as inaccurate sensing.', env: s => s.setEnv({ mismatch: true }) },
        { dt: 4, text: 'The two agree again.', env: s => s.setEnv({ mismatch: false }) },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 3, text: 'A forged steering-system message arrives. LMS rejects and logs it and keeps working.', env: s => s.inject('forged') },
        { dt: 3, text: 'A corrupted steering command is caught by the range check before it is sent.', env: s => s.inject('corrupt') },
        { dt: 3, text: 'The LDWS module faults while the driver drifts. LKS is unavailable, so only gentle centering remains.', env: s => { s.setEnv({ ldwFail: true }); s.driver.driftDir = -1; }, drive: s => s.setAttention('distracted'), you: 'LDWS has faulted. Press F to drift and see that no warning or lane keeping comes.' },
        { dt: 7, text: 'LDWS restored and the driver pays attention again.', env: s => s.setEnv({ ldwFail: false }), drive: s => s.setAttention('attentive'), you: 'LDWS is back. Press F to pay attention again.' }
      ]
    },
    {
      key: 's4', tab: '4 Handoff', title: 'Scenario 4: control passes between driver and LMS',
      summary: 'A lane change with the turn signal pauses and resumes LMS. When the driver overrides by steering, LMS reactivates on its own a few seconds after they let go (3 s by default, set in the Driver tab), in whichever lane the car is in. Finally the driver turns LMS off.',
      init: s => s.reset({ env: { road: 'hwy3', traffic: 'light', weather: 'clear', curv: 0 }, lane: 1, speed: 60, y: 0.4, active: true }),
      view: 'chase',
      steps: [
        { dt: 4, text: 'Driver signals right. The turn signal pauses LMS and the driver steers into the right lane.', drive: s => s.changeLane(1), you: 'Press E to signal right, steer into the right lane with D, then press E to cancel the signal. (X does the whole lane change for you.)' },
        { cond: s => !s.driver.maneuver && s.signal === 0 && s.ctrl.mode === 'ACTIVE' && s.laneOf(s.ego.d) === 2, max: 15, text: 'Signal off. LMS reactivates and centers the car in the new lane.' },
        { dt: 5, text: 'The driver gets distracted and the car drifts left.', env: s => { s.driver.driftDir = -1; }, drive: s => s.setAttention('distracted'), you: 'Press F to act distracted. The car drifts left.' },
        { cond: s => s.ctrl.lks, max: 25, text: 'LKS starts steering the car back.' },
        { dt: 0.7, text: 'The driver grabs the wheel and steers hard. The torque overrides LMS and the driver has control.', drive: s => { s.setAttention('attentive'); s.driver.steer = 0.8; }, you: 'Grab the wheel: hold D firmly. Steering past 60% overrides LMS.' },
        { dt: 0.6, text: 'Driver lets go of the wheel. The re-enable countdown starts.', drive: s => { s.driver.steer = 0; }, you: 'Let go of the wheel. The re-enable countdown starts.' },
        { cond: s => s.ctrl.mode === 'ACTIVE', max: 15, text: 'The countdown ends and LMS reactivates on its own in the same lane. No button press needed.' },
        { dt: 5, text: 'The driver steers by hand toward the middle lane without signaling. The torque overrides LMS again.', drive: s => { s.driver.steer = -0.75; }, you: 'Without signaling, steer firmly with A into the middle lane.' },
        { dt: 1.7, text: 'Driver straightens out.', drive: s => { s.driver.steer = 0.75; }, you: 'Straighten out with D.' },
        { dt: 1.5, text: 'Driver relaxes their grip. The countdown starts again.', drive: s => { s.driver.steer = 0; }, you: 'Let go. Even if the car is between lanes, LMS comes back when the countdown ends.' },
        { cond: s => s.ctrl.mode === 'ACTIVE', max: 15, text: 'LMS reactivates in the lane the car is in and steers it to the center.' },
        { dt: 6, text: 'Driver turns LMS off on purpose. The dashboard shows a visual alert.', drive: en, you: 'Press L to turn LMS off. The dashboard shows a visual alert.' }
      ]
    },
    {
      key: 's5', tab: '5 Traffic', title: 'Scenario 5: multiple lanes and traffic',
      summary: 'Heavy traffic on a 4-lane highway. LMS only follows lane markings and does not react to other vehicles. Vehicles close by can hide markings. Next to the road edge, LKS steers without waiting for the driver.',
      init: s => s.reset({ env: { road: 'hwy4', traffic: 'heavy', weather: 'clear', curv: 0 }, lane: 1, speed: 62, y: 0.2, active: true }),
      view: 'overhead',
      steps: [
        { dt: 4, text: 'Heavy traffic. LMS tracks the lane markings only; it does not detect the vehicles around it.' },
        { dt: 1, text: 'A car in the next lane cuts in ahead. LMS keeps centering and does not react; vehicles are left for a future version.', env: s => s.traffic.cutIn() },
        { dt: 8, text: 'Driver signals right and moves to lane 3.', drive: s => s.changeLane(1), you: 'Move to lane 3: signal with E and steer with D when there is a gap, or press X.' },
        { cond: s => !s.driver.maneuver && s.signal === 0 && s.ctrl.mode === 'ACTIVE' && s.laneOf(s.ego.d) === 2, max: 15, text: 'LMS resumes in lane 3.' },
        { dt: 3, text: 'Driver moves again, to the rightmost lane next to the road edge.', drive: s => s.changeLane(1), you: 'Move to the rightmost lane the same way.' },
        { cond: s => !s.driver.maneuver && s.signal === 0 && s.ctrl.mode === 'ACTIVE' && s.laneOf(s.ego.d) === 3, max: 15, text: 'LMS resumes in lane 4. Its right boundary is the road edge.' },
        { dt: 4, text: 'The driver gets distracted and drifts right toward the road edge.', env: s => { s.driver.driftDir = 1; }, drive: s => s.setAttention('distracted'), you: 'Press F to act distracted. The car drifts right toward the road edge.' },
        { cond: s => s.ctrl.lks, max: 20, text: 'The boundary is the road edge, so LKS steers at once instead of waiting for the driver.' },
        { cond: s => !s.ctrl.lks && !s.ctrl.ldw, max: 15, text: 'The car is back in its lane.' },
        { dt: 3, text: 'Driver pays attention again.', drive: s => s.setAttention('attentive'), you: 'Press F again to pay attention.' }
      ]
    },
    {
      key: 's6', tab: '6 Weather', title: 'Scenario 6: weather and light',
      summary: 'Rain, darkness, wind, fog and snow lower the camera image quality. When quality drops below 60, or snow covers the markings, LMS disables and alerts the driver.',
      init: s => s.reset({ env: { road: 'hwy2', traffic: 'light', weather: 'clear', intensity: 0, curv: 0 }, lane: 1, speed: 60, y: 0.2, active: true }),
      view: 'fpv',
      steps: [
        { dt: 3, text: 'Clear day. Image quality is near 97.' },
        { dt: 1, text: 'Rain starts.', env: s => { s.setEnv({ weather: 'rain', intensity: 0 }); s.tween('intensity', 0.45, 3); } },
        { dt: 6, text: 'Heavy rain. Spray and water on the road lower the image quality.', env: s => s.tween('intensity', 1, 4) },
        { dt: 8, text: 'Night falls. Rain at night drops quality below 60.', env: s => s.setEnv({ night: true }) },
        { cond: s => s.ctrl.mode === 'FAULT', max: 12, text: 'LMS disables with a visual and audio alert.' },
        { dt: 4, text: 'The rain eases.', env: s => s.tween('intensity', 0.3, 3) },
        { cond: s => s.ctrl.mode !== 'FAULT', max: 12, text: 'Image quality recovers. LMS stays off until the driver enables it.' },
        { dt: 2, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 5, text: 'Gusty crosswind. LCS corrects the small pushes.', env: s => s.setEnv({ wind: true }) },
        { dt: 8, text: 'Fog rolls in.', env: s => { s.setEnv({ wind: false, weather: 'fog', intensity: 0 }); s.tween('intensity', 0.95, 7); } },
        { cond: s => s.ctrl.mode === 'FAULT', max: 14, text: 'Fog drops image quality below 60. LMS disables.' },
        { dt: 5, text: 'The fog lifts and daylight returns.', env: s => { s.tweens = []; s.setEnv({ weather: 'clear', intensity: 0, night: false }); } },
        { dt: 3, text: 'Driver enables LMS.', drive: en, you: PRESS_L },
        { dt: 4, text: 'Snow starts.', env: s => { s.setEnv({ weather: 'snow', intensity: 0 }); s.tween('intensity', 0.35, 3); } },
        { dt: 6, text: 'Heavy snow covers the lane markings.', env: s => s.tween('intensity', 0.85, 5) },
        { cond: s => s.ctrl.mode === 'FAULT', max: 12, text: 'Covered markings disable LMS.' }
      ]
    },
    {
      key: 'free', tab: 'Free drive', title: 'Free drive',
      summary: 'No script. The automatic driver holds the lane at 60 mph while you change the road, traffic and weather. Choose Self drive to take the wheel yourself.',
      init: s => s.reset({ env: { road: 'hwy3', traffic: 'light', weather: 'clear', curv: 0 }, lane: 1, speed: 60 }),
      view: 'chase',
      steps: []
    }
  ];

  class Runner {
    constructor(sim, i) {
      this.sim = sim; this.i = i; this.sc = L.SCENARIOS[i];
      this.idx = 0; this.last = 0; this.done = this.sc.steps.length === 0; this.dirty = true;
    }
    tick() {
      if (this.done) return;
      const st = this.sc.steps[this.idx], w = this.sim.t - this.last;
      if (w >= (st.dt || 0) && (!st.cond || st.cond(this.sim) || w >= (st.max || 25))) this.fire();
    }
    fire() {
      if (this.done) return;
      const st = this.sc.steps[this.idx], sim = this.sim;
      if (st.env) st.env(sim);
      const self = sim.driverMode === 'self';
      if (st.drive && !self) st.drive(sim);
      this.last = sim.t; this.idx++;
      if (this.idx >= this.sc.steps.length) this.done = true;
      this.dirty = true;
      sim.emit('step', { idx: this.idx, step: st, prompt: self && st.you ? st.you : null });
    }
  }

  L.Runner = Runner;
  L.startScenario = (sim, i) => {
    const sc = L.SCENARIOS[i];
    sim.runner = null;
    sc.init(sim);
    sim.runner = new Runner(sim, i);
    return sim.runner;
  };
})();
