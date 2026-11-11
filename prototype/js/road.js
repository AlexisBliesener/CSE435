/* Road centerline generator.
   The road is stored as a polyline sampled every 1 m along its length s.
   Heading th follows d(th)/ds = k (curvature). Positive k turns right.
   World frame: forward = (cos th, 0, sin th), right = (-sin th, 0, cos th). */
(function () {
  'use strict';
  const L = window.LMS;

  class Road {
    constructor() { this.reset(0); }

    reset(k0) {
      this.base = 0;
      this.X = [0]; this.Z = [0]; this.TH = [0]; this.K = [k0 || 0];
      this.rampFrom = k0 || 0; this.rampTo = k0 || 0; this.rampS0 = 0; this.rampLen = 1;
      this.kTarget = k0 || 0;
    }

    _kGen(i) {
      if (i >= this.rampS0 + this.rampLen) return this.rampTo;
      if (i <= this.rampS0) return this.rampFrom;
      const u = (i - this.rampS0) / this.rampLen;
      return this.rampFrom + (this.rampTo - this.rampFrom) * u;
    }

    // make sure the road exists up to sMax
    ensure(sMax) {
      const X = this.X, Z = this.Z, TH = this.TH, K = this.K;
      while (this.base + X.length - 1 < sMax) {
        const n = X.length - 1, i = this.base + n;
        const k0 = K[n], k1 = this._kGen(i + 1);
        const dth = 0.5 * (k0 + k1);
        const thm = TH[n] + 0.5 * dth;
        X.push(X[n] + Math.cos(thm));
        Z.push(Z[n] + Math.sin(thm));
        TH.push(TH[n] + dth);
        K.push(k1);
      }
    }

    // drop road far behind the car
    trim(sMin) {
      const drop = Math.floor(sMin) - this.base;
      if (drop > 600) {
        this.X.splice(0, drop); this.Z.splice(0, drop); this.TH.splice(0, drop); this.K.splice(0, drop);
        this.base += drop;
      }
    }

    // change the curvature of the road ahead. It ramps in (a clothoid) starting lead meters ahead.
    setCurvature(k, sNow, lead) {
      lead = lead == null ? 70 : lead;
      const cut = Math.ceil(sNow + lead);
      const n = cut - this.base;
      if (n >= 0 && n < this.X.length - 1) {
        this.X.length = n + 1; this.Z.length = n + 1; this.TH.length = n + 1; this.K.length = n + 1;
      }
      const kNow = this.K[Math.min(Math.max(n, 0), this.K.length - 1)];
      this.rampFrom = kNow;
      this.rampTo = k;
      this.rampS0 = Math.max(cut, this.base + this.X.length - 1);
      this.rampLen = Math.max(25, Math.min(140, Math.abs(k - kNow) * 15000 + 30));
      this.kTarget = k;
    }

    // interpolated centerline sample at s, written into out {x,z,th,k}
    sample(s, out) {
      const f = s - this.base;
      let n = Math.floor(f);
      const last = this.X.length - 2;
      if (n < 0) n = 0; else if (n > last) n = last;
      const u = f - n;
      out.x = this.X[n] + (this.X[n + 1] - this.X[n]) * u;
      out.z = this.Z[n] + (this.Z[n + 1] - this.Z[n]) * u;
      out.th = this.TH[n] + (this.TH[n + 1] - this.TH[n]) * u;
      out.k = this.K[n] + (this.K[n + 1] - this.K[n]) * u;
      return out;
    }

    kAt(s) { return this.sample(s, this._tmp || (this._tmp = {})).k; }

    // world position of the point at distance s and lateral offset d (positive right)
    point(s, d, out) {
      const p = this.sample(s, this._tmp2 || (this._tmp2 = {}));
      out.x = p.x - Math.sin(p.th) * d;
      out.z = p.z + Math.cos(p.th) * d;
      out.th = p.th;
      return out;
    }
  }

  L.Road = Road;
})();
