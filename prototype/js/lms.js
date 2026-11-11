/* Supervisory Control System and the three LMS subsystems (LDWS, LKS, LCS).
   Runs once per image capture (SRS 6). No DOM access, so it can be tested headless. */
(function () {
  'use strict';
  const L = window.LMS;
  const clamp = L.clamp, gauss = L.gauss;

  class Controller {
    constructor(sim) { this.sim = sim; this.reset(); }

    reset() {
      Object.assign(this, {
        mode: 'OFF', reasons: [], wasActive: false, homeLane: null,
        kCmd: 0, fbDeg: 0, out: false, outSide: 0,
        ldw: false, ldwStart: 0, xDone: false, lastWarn: -9,
        lks: false, lksEdge: false, sub: 'idle',
        q: 97, qFault: false, ym: 0, yTrue: 0, psim: 0, km: 0, nb: 2,
        infr: [], lastFatigue: -999, fatigue: 0, lastCmdLog: -99, ldwNoted: false,
        predY: 0, predOut: false, limitT: 0, limited: false, speedAcc: 0,
        occl: 0, occlBy: '', lastOcclLog: -99, disagree: 0,
        corruptNext: false, validated: 0, rejected: 0, resumeT: 0, overrideLane: null
      });
    }

    laneLim() { return (this.sim.env.laneW - L.CFG.carW) / 2; }

    /* ---------- SRS 12: grade image capture quality ---------- */
    gradeQuality() {
      const S = this.sim, env = S.env;
      let pen = env.dirt * 0.7 + L.WEATHER[env.weather].pen * env.intensity + (env.night ? 12 : 0);
      const ak = Math.abs(S.road.kAt(S.ego.s + 15));
      pen += Math.max(0, ak - 0.003) * 9000;          // tight curves push markings out of view
      pen += this.occlusion();
      let q = 97 - pen + gauss() * 1.0;
      if (env.camFail) q = 0;
      return clamp(q, 0, 100);
    }

    // vehicles are not detected, but they can hide the markings from the camera
    occlusion() {
      const S = this.sim, eg = S.ego, W = S.env.laneW;
      let pen = 0, by = '';
      for (const c of S.traffic.cars) {
        if (c.onc) continue;
        const rel = c.s - eg.s, dd = Math.abs(c.d - eg.d);
        if (dd < W * 0.6 && rel > 0 && rel < 20) { const p = 4 + 16 * (1 - rel / 20); if (p > pen) { pen = p; by = 'lead'; } }
        else if (dd < W * 1.4 && Math.abs(rel) < 6) { if (7 > pen) { pen = 7; by = 'side'; } }
      }
      this.occl = pen; this.occlBy = by;
      return pen;
    }

    /* ---------- SRS 3, 4, 12.1, 17.4: conditions that stop accurate decisions ---------- */
    faults() {
      const S = this.sim, env = S.env, C = L.CFG, f = [];
      if (env.laneW < C.laneWMin) f.push({ req: '3.1', text: 'Road too narrow (' + env.laneW.toFixed(1) + ' m lane)' });
      if (env.laneW > C.laneWMax) f.push({ req: '3.1', text: 'Road too wide (' + env.laneW.toFixed(1) + ' m lane)' });
      const m = {
        faded: ['3.3', 'Lane markings faded'],
        obscured: ['3.2', 'Lane markings obscured'],
        complex: ['3.4', 'More lane boundaries than expected (' + this.nb + '). Markings overly complicated'],
        none: ['3.5', 'No lane markings detected']
      }[env.marks];
      if (m) f.push({ req: m[0], text: m[1] });
      if (env.weather === 'snow' && env.intensity >= 0.6 && env.marks !== 'none') f.push({ req: '3.2', text: 'Lane markings covered by snow' });
      if (env.camFail) f.push({ req: '4', text: 'Camera sensing failure' });
      if (env.vseFail) f.push({ req: '4', text: 'Vehicle state sensors lost' });
      if (env.mismatch) f.push({ req: '17.4', text: 'Camera lane position disagrees with vehicle state by ' + this.disagree.toFixed(1) + ' m' });
      if (this.qFault && !env.camFail) f.push({ req: '12.1', text: 'Image quality ' + Math.floor(this.q) + ' is below the minimum of ' + C.qMin });
      return f;
    }

    tagFaults(f) {
      const S = this.sim;
      f.forEach(x => {
        S.hit(x.req);
        if (x.req === '4' || x.req === '12.1' || x.req === '17.4') S.hit('4');
        if (x.req === '12.1') S.hit('12');
      });
    }

    toFault(f) {
      const S = this.sim, txt = f.map(x => x.text).join('; ');
      this.reasons = f.map(x => x.text);
      this.setMode('FAULT'); this.wasActive = false;
      S.notify('LMS disabled: ' + txt, 'bad');
      S.ev('ALERT', 'LMS disabled. Visual and audio alert sent: ' + txt);
      S.beep('fault'); this.tagFaults(f);
    }

    setMode(m) { this.mode = m; this.sim.hit('13.2'); }

    /* ---------- SRS 13: driver enable / disable ---------- */
    pressEnable() {
      const S = this.sim, C = L.CFG, m = this.mode;
      if (m === 'ACTIVE' || m === 'SUSPENDED' || m === 'OVERRIDE') {
        this.setMode('OFF'); this.wasActive = false; this.zero();
        S.notify('LMS turned off', 'warn');
        S.ev('STATE', 'Driver turned LMS off. Visual alert shown');
        S.beep('off'); S.hit('5'); S.hit('13');
        return false;
      }
      const msgs = [];
      const spd = S.ego.speed;
      if (!(spd > C.vMin && spd < C.vMax)) { msgs.push('Speed ' + Math.round(spd) + ' mph. LMS needs more than ' + C.vMin + ' and less than ' + C.vMax + ' mph.'); S.hit('2.1'); S.hit('2'); }
      const f = this.faults();
      if (f.length) { msgs.push(...f.map(x => x.text)); S.hit('4.3'); this.tagFaults(f); }
      if (msgs.length) {
        S.notify('Cannot enable LMS. ' + msgs.join(' | '), 'bad');
        S.ev('ALERT', 'Activation refused: ' + msgs.join(' | '));
        return false;
      }
      this.reasons = []; this.zero(); this.limitT = 0;
      this.homeLane = S.laneOf(S.ego.d);
      this.setMode('ACTIVE');
      S.beep('chime'); S.notify('LMS enabled', 'ok');
      S.ev('STATE', 'LMS enabled by driver in lane ' + (this.homeLane + 1) + '. Audio chime played');
      S.hit('1'); S.hit('13'); S.hit('13.1');
      return true;
    }

    zero() { this.kCmd = 0; this.fbDeg = 0; this.ldw = false; this.lks = false; this.out = false; this.sub = 'idle'; this.limited = false; }

    boundaryOnSide(side) {
      const b = this.sim.boundaryTypes(this.homeLane == null ? this.sim.laneOf(this.sim.ego.d) : this.homeLane);
      return side < 0 ? b.left : b.right;
    }

    /* ---------- LDWS (SRS 14) ---------- */
    onDepart() {
      const S = this.sim;
      if (S.env.ldwFail) { S.ev('INFO', 'Car left the lane. No warning because LDWS is faulted'); return; }
      this.ldw = true; this.ldwStart = S.t; this.xDone = false; this.lastWarn = S.t;
      const side = this.outSide < 0 ? 'left' : 'right';
      S.beep('warn');
      S.ev('ALERT', 'Lane departure to the ' + side + ' (' + this.boundaryOnSide(this.outSide) + ' boundary). Dashboard notice, beep, seat and wheel vibration');
      S.hit('14.1');
      this.infr.push(S.t); this.infr = this.infr.filter(x => S.t - x < 90);
      if (this.infr.length >= 3 && S.t - this.lastFatigue > 45) {
        this.lastFatigue = S.t; this.fatigue++;
        S.notify('Repeated lane departures. Are you distracted or tired? Consider taking a break.', 'warn', 9);
        S.ev('ALERT', 'Repeated infractions: distracted or tired driving warning');
        S.hit('14.4');
      }
    }

    onReturn() {
      if (this.ldw) { this.ldw = false; this.sim.ev('STATE', 'Back in lane. Departure warning cleared'); this.sim.hit('14.3'); }
    }

    /* ---------- SRS 17.5: validate steering commands before sending ---------- */
    validate(k) {
      const S = this.sim;
      if (!isFinite(k) || Math.abs(k) > L.CFG.kAbsMax) {
        this.rejected++;
        S.ev('SEC', 'Steering command ' + (k * L.CFG.degPerK).toFixed(0) + ' deg rejected: outside the valid range of ' + (L.CFG.kAbsMax * L.CFG.degPerK).toFixed(0) + ' deg. Message logged');
        S.notify('Invalid steering command blocked', 'info', 4);
        S.hit('17.5'); S.hit('17.6');
        return false;
      }
      this.validated++;
      return true;
    }

    // SRS 8 and 10: the driver's steering wins. LMS pauses and comes back a set time after the driver lets go.
    toOverride(torque, why) {
      const S = this.sim;
      this.overrideLane = this.homeLane == null ? S.laneOf(S.ego.d) : this.homeLane;
      this.setMode('OVERRIDE'); this.zero(); this.wasActive = false; this.resumeT = 0;
      S.notify('Driver override. LMS resumes ' + L.CFG.resumeDelay.toFixed(1) + ' s after you stop steering.', 'warn');
      S.ev('STATE', why + ' ' + torque.toFixed(1) + ' Nm. LMS deactivated, driver has control. LMS resumes ' + L.CFG.resumeDelay.toFixed(1) + ' s after the steering is released');
      S.hit('8'); S.hit('10');
      if (S.driver.attention === 'distracted') { S.driver.attention = 'attentive'; S.emit('driver'); }
    }

    // reactivate in whichever lane the car is in; if it is off center or straddling a line, LKS steers it in
    resumeAfterOverride() {
      const S = this.sim, C = L.CFG, eg = S.ego;
      const lane = S.laneOf(eg.d), y = eg.d - S.laneCenter(lane), same = lane === this.overrideLane;
      this.homeLane = lane; this.setMode('ACTIVE'); this.limitT = 0; this.resumeT = 0;
      this.out = Math.abs(y) > this.laneLim();   // already across the line: no new departure warning
      const off = Math.abs(y) > 0.5;
      if (off) { this.lks = true; this.lksEdge = false; this.lastCmdLog = -99; }
      S.beep('chime');
      S.notify('LMS resumed ' + (same ? 'in your lane' : 'in lane ' + (lane + 1)) + (off ? '. Steering back to the center.' : ''), 'ok');
      S.ev('STATE', 'No hard steering for ' + C.resumeDelay.toFixed(1) + ' s. LMS reactivated automatically in ' + (same ? 'its own lane ' : 'lane ') + (lane + 1) +
        (off ? ', ' + Math.round(Math.abs(y) * 100) + ' cm off center. LKS steering the car to the lane center' : ''));
      S.hit('10.1');
    }

    takeover() {
      const S = this.sim;
      this.setMode('TAKEOVER'); this.wasActive = false; this.zero(); this.limitT = 0;
      S.notify('Steering limit reached. Take control of the vehicle.', 'bad', 7);
      S.ev('ALERT', 'LCS reached its steering limit while outside the lane center. Driver told to take control, LMS deactivated');
      S.beep('fault'); S.hit('F4');
    }

    /* ---------- LKS and LCS steering (SRS 15, 16) ---------- */
    control(v, dtc) {
      const S = this.sim, C = L.CFG, t = S.t, ym = this.ym, psim = this.psim, lim = this.laneLim();
      S.hit('6'); S.hit('16.1'); S.hit('12');
      if (!this.out && Math.abs(ym) > lim) { this.out = true; this.outSide = Math.sign(ym) || 1; this.onDepart(); }
      else if (this.out && Math.abs(ym) < lim * 0.8) { this.out = false; this.onReturn(); }

      if (S.env.ldwFail) {
        if (!this.ldwNoted) {
          this.ldwNoted = true; this.ldw = false; this.lks = false;
          S.notify('LDWS fault. Lane keeping is unavailable too.', 'warn');
          S.ev('ALERT', 'LDWS inoperable, so LKS is inoperable. LCS continues');
          S.hit('15.3');
        }
      } else this.ldwNoted = false;

      if (this.ldw) {
        if (t - this.lastWarn >= 1.2) { this.lastWarn = t; S.beep('warn'); }
        if (!this.xDone && t - this.ldwStart >= C.ldwX) { this.xDone = true; S.ev('ALERT', 'Driver told the car has been out of the lane for ' + C.ldwX.toFixed(1) + ' s'); S.hit('14.2'); }
      }

      const act = this.ldw && S.driver.steer * this.outSide <= -0.15;   // driver is correcting
      const edge = this.boundaryOnSide(this.outSide) === 'road edge';
      if (!S.env.ldwFail && this.ldw && !this.lks && !act && (edge || t - this.ldwStart >= C.lksDelay)) {
        this.lks = true; this.lksEdge = edge; this.lastCmdLog = -99;
        S.ev('STATE', edge ? 'Road edge ahead. LKS engaged at once to prevent leaving the road' : 'No driver action. LKS engaged, steering back to the lane center. LCS suspended');
        S.hit('15.1'); if (edge) S.hit('15.2');
      }
      if (this.lks && (act || Math.abs(ym) < 0.4)) {
        this.lks = false;
        S.ev('STATE', act ? 'LKS released. Driver is correcting' : 'LKS finished. Car is back near the lane center, LCS resumes');
        if (!act && this.lksEdge) S.hit('15.2');
      }

      // the camera now sees the car in a different lane
      if (!this.lks && Math.abs(this.yTrue) > S.env.laneW * 0.75) {
        this.homeLane = S.laneOf(S.ego.d); this.out = false; this.ldw = false;
        S.ev('INFO', 'Car is now inside lane ' + (this.homeLane + 1) + '. LMS follows the new lane');
        return;
      }

      let w = C.wLcs, clip = C.lcsFbClip;
      if (this.lks) { w = C.wLks; clip = this.lksEdge ? C.edgeFbClip : C.lksFbClip; }
      const fb = clamp(-((w * w) / (v * v)) * ym - (2 * 0.9 * w / v) * psim, -clip, clip);
      const kMax = (C.latAccMax / (v * v)) * (this.lks ? 1.3 : 1);
      let kReq = this.km + fb;
      this.limited = false;
      if (Math.abs(kReq) > kMax) { kReq = Math.sign(kReq) * kMax; this.limited = true; }
      // SRS Fig 4: at the steering limit and still outside the lane center
      if (this.limited && Math.abs(ym) > 0.3) this.limitT += dtc; else this.limitT = Math.max(0, this.limitT - dtc);
      if (this.limitT >= C.limitHold) { this.takeover(); return; }

      let send = kReq;
      if (this.corruptNext) { this.corruptNext = false; send = 0.05 * (Math.sign(kReq) || 1); }
      if (!this.validate(send)) send = this.kCmd;   // hold the last valid command
      this.kCmd = send;
      this.fbDeg = fb * C.degPerK;
      this.sub = this.lks ? 'keeping' : (this.ldw ? 'warning' : 'centering');
      S.hit('16.2');
      const deg = send * C.degPerK, gap = this.lks ? 0.5 : 2;
      if (Math.abs(deg) >= 0.2 && t - this.lastCmdLog >= gap) {
        this.lastCmdLog = t;
        S.ev('STEER', 'Steering command ' + (deg > 0 ? '+' : '') + deg.toFixed(1) + ' deg sent by ' + (this.lks ? 'LKS' : 'LCS') + (this.limited ? ' (at limit)' : ''));
      }
    }

    /* ---------- one image capture cycle ---------- */
    capture(dtc) {
      const S = this.sim, C = L.CFG, env = S.env, eg = S.ego, t = S.t;
      const v = Math.max(eg.v, 1);
      const qRaw = this.gradeQuality();
      this.q += (qRaw - this.q) * 0.45;
      if (!this.qFault && this.q < C.qMin) this.qFault = true;
      else if (this.qFault && this.q > C.qMin + 5) this.qFault = false;
      if (this.occl > 8 && t - this.lastOcclLog > 20 && this.mode === 'ACTIVE') {
        this.lastOcclLog = t;
        S.ev('INFO', (this.occlBy === 'lead' ? 'Vehicle ahead' : 'Vehicle alongside') + ' is blocking part of the marking view. Image quality ' + Math.round(this.q));
      }

      // SRS 6: lane markings, curvature, future position and current position
      const lane = this.homeLane == null ? S.laneOf(eg.d) : this.homeLane;
      const yTrue = eg.d - S.laneCenter(lane);
      this.yTrue = yTrue;
      this.ym = yTrue + gauss() * ((100 - this.q) / 100 * 0.25);
      this.psim = eg.psi + gauss() * 0.0005;
      const kRoad = S.road.kAt(eg.s + v * C.captureMs / 2000);
      this.km = kRoad + gauss() * 0.00004 * (1 + (100 - this.q) / 30);
      this.nb = env.marks === 'complex' ? 5 : env.marks === 'none' ? 0 : 2;
      const T = C.predT;
      this.predY = yTrue + v * T * Math.sin(eg.psi) + 0.5 * v * v * T * T * (eg.kTotal - kRoad);
      this.predOut = Math.abs(this.predY) > this.laneLim();
      this.disagree = env.mismatch ? 0.9 : Math.abs(gauss() * 0.03);

      const f = this.faults();
      const spdOK = eg.speed > C.vMin && eg.speed < C.vMax;
      this.speedAcc += dtc * 1000;
      const speedDue = this.speedAcc >= C.speedCheckMs;
      if (speedDue) this.speedAcc = 0;
      const engaged = this.mode === 'ACTIVE' || this.mode === 'SUSPENDED' || this.mode === 'OVERRIDE';
      const torque = Math.abs(S.driver.steer) * C.torqueNm;

      if (engaged && f.length) this.toFault(f);
      else if (engaged && speedDue && !spdOK) {
        this.setMode('OFF'); this.wasActive = false; S.hit('2');
        S.notify('LMS off. Speed must stay between ' + C.vMin + ' and ' + C.vMax + ' mph.', 'warn');
        S.ev('STATE', 'Speed check: ' + Math.round(eg.speed) + ' mph is outside the threshold. LMS deactivated');
      }
      else if (this.mode === 'ACTIVE') {
        if (S.signal !== 0) {
          this.wasActive = true; this.setMode('SUSPENDED'); this.zero();
          S.notify('LMS paused: ' + (S.signal < 0 ? 'left' : 'right') + ' turn signal on', 'info');
          S.ev('STATE', 'Turn signal on. LDWS, LKS and LCS deactivated');
          S.hit('9');
        } else if (torque >= C.torqueSig) this.toOverride(torque, 'Driver steering torque');
        else this.control(v, dtc);
      }
      else if (this.mode === 'SUSPENDED') {
        if (S.signal === 0 && this.wasActive) {
          if (torque >= C.torqueSig) this.toOverride(torque, 'Turn signal off but driver is still steering with');
          else {
            this.homeLane = S.laneOf(eg.d);
            this.setMode('ACTIVE'); this.wasActive = false; this.out = false; this.limitT = 0;
            S.beep('chime'); S.notify('LMS resumed after turn signal', 'ok');
            S.ev('STATE', 'Turn signal off. LMS reactivated in lane ' + (this.homeLane + 1));
            S.hit('11');
          }
        }
      }
      else if (this.mode === 'OVERRIDE') {
        // automatic re-enable: a countdown starts when the driver stops steering hard
        if (S.signal !== 0) {
          this.wasActive = true; this.setMode('SUSPENDED'); this.resumeT = 0;
          S.ev('STATE', 'Turn signal on during override. LMS stays paused until the signal is off');
        } else {
          if (torque >= C.torqueSig) this.resumeT = 0;
          else this.resumeT += dtc;
          if (this.resumeT >= C.resumeDelay) this.resumeAfterOverride();
        }
      }
      else if (this.mode === 'FAULT' && f.length === 0) {
        this.setMode('OFF');
        S.notify('Conditions are normal again. Press LMS to enable.', 'ok');
        S.ev('INFO', 'Fault conditions cleared. LMS stays off until the driver enables it');
      }
      if (this.mode !== 'ACTIVE') this.zero();
    }
  }

  L.Controller = Controller;
})();
