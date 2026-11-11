/* Other vehicles on the road. The LMS does not detect vehicles (SRS 1.2);
   they are part of the environment and can block the camera's view of markings. */
(function () {
  'use strict';
  const L = window.LMS;
  const COLORS = [0xB8BEC4, 0x2B3A55, 0x8C1C24, 0xE9ECEE, 0x1E1F22, 0x4F6B5A, 0x6E7780, 0xC9A23A, 0x2F5F8F, 0x7A4B2E];

  class Traffic {
    constructor(sim) { this.sim = sim; this.cars = []; this.nextId = 1; }

    reset() {
      this.cars = [];
      const sim = this.sim, spec = L.TRAFFIC[sim.env.traffic];
      if (!spec || !spec.spacing) return;
      const N = sim.lanes(), eg = sim.ego;
      const egoLane = sim.laneOf(eg.d);
      const lanes = [];
      for (let i = 0; i < N; i++) lanes.push({ i, onc: false });
      for (let j = 0; j < sim.road_().oncoming; j++) lanes.push({ i: -1 - j, onc: true });
      for (const ln of lanes) {
        let s = eg.s - 110 + Math.random() * spec.spacing * 0.6;
        while (s < eg.s + 330) {
          const near = Math.abs(s - eg.s);
          const blocked = (!ln.onc && ln.i === egoLane && near < 40) || (!ln.onc && Math.abs(ln.i - egoLane) === 1 && near < 12);
          if (!blocked) this.cars.push(this.make(ln.i, s, ln.onc));
          s += spec.spacing * (0.6 + Math.random() * 0.9);
        }
      }
    }

    make(lane, s, onc) {
      const r = Math.random();
      const kind = r < 0.14 ? 'truck' : r < 0.42 ? 'suv' : 'car';
      const dims = { car: [4.5, 1.8], suv: [4.9, 1.95], truck: [12.5, 2.5] }[kind];
      const egoMph = this.sim.ego.speed;
      const base = kind === 'truck' ? 58 : 64;
      const vDes = (onc ? -1 : 1) * Math.max(30, base + (Math.random() - 0.5) * 16 + (lane === 0 && !onc ? 4 : 0)) * L.MPH;
      const c = this.sim.laneCenter(lane);
      return { id: this.nextId++, lane, s, d: c, dTarget: c, v: vDes, vDes, kind, len: dims[0], wid: dims[1], color: COLORS[Math.floor(Math.random() * COLORS.length)], sig: 0, onc, egoMph };
    }

    // a car in the next lane merges in front of the driver
    cutIn() {
      const sim = this.sim, eg = sim.ego, N = sim.lanes();
      const egoLane = sim.laneOf(eg.d);
      const side = egoLane < N - 1 ? 1 : (egoLane > 0 ? -1 : 0);
      if (!side) return null;
      const lane = egoLane + side;
      let car = this.cars.find(c => !c.onc && c.lane === lane && c.s - eg.s > 8 && c.s - eg.s < 50);
      if (!car) {
        this.cars = this.cars.filter(c => !(c.lane === lane && Math.abs(c.s - eg.s - 22) < 20));
        car = this.make(lane, eg.s + 18, false);
        car.kind = 'car'; car.len = 4.5; car.wid = 1.8;
        this.cars.push(car);
      }
      car.v = car.vDes = eg.v + 1.5;
      car.lane = egoLane; car.dTarget = sim.laneCenter(egoLane); car.sig = -side; car.sigUntil = sim.t + 4;
      return car;
    }

    step(dt) {
      const sim = this.sim, eg = sim.ego, egoLanes = sim.egoLanes();
      const cars = this.cars;
      for (const c of cars) {
        let vT = c.vDes;
        if (!c.onc) {
          // follow the vehicle ahead in the same lane
          let lead = null, gapMin = 1e9;
          for (const o of cars) {
            if (o === c || o.onc || o.lane !== c.lane) continue;
            const g = o.s - c.s - (o.len + c.len) / 2;
            if (g > 0 && g < gapMin) { gapMin = g; lead = o; }
          }
          if (lead && gapMin < 35) vT = Math.min(vT, lead.v + (gapMin - 18) * 0.25);
          // keep clear of the driver, since the driver controls speed and LMS does not brake
          if (egoLanes.indexOf(c.lane) >= 0) {
            const g = c.s - eg.s;
            if (g > 0 && g < 55) vT = Math.max(vT, eg.v + 1.5);
            if (g < 0 && g > -35) vT = Math.min(vT, eg.v - 1.5);
          }
          vT = Math.max(vT, 8);
        }
        c.v += L.clamp(vT - c.v, -4 * dt, 2.5 * dt);
        c.s += c.v * dt;
        if (Math.abs(c.dTarget - c.d) > 0.01) c.d += L.clamp(c.dTarget - c.d, -0.9 * dt, 0.9 * dt);
        if (c.sig && sim.t > (c.sigUntil || 0)) c.sig = 0;
      }
      // recycle vehicles that leave the window around the driver
      const spec = L.TRAFFIC[sim.env.traffic];
      for (const c of cars) {
        const rel = c.s - eg.s;
        if (rel < -130 || rel > 345) {
          if (c.onc) { this.respawn(c, eg.s + 320 + Math.random() * 20); continue; }
          if (rel < -130) this.respawn(c, eg.s + 300 + Math.random() * 40);
          else this.respawn(c, eg.s - 115 - Math.random() * 10);
        }
      }
      if (!spec || !spec.spacing) this.cars = [];
    }

    respawn(c, s) {
      const sim = this.sim, N = sim.lanes();
      const lane = c.onc ? c.lane : Math.floor(Math.random() * N);
      const clear = !this.cars.some(o => o !== c && o.onc === c.onc && o.lane === lane && Math.abs(o.s - s) < 30);
      const fresh = this.make(lane, clear ? s : s + 40, c.onc);
      Object.assign(c, fresh, { id: c.id });
    }
  }

  L.Traffic = Traffic;
})();
