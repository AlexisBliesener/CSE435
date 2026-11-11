/* Simulation core: environment, vehicle dynamics, simulated driver, events and log.
   No DOM access. The 3D view and the dashboard read from this object. */
(function () {
  'use strict';
  const L = window.LMS, C = L.CFG, clamp = L.clamp;

  const DEFAULT_ENV = () => ({
    road: 'hwy2', traffic: 'none', weather: 'clear', intensity: 0.6, night: false, wind: false,
    marks: 'clear', laneW: 3.7, curv: 0,
    dirt: 0, camFail: false, vseFail: false, ldwFail: false, mismatch: false
  });

  class Sim {
    constructor() {
      this.handlers = {};
      this.hits = new Set();
      this.road = new L.Road();
      this.traffic = new L.Traffic(this);
      this.ctrl = new L.Controller(this);
      this.runner = null;
      this.reset({});
    }

    on(n, f) { (this.handlers[n] = this.handlers[n] || []).push(f); }
    emit(n, a, b) { (this.handlers[n] || []).forEach(f => f(a, b)); }

    /* ---------- lane geometry ---------- */
    road_() { return L.ROADS[this.env.road]; }
    lanes() { return this.road_().lanes; }
    laneCenter(i) { const N = this.lanes(); return (i - (N - 1) / 2) * this.env.laneW; }
    laneOf(d) { const N = this.lanes(); return clamp(Math.round(d / this.env.laneW + (N - 1) / 2), 0, N - 1); }
    boundaryTypes(i) {
      const N = this.lanes();
      return { left: i === 0 ? this.road_().leftType : 'dashed', right: i === N - 1 ? 'road edge' : 'dashed' };
    }
    edges() {
      const R = this.road_(), N = R.lanes, W = this.env.laneW;
      const left = R.oncoming ? this.laneCenter(-R.oncoming) - W / 2 : this.laneCenter(0) - W / 2 - R.shoulderL;
      return { left, right: this.laneCenter(N - 1) + W / 2 + R.shoulderR };
    }
    envSummary() {
      const e = this.env;
      return this.road_().short + ', ' + L.TRAFFIC[e.traffic].name.toLowerCase() + ', ' +
        (e.weather === 'clear' ? 'clear' : L.WEATHER[e.weather].name.toLowerCase() + ' ' + Math.round(e.intensity * 100) + '%') +
        (e.night ? ', night' : ', day') + (e.wind ? ', gusty wind' : '');
    }

    reset(o) {
      o = o || {};
      this.t = 0;
      this.env = Object.assign(DEFAULT_ENV(), o.env || {});
      this.road.reset(this.env.curv);
      this.road.ensure(460);
      const N = this.lanes();
      const lane = clamp(o.lane == null ? (N > 1 ? N - 1 : 0) : o.lane, 0, N - 1);
      const sp = o.speed || 0;
      this.ego = { s: 0, d: this.laneCenter(lane) + (o.y || 0), psi: 0, speed: sp, target: o.target == null ? sp : o.target, v: sp * L.MPH, kTotal: 0, steerK: 0 };
      this.driver = { steer: 0, attention: o.attention || 'attentive', driftDir: o.driftDir || -1, maneuver: null, dmFb: 0, handsOn: true };
      this.signal = 0;
      this.driverMode = 'auto';   // 'auto' = automatic driver follows the script, 'self' = the user drives
      this.notices = []; this.logRows = []; this.tele = []; this.tweens = [];
      this.capAcc = 0; this.offroad = false; this.collisions = 0; this.flash = 0;
      this.gustPhase = Math.random() * 100;
      this.ctrl.reset();
      this.traffic.reset();
      this.logDirty = true;
      this.ev('INFO', 'Simulation started: ' + this.envSummary());
      if (o.active) { this.ctrl.homeLane = lane; this.ctrl.setMode('ACTIVE'); this.ev('STATE', 'LMS active at scenario start in lane ' + (lane + 1)); }
      this.emit('reset');
    }

    /* ---------- environment changes ---------- */
    setEnv(patch, quiet) {
      const e = this.env, before = Object.assign({}, e);
      const laneIdx = this.laneOf(this.ego.d), yRel = this.ego.d - this.laneCenter(laneIdx);
      Object.assign(e, patch);
      if (patch.road !== undefined && patch.road !== before.road || patch.laneW !== undefined && patch.laneW !== before.laneW) {
        const N = this.lanes(), li = Math.min(laneIdx, N - 1);
        this.ego.d = this.laneCenter(li) + clamp(yRel, -e.laneW / 2, e.laneW / 2);
        if (this.ctrl.homeLane != null) this.ctrl.homeLane = Math.min(this.ctrl.homeLane, N - 1);
        this.driver.maneuver = null;
      }
      if (patch.road !== undefined && patch.road !== before.road || patch.traffic !== undefined && patch.traffic !== before.traffic) this.traffic.reset();
      if (patch.laneW !== undefined && patch.laneW !== before.laneW) this.traffic.cars.forEach(c => { c.d = c.dTarget = this.laneCenter(c.lane); });
      if (patch.curv !== undefined && patch.curv !== before.curv) this.road.setCurvature(patch.curv, this.ego.s);
      const changed = Object.keys(patch).filter(k => patch[k] !== before[k]);
      if (changed.length && !quiet) {
        const labels = changed.map(k => {
          const v = e[k];
          switch (k) {
            case 'road': return 'road ' + L.ROADS[v].name.toLowerCase();
            case 'traffic': return L.TRAFFIC[v].name.toLowerCase();
            case 'weather': return 'weather ' + L.WEATHER[v].name.toLowerCase();
            case 'intensity': return 'intensity ' + Math.round(v * 100) + '%';
            case 'night': return v ? 'night' : 'day';
            case 'wind': return v ? 'gusty wind' : 'calm';
            case 'marks': return 'markings ' + L.MARKS[v].toLowerCase();
            case 'laneW': return 'lane width ' + v.toFixed(1) + ' m';
            case 'curv': return Math.abs(v) < 1e-5 ? 'straight road ahead' : (v > 0 ? 'right' : 'left') + ' curve ' + Math.round(1 / Math.abs(v)) + ' m radius ahead';
            case 'dirt': return 'camera contamination ' + Math.round(v) + '%';
            case 'camFail': return v ? 'camera failed' : 'camera restored';
            case 'vseFail': return v ? 'vehicle state sensors lost' : 'vehicle state sensors restored';
            case 'ldwFail': return v ? 'LDWS module fault' : 'LDWS restored';
            case 'mismatch': return v ? 'camera and vehicle state disagree' : 'camera and vehicle state agree';
            default: return k;
          }
        });
        this.ev('INFO', 'Environment: ' + labels.join(', '));
      }
      this.emit('env');
    }

    tween(key, to, dur) {
      this.tweens = this.tweens.filter(tw => tw.key !== key);
      this.tweens.push({ key, from: this.env[key], to, t0: this.t, dur: Math.max(dur, 0.01) });
    }

    /* ---------- driver actions ---------- */
    changeLane(dir) {
      const N = this.lanes(), cur = this.laneOf(this.ego.d), tgt = cur + dir;
      if (tgt < 0 || tgt > N - 1) { this.notify('No lane to the ' + (dir < 0 ? 'left' : 'right'), 'info', 3); return false; }
      if (this.driver.maneuver) return false;
      this.signal = dir;
      this.driver.maneuver = { dir, target: tgt, t0: this.t, phase: 'signal' };
      this.ev('INFO', 'Driver signals ' + (dir < 0 ? 'left' : 'right') + ' to move to lane ' + (tgt + 1));
      return true;
    }

    // the driver checks the mirror before moving over
    gapClear(lane) {
      const eg = this.ego;
      return !this.traffic.cars.some(c => !c.onc && Math.abs(c.d - this.laneCenter(lane)) < this.env.laneW * 0.6 && c.s - eg.s > -16 && c.s - eg.s < 18);
    }

    // lanes the driver occupies or is moving into, so traffic can make room
    egoLanes() {
      const a = [this.laneOf(this.ego.d)];
      if (this.driver.maneuver) a.push(this.driver.maneuver.target);
      return a;
    }

    setSignal(dir) {
      if (this.driver.maneuver && dir === 0) this.driver.maneuver = null;
      this.signal = dir;
    }

    setAttention(a) {
      if (this.driver.attention === a) return;
      this.driver.attention = a;
      this.ev('INFO', a === 'distracted' ? 'Driver is distracted. Hands resting, car drifts ' + (this.driver.driftDir < 0 ? 'left' : 'right') : 'Driver is paying attention');
      this.emit('driver');
    }

    setDriverMode(m) {
      if (m === this.driverMode) return;
      this.driverMode = m;
      const dr = this.driver;
      dr.steer = 0; dr.maneuver = null; this.signal = 0;
      if (dr.attention !== 'attentive') dr.attention = 'attentive';
      if (m === 'self') {
        this.ev('INFO', 'You took control of the car (self drive). Scripted driver actions become prompts; road, weather and fault events still happen');
        this.notify('Self drive: you are driving', 'info', 4);
      } else {
        this.ev('INFO', 'Automatic driver took control and follows the scenario');
        this.notify('Automatic driver is driving', 'info', 4);
      }
      this.emit('driver');
    }

    inject(kind) {
      if (kind === 'forged') {
        this.ev('SEC', 'Rejected message claiming to be from the steering system: authentication tag did not match. Message logged');
        this.notify('Security: rejected an unauthenticated message', 'info', 4);
        this.hit('17.3'); this.hit('17.6');
      } else if (kind === 'stale') {
        this.ev('SEC', 'Rejected camera frame stamped 850 ms ago, outside the 200 ms recency window. Message logged');
        this.notify('Security: rejected a stale camera frame', 'info', 4);
        this.hit('17.3'); this.hit('17.6');
      } else if (kind === 'corrupt') {
        if (this.ctrl.mode === 'ACTIVE') this.ctrl.corruptNext = true;
        else this.ctrl.validate(0.05);
      }
    }

    /* ---------- outputs ---------- */
    notify(text, sev, ttl) {
      ttl = ttl || C.noticeS;
      const ex = this.notices.find(n => n.text === text);
      if (ex) { ex.until = this.t + ttl; return; }
      this.notices.push({ text, sev, until: this.t + ttl, t0: this.t });
      if (this.notices.length > 4) this.notices.shift();
    }

    ev(kind, text) {
      const lane = this.ctrl.homeLane == null ? this.laneOf(this.ego.d) : this.ctrl.homeLane;
      this.logRows.push({ t: this.t, lane: lane + 1, y: this.ego.d - this.laneCenter(lane), v: this.ego.speed, mode: this.ctrl.mode, kind, text });
      if (this.logRows.length > 600) this.logRows.shift();
      this.logDirty = true;
      if (kind !== 'INFO') this.hit('7');
    }

    beep(kind) { this.emit('beep', kind); }

    hit(id) { if (!this.hits.has(id)) { this.hits.add(id); this.emit('hit', id); } }

    /* ---------- one physics step ---------- */
    step(dt) {
      const e = this.env, eg = this.ego, dr = this.driver, ctrl = this.ctrl;
      this.t += dt;
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tw = this.tweens[i], u = clamp((this.t - tw.t0) / tw.dur, 0, 1);
        e[tw.key] = tw.from + (tw.to - tw.from) * u;
        if (u >= 1) this.tweens.splice(i, 1);
      }

      eg.speed += clamp(eg.target - eg.speed, -6 * dt, 4 * dt);
      eg.v = eg.speed * L.MPH;
      const v = eg.v, vv = Math.max(v, 1);
      this.road.ensure(eg.s + 430);
      this.road.trim(eg.s - 160);
      const kRoad = this.road.kAt(eg.s);

      // lane change maneuver
      const man = dr.maneuver;
      if (man) {
        if (man.phase === 'signal' && this.t - man.t0 > 1.0 && this.gapClear(man.target)) man.phase = 'move';
        if (man.phase === 'signal' && this.t - man.t0 > 12) { dr.maneuver = null; this.signal = 0; this.ev('INFO', 'No gap in lane ' + (man.target + 1) + '. Driver cancels the lane change'); }
        if (man.phase === 'move' && Math.abs(eg.d - this.laneCenter(man.target)) < 0.25 && Math.abs(eg.psi) < 0.008) {
          dr.maneuver = null; this.signal = 0;
          this.ev('INFO', 'Lane change complete. Driver turns the signal off');
        }
      }

      // who steers: the automatic driver keeps the lane when LMS is not steering (unless distracted);
      // in self drive the user steers and the car only straightens out when the wheel is released
      const active = ctrl.mode === 'ACTIVE', self = this.driverMode === 'self';
      const kUser = dr.steer * C.kd;
      let kDM = 0;
      dr.handsOn = self ? dr.attention === 'attentive' : !active && (dr.attention === 'attentive' || !!dr.maneuver || this.offroad);
      dr.dmFb = 0;
      if (!active) {
        kDM = kRoad; // the car follows the curve of the road
        const laneKeeping = self ? !!dr.maneuver : dr.handsOn;
        if (self && !dr.maneuver && Math.abs(dr.steer) < 0.05 && dr.attention === 'attentive') {
          dr.dmFb = clamp(-eg.psi / (vv * 1.2), -0.0035, 0.0035);
          kDM += dr.dmFb;
        }
        if (laneKeeping && Math.abs(dr.steer) < 0.05) {
          const tl = dr.maneuver && dr.maneuver.phase === 'move' ? dr.maneuver.target : this.laneOf(eg.d);
          const w = dr.maneuver ? 0.75 : 0.55, err = eg.d - this.laneCenter(tl);
          dr.dmFb = clamp(-((w * w) / (vv * vv)) * err - (2 * 0.9 * w / vv) * eg.psi, -0.0035, 0.0035);
          kDM += dr.dmFb;
        }
      }
      const kDrift = dr.attention === 'distracted' && !dr.maneuver && !this.offroad ? dr.driftDir * C.driftK : 0;
      const g = this.t + this.gustPhase;
      const kWind = e.wind ? (Math.sin(g * 0.71) * 0.6 + Math.sin(g * 1.93 + 1.3) * 0.4) * 0.00011 : 0;
      eg.steerK = kUser + kDM + (active ? ctrl.kCmd : 0);
      eg.kTotal = eg.steerK + kDrift + kWind;

      eg.psi += v * (eg.kTotal - kRoad) * dt;
      eg.d += v * Math.sin(eg.psi) * dt;
      eg.s += v * Math.cos(eg.psi) * dt;

      // leaving the road
      const ed = this.edges(), hw = C.carW / 2;
      if (!this.offroad && (eg.d + hw > ed.right + 0.3 || eg.d - hw < ed.left - 0.3)) {
        this.offroad = true;
        this.ev('ALERT', 'Vehicle left the road. Driver takes over');
        this.notify('Vehicle left the road', 'bad');
        if (dr.attention === 'distracted' && !self) { dr.attention = 'attentive'; this.emit('driver'); }
      } else if (this.offroad && eg.d + hw < ed.right && eg.d - hw > ed.left) this.offroad = false;
      if (eg.d > ed.right + 3) { eg.d = ed.right + 3; eg.psi = Math.min(eg.psi, 0); }
      if (eg.d < ed.left - 3) { eg.d = ed.left - 3; eg.psi = Math.max(eg.psi, 0); }

      // traffic and contact
      this.traffic.step(dt);
      for (const c of this.traffic.cars) {
        if (Math.abs(c.s - eg.s) < (C.carL + c.len) / 2 * 0.95 && Math.abs(c.d - eg.d) < (C.carW + c.wid) / 2 * 0.9) {
          this.collisions++; this.flash = this.t;
          this.ev('ALERT', 'Contact with another vehicle. LMS does not detect vehicles (SRS 1.2)');
          this.notify('Contact with another vehicle', 'bad', 4);
          this.traffic.respawn(c, eg.s + 300);
        }
      }

      // image capture cycles (SRS 6)
      this.capAcc += dt * 1000;
      while (this.capAcc >= C.captureMs) {
        this.capAcc -= C.captureMs;
        ctrl.capture(C.captureMs / 1000);
        this.tele.push([this.t, ctrl.homeLane == null ? this.laneOf(eg.d) + 1 : ctrl.homeLane + 1, ctrl.yTrue, eg.speed, ctrl.mode, ctrl.kCmd * C.degPerK, ctrl.out ? 1 : 0, ctrl.q, kRoad, e.weather + (e.night ? '-night' : ''), e.traffic]);
        if (this.tele.length > 6000) this.tele.shift();
      }
      this.notices = this.notices.filter(n => n.until > this.t);
      if (this.runner) this.runner.tick();
    }
  }

  L.Sim = Sim;
})();
