/* 3D view of the simulation (three.js r128).
   Road, markings and LMS overlays are rebuilt every frame for the stretch of road around the car,
   so any change to lanes, markings or curvature shows up immediately. */
(function () {
  'use strict';
  const L = window.LMS, C = L.CFG;

  /* ---------- dynamic triangle buffer ---------- */
  class Dyn {
    constructor(scene, maxTris, mat, opt) {
      opt = opt || {};
      this.max = maxTris * 3;
      this.pos = new Float32Array(this.max * 3);
      const g = (this.geo = new THREE.BufferGeometry());
      this.attr = new THREE.BufferAttribute(this.pos, 3);
      this.attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.attr);
      if (!opt.computeNormals) {
        const nrm = new Float32Array(this.max * 3);
        for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      }
      this.computeNormals = !!opt.computeNormals;
      this.mesh = new THREE.Mesh(g, mat);
      this.mesh.frustumCulled = false;
      if (opt.order != null) this.mesh.renderOrder = opt.order;
      scene.add(this.mesh);
      this.n = 0;
    }
    begin() { this.n = 0; }
    v(p) { const i = this.n * 3; this.pos[i] = p.x; this.pos[i + 1] = p.y; this.pos[i + 2] = p.z; this.n++; }
    // a,b: near edge (left to right), c,d: far edge (left to right); faces up
    quad(a, b, c, d) {
      if (this.n + 6 > this.max) return;
      this.v(a); this.v(b); this.v(c); this.v(b); this.v(d); this.v(c);
    }
    tri(a, b, c) { if (this.n + 3 > this.max) return; this.v(a); this.v(b); this.v(c); }
    end() {
      this.geo.setDrawRange(0, this.n);
      this.attr.needsUpdate = true;
      if (this.computeNormals && this.n) this.geo.computeVertexNormals();
    }
  }

  const V = () => ({ x: 0, y: 0, z: 0, th: 0 });

  class World3D {
    constructor(canvas, sim) {
      this.sim = sim; this.canvas = canvas;
      this.view = 'chase'; this.from = null; this.blend = 1;
      this.overheadH = 55; this.chaseZoom = 1;
      this.overlays = true;
      this.atmo = null;
      this.headingSmooth = null;
      this.tmp = [V(), V(), V(), V(), V(), V()];
      this.v3 = new THREE.Vector3(); this.v3b = new THREE.Vector3();

      const R = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
      R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const S = (this.scene = new THREE.Scene());
      S.background = new THREE.Color(0x9ec5e8);
      S.fog = new THREE.Fog(0x9ec5e8, 160, 700);
      this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1400);

      this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x70746c, 0.95); S.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xfff4e0, 0.85); S.add(this.sun); S.add(this.sun.target);

      const off = n => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n * 2 });
      this.mat = {
        asphalt: new THREE.MeshPhongMaterial({ color: 0x41464b, shininess: 6, specular: 0x111111 }),
        shoulder: new THREE.MeshPhongMaterial({ color: 0x4b4f52, shininess: 4, specular: 0x0a0a0a }),
        gravel: new THREE.MeshPhongMaterial({ color: 0x7a7266, shininess: 2, specular: 0x000000, ...off(0.5) }),
        ground: new THREE.MeshPhongMaterial({ color: 0x5b7b44, shininess: 1, specular: 0x000000, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
        white: new THREE.MeshPhongMaterial({ color: 0xf1f1ec, shininess: 10, transparent: true, ...off(2) }),
        yellow: new THREE.MeshPhongMaterial({ color: 0xe6b532, shininess: 10, transparent: true, ...off(2) }),
        patch: new THREE.MeshPhongMaterial({ color: 0x2a2e31, shininess: 30, transparent: true, opacity: 0.92, ...off(3) }),
        snow: new THREE.MeshPhongMaterial({ color: 0xf3f6f8, shininess: 2, transparent: true, opacity: 0.96, ...off(4) }),
        ghost: new THREE.MeshPhongMaterial({ color: 0xd9d9d2, transparent: true, opacity: 0.55, ...off(3) }),
        orange: new THREE.MeshPhongMaterial({ color: 0xe57a26, transparent: true, opacity: 0.95, ...off(3) }),
        barrier: new THREE.MeshLambertMaterial({ color: 0xb1b3ae, side: THREE.DoubleSide }),
        detect: new THREE.MeshBasicMaterial({ color: 0x4dd7e8, transparent: true, opacity: 0.85, depthWrite: false, ...off(6) }),
        center: new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.9, depthWrite: false, ...off(6) }),
        pred: new THREE.MeshBasicMaterial({ color: 0x74a7ff, transparent: true, opacity: 0.28, depthWrite: false, ...off(5) }),
        fov: new THREE.MeshBasicMaterial({ color: 0x4dd7e8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, ...off(5) })
      };

      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 60, 60), this.mat.ground);
      this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.15; S.add(this.ground);

      const m = this.mat;
      this.d = {
        gravel: new Dyn(S, 800, m.gravel),
        shoulder: new Dyn(S, 800, m.shoulder),
        asphalt: new Dyn(S, 500, m.asphalt),
        white: new Dyn(S, 2600, m.white, { order: 1 }),
        yellow: new Dyn(S, 1400, m.yellow, { order: 1 }),
        patch: new Dyn(S, 1000, m.patch, { order: 2 }),
        snow: new Dyn(S, 1400, m.snow, { order: 3 }),
        ghost: new Dyn(S, 1400, m.ghost, { order: 2 }),
        orange: new Dyn(S, 600, m.orange, { order: 2 }),
        barrier: new Dyn(S, 1100, m.barrier, { computeNormals: true }),
        detect: new Dyn(S, 500, m.detect, { order: 5 }),
        center: new Dyn(S, 200, m.center, { order: 6 }),
        pred: new Dyn(S, 80, m.pred, { order: 5 }),
        fov: new Dyn(S, 40, m.fov, { order: 4 })
      };

      this.buildScenery();
      this.ego = this.makeVehicle('ego', 0x2a5bd7);
      S.add(this.ego.group);
      this.buildInterior();
      this.head = new THREE.SpotLight(0xfff1d8, 0, 150, 0.45, 0.55, 1.2);
      this.head.position.set(2.2, 0.75, 0);
      this.headTarget = new THREE.Object3D(); this.headTarget.position.set(35, 0, 0);
      this.ego.group.add(this.head); this.ego.group.add(this.headTarget); this.head.target = this.headTarget;
      this.trafficMeshes = new Map();
      this.buildWeather();
    }

    /* ---------- vehicles ---------- */
    makeVehicle(kind, color) {
      const g = new THREE.Group();
      const dims = { car: [4.5, 1.8, 1.45], suv: [4.9, 1.95, 1.8], truck: [12.5, 2.5, 3.8], ego: [4.7, 1.85, 1.45] }[kind];
      const [Lx, W, H] = dims;
      const body = new THREE.MeshLambertMaterial({ color });
      const glass = this._glass || (this._glass = new THREE.MeshLambertMaterial({ color: 0x1b232b }));
      const parts = { group: g, tail: [], head: [], blinkL: [], blinkR: [], kind, color };
      const box = (w, h, d, mat, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); g.add(b); return b; };
      if (kind === 'truck') {
        box(2.5, 2.9, W, body, Lx / 2 - 1.25, 1.75, 0);
        box(0.08, 1.0, W * 0.86, glass, Lx / 2 + 0.01, 2.4, 0);
        const trailerMat = this._trailer || (this._trailer = new THREE.MeshLambertMaterial({ color: 0xe4e6e3 }));
        box(Lx - 3.0, 3.4, W, trailerMat, -1.5, 2.25, 0);
      } else {
        const low = H * 0.48;
        box(Lx, low, W, body, 0, 0.27 + low / 2, 0);
        const cab = box(Lx * 0.5, H * 0.42, W * 0.88, body, -Lx * 0.06, 0.27 + low + H * 0.21, 0);
        box(Lx * 0.5 + 0.02, H * 0.3, W * 0.9, glass, -Lx * 0.06, 0.27 + low + H * 0.2, 0);
        parts.cab = cab;
      }
      const wg = this._wheelGeo || (this._wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14));
      const wm = this._wheelMat || (this._wheelMat = new THREE.MeshLambertMaterial({ color: 0x141618 }));
      const axles = kind === 'truck' ? [Lx / 2 - 1.4, -Lx / 2 + 2.6, -Lx / 2 + 1.3] : [Lx * 0.32, -Lx * 0.32];
      for (const ax of axles) for (const sd of [-1, 1]) {
        const w = new THREE.Mesh(wg, wm); w.rotation.x = Math.PI / 2; w.position.set(ax, 0.36, sd * (W / 2 - 0.05)); g.add(w);
      }
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xa3141c });
      const headMat = new THREE.MeshBasicMaterial({ color: 0xd8dde0 });
      const ambMat = new THREE.MeshBasicMaterial({ color: 0x3a2a10 });
      const ambMatR = new THREE.MeshBasicMaterial({ color: 0x3a2a10 });
      const ty = kind === 'truck' ? 0.9 : 0.78;
      for (const sd of [-1, 1]) {
        parts.tail.push(box(0.06, 0.16, 0.38, tailMat, -Lx / 2 - 0.01, ty, sd * (W / 2 - 0.28)));
        parts.head.push(box(0.06, 0.14, 0.34, headMat, Lx / 2 + 0.01, kind === 'truck' ? 0.9 : 0.72, sd * (W / 2 - 0.3)));
        const b1 = box(0.07, 0.1, 0.14, sd < 0 ? ambMat : ambMatR, Lx / 2 + 0.02, ty + 0.1, sd * (W / 2 - 0.06));
        const b2 = box(0.07, 0.1, 0.14, sd < 0 ? ambMat : ambMatR, -Lx / 2 - 0.02, ty + 0.14, sd * (W / 2 - 0.06));
        (sd < 0 ? parts.blinkL : parts.blinkR).push(b1, b2);
      }
      parts.tailMat = tailMat; parts.headMat = headMat; parts.ambL = ambMat; parts.ambR = ambMatR;
      return parts;
    }

    buildInterior() {
      // first person: hide the body, show the hood, a slim dash and the top of the steering wheel
      this.ego.body = this.ego.group.children.slice();
      const g = (this.interior = new THREE.Group());
      const dark = new THREE.MeshLambertMaterial({ color: 0x14181b });
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.06, 1.8), new THREE.MeshPhongMaterial({ color: 0x1f3460, shininess: 40, specular: 0x3a4a66 }));
      hood.position.set(1.72, 0.92, 0); g.add(hood);
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.45, 3.4), new THREE.MeshBasicMaterial({ color: 0x0e1317 }));
      dash.position.set(0.79, 0.775, 0); g.add(dash);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 3.4), new THREE.MeshBasicMaterial({ color: 0x26313a }));
      lip.position.set(1.07, 1.003, 0); g.add(lip);
      const mount = new THREE.Group(); mount.position.set(0.42, 0.86, -0.37); mount.rotation.z = -0.45;
      const face = new THREE.Group(); face.rotation.y = Math.PI / 2; mount.add(face);
      const spin = (this.wheelSpin = new THREE.Group()); face.add(spin);
      const rimMat = new THREE.MeshLambertMaterial({ color: 0x3a434a });
      spin.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 32), rimMat));
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.02), rimMat); spin.add(spoke);
      this.wheelMark = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xf5b642 }));
      this.wheelMark.position.set(0, 0.19, 0.02); spin.add(this.wheelMark);
      mount.visible = false; // the dashboard overlay draws the steering wheel
      g.add(mount);
      this.ego.group.add(g);
    }

    buildScenery() {
      const S = this.scene;
      this.treeMat = new THREE.MeshLambertMaterial({ color: 0x2f5a35 });
      this.trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3626 });
      this.trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 6.5, 7), this.treeMat, 140);
      this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1.8, 6), this.trunkMat, 140);
      this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), new THREE.MeshLambertMaterial({ color: 0xe8ebec }), 40);
      this.poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 9, 0.18), new THREE.MeshLambertMaterial({ color: 0x8c9296 }), 20);
      for (const im of [this.trees, this.trunks, this.posts, this.poles]) { im.frustumCulled = false; im.count = 0; S.add(im); }
      this.m4 = new THREE.Matrix4(); this.q4 = new THREE.Quaternion(); this.s4 = new THREE.Vector3(); this.p4 = new THREE.Vector3();
    }

    buildWeather() {
      const S = this.scene;
      const NR = (this.NR = 1800);
      this.rainPos = new Float32Array(NR * 6);
      this.rainSeed = new Float32Array(NR * 3);
      for (let i = 0; i < NR; i++) { this.rainSeed[i * 3] = Math.random() * 60 - 30; this.rainSeed[i * 3 + 1] = Math.random() * 26; this.rainSeed[i * 3 + 2] = Math.random() * 60 - 30; }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb4bec8, transparent: true, opacity: 0.5, fog: false }));
      this.rain.frustumCulled = false; S.add(this.rain);
      const NS = (this.NS = 2600);
      this.snowPos = new Float32Array(NS * 3);
      for (let i = 0; i < NS; i++) { this.snowPos[i * 3] = Math.random() * 60 - 30; this.snowPos[i * 3 + 1] = Math.random() * 26; this.snowPos[i * 3 + 2] = Math.random() * 60 - 30; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.9, fog: false }));
      this.snow.frustumCulled = false; S.add(this.snow);
    }

    /* ---------- helpers ---------- */
    P(s, d, y, out) { this.sim.road.point(s, d, out); out.y = y; return out; }

    ribbon(dyn, s0, s1, dA, dB, y, step) {
      const t = this.tmp;
      let a = this.P(s0, dA, y, t[0]), b = this.P(s0, dB, y, t[1]);
      for (let s = s0 + step; s <= s1 + 1e-6; s += step) {
        const c = this.P(s, dA, y, t[2]), d = this.P(s, dB, y, t[3]);
        dyn.quad(a, b, c, d);
        // rotate temporaries
        t[0] = c; t[2] = a; t[1] = d; t[3] = b; a = c; b = d;
      }
    }

    // slanted ribbon whose lateral position changes along s (for construction lines)
    slant(dyn, s0, s1, d0, d1, w, y, step) {
      const t = this.tmp;
      const dd = s => d0 + (d1 - d0) * ((s - s0) / (s1 - s0));
      let a = this.P(s0, dd(s0) - w, y, t[0]), b = this.P(s0, dd(s0) + w, y, t[1]);
      for (let s = s0 + step; s <= s1 + 1e-6; s += step) {
        const c = this.P(s, dd(s) - w, y, t[2]), d = this.P(s, dd(s) + w, y, t[3]);
        dyn.quad(a, b, c, d);
        t[0] = c; t[2] = a; t[1] = d; t[3] = b; a = c; b = d;
      }
    }

    wall(dyn, s0, s1, d, h, step) {
      const t = this.tmp;
      for (let s = s0; s < s1; s += step) {
        const a = this.P(s, d, 0, t[0]), b = this.P(s, d, h, t[1]), c = this.P(s + step, d, 0, t[2]), e = this.P(s + step, d, h, t[3]);
        dyn.quad(a, b, c, e);
        const f = this.P(s, d - 0.15, h, t[4]), g = this.P(s + step, d - 0.15, h, t[5]);
        dyn.quad(f, b, g, e);
      }
    }

    line(dyn, s0, s1, d, w, y, style) {
      if (style === 'solid') this.ribbon(dyn, s0, s1, d - w / 2, d + w / 2, y, 3);
      else if (style === 'dashed') {
        for (let k = Math.ceil(s0 / 12); k * 12 < s1; k++) { const a = k * 12; this.ribbon(dyn, a, a + 3, d - w / 2, d + w / 2, y, 1.5); }
      } else if (style === 'double') {
        this.ribbon(dyn, s0, s1, d - 0.14 - w / 2, d - 0.14 + w / 2, y, 3);
        this.ribbon(dyn, s0, s1, d + 0.14 - w / 2, d + 0.14 + w / 2, y, 3);
      }
    }

    // lane line layout for the current road: [{d, style, color}]
    lineSpecs() {
      const sim = this.sim, R = sim.road_(), N = R.lanes, W = sim.env.laneW;
      const out = [];
      const left = sim.laneCenter(0) - W / 2, right = sim.laneCenter(N - 1) + W / 2;
      out.push({ d: left, style: R.leftLine === 'double-yellow' ? 'double' : 'solid', color: 'yellow' });
      for (let i = 1; i < N; i++) out.push({ d: left + i * W, style: 'dashed', color: 'white' });
      out.push({ d: right, style: 'solid', color: 'white' });
      if (R.oncoming) out.push({ d: sim.laneCenter(-R.oncoming) - W / 2, style: 'solid', color: 'white' });
      return out;
    }

    setView(v) {
      if (v === this.view) return;
      this.from = { pos: this.camera.position.clone(), look: this._look ? this._look.clone() : new THREE.Vector3(), up: this.camera.up.clone(), fov: this.camera.fov };
      this.blend = 0; this.view = v;
    }

    zoom(dir) {
      if (this.view === 'overhead') this.overheadH = L.clamp(this.overheadH * (dir > 0 ? 1.12 : 1 / 1.12), 18, 180);
      else if (this.view === 'chase') this.chaseZoom = L.clamp(this.chaseZoom * (dir > 0 ? 1.1 : 1 / 1.1), 0.55, 3);
    }

    resize(w, h) {
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }

    /* ---------- atmosphere: sky, fog, light ---------- */
    atmosphereTarget() {
      const e = this.sim.env, I = e.weather === 'clear' ? 0 : e.intensity;
      const c = new THREE.Color(0x9ec5e8);
      let near = 160, far = 720, hemi = 0.95, sun = 0.85;
      if (e.weather === 'rain') { c.lerp(new THREE.Color(0x7d8891), Math.min(1, I * 1.3)); near = 160 - 120 * I; far = 720 - 450 * I; hemi -= 0.3 * I; sun -= 0.6 * I; }
      if (e.weather === 'fog') { c.lerp(new THREE.Color(0xc0c7cb), Math.min(1, I * 1.5)); near = 160 - 158 * I; far = Math.max(38, 720 - 690 * I); sun -= 0.6 * I; }
      if (e.weather === 'snow') { c.lerp(new THREE.Color(0xd2d9df), Math.min(1, I * 1.4)); near = 160 - 130 * I; far = 720 - 480 * I; sun -= 0.5 * I; }
      if (e.night) { c.multiplyScalar(0.1).lerp(new THREE.Color(0x070c18), 0.55); hemi = 0.16; sun = 0.03; far = Math.min(far, 420); }
      return { c, near: Math.max(1, near), far, hemi, sun, head: e.night ? 2.6 : (e.weather === 'fog' && I > 0.4 ? 0.6 : 0) };
    }

    updateAtmosphere(dt) {
      const T = this.atmosphereTarget();
      if (!this.atmo) this.atmo = { c: T.c.clone(), near: T.near, far: T.far, hemi: T.hemi, sun: T.sun, head: T.head };
      const A = this.atmo, k = Math.min(1, dt * 1.6);
      A.c.lerp(T.c, k); A.near += (T.near - A.near) * k; A.far += (T.far - A.far) * k;
      A.hemi += (T.hemi - A.hemi) * k; A.sun += (T.sun - A.sun) * k; A.head += (T.head - A.head) * k;
      this.scene.background.copy(A.c);
      this.scene.fog.color.copy(A.c); this.scene.fog.near = A.near; this.scene.fog.far = A.far;
      this.hemi.intensity = A.hemi; this.sun.intensity = A.sun; this.head.intensity = A.head;

      const e = this.sim.env, I = e.weather === 'clear' ? 0 : e.intensity;
      const wet = e.weather === 'rain' ? I : 0, snowy = e.weather === 'snow' ? I : 0;
      this.mat.asphalt.color.setHex(0x41464b).lerp(new THREE.Color(0x272c30), wet).lerp(new THREE.Color(0x8d9397), snowy * 0.75);
      this.mat.asphalt.shininess = 6 + wet * 70; this.mat.asphalt.specular.setScalar(0.07 + wet * 0.35);
      this.mat.shoulder.color.setHex(0x4b4f52).lerp(new THREE.Color(0x2c3134), wet).lerp(new THREE.Color(0xe1e6ea), snowy);
      this.mat.ground.color.setHex(0x5b7b44).lerp(new THREE.Color(0x48613a), wet * 0.6).lerp(new THREE.Color(0xeef2f5), Math.min(1, snowy * 1.6));
      this.mat.gravel.color.setHex(0x7a7266).lerp(new THREE.Color(0xe8ecef), Math.min(1, snowy * 1.5));
      this.treeMat.color.setHex(0x2f5a35).lerp(new THREE.Color(0xc9d3d8), snowy * 0.8);
      const m = e.marks;
      const fade = m === 'faded' ? 0.16 : 1;
      const snowCover = 1 - Math.min(0.85, snowy * 1.1);
      this.mat.white.opacity = fade * snowCover; this.mat.yellow.opacity = fade * snowCover;
      this.mat.white.color.setHex(m === 'faded' ? 0xa9aaa5 : 0xf1f1ec);
      this.mat.yellow.color.setHex(m === 'faded' ? 0x9c8a5a : 0xe6b532);
      const night = !!e.night;
      this.mat.white.emissive.setHex(night ? 0x2a2a28 : 0x000000);
      this.mat.yellow.emissive.setHex(night ? 0x2a2206 : 0x000000);
      for (const p of [this.ego, ...this.trafficMeshes.values()]) {
        p.tailMat.color.setHex(night ? 0xff3434 : 0xa3141c);
        p.headMat.color.setHex(night ? 0xfff6dc : 0xd8dde0);
      }
    }

    /* ---------- per-frame scene build ---------- */
    buildRoad() {
      const sim = this.sim, eg = sim.ego, e = sim.env, R = sim.road_(), N = R.lanes, W = e.laneW;
      const D = this.d;
      const sA = eg.s - 70, sB = eg.s + Math.min(420, (this.atmo ? this.atmo.far : 700) + 60);
      for (const k in D) D[k].begin();
      const ownL = sim.laneCenter(0) - W / 2, ownR = sim.laneCenter(N - 1) + W / 2;
      const paveL = R.oncoming ? sim.laneCenter(-R.oncoming) - W / 2 : ownL;
      this.ribbon(D.asphalt, sA, sB, paveL - 0.25, ownR + 0.25, 0, 3);
      if (R.shoulderR) this.ribbon(D.shoulder, sA, sB, ownR + 0.25, ownR + R.shoulderR, 0, 3);
      if (R.shoulderL) this.ribbon(D.shoulder, sA, sB, ownL - R.shoulderL, ownL - 0.25, 0, 3);
      const edgeR = ownR + R.shoulderR, edgeL = R.shoulderL ? ownL - R.shoulderL : paveL - 0.25;
      this.ribbon(D.gravel, sA, sB, edgeR, edgeR + 1.2, 0.003, 3);
      this.ribbon(D.gravel, sA, sB, edgeL - 1.0, edgeL, 0.003, 3);
      if (R.median) this.wall(D.barrier, sA, sB, edgeL - 0.7, 0.85, 3);

      // markings
      const marks = e.marks, specs = this.lineSpecs(), y = 0.012;
      if (marks !== 'none') {
        for (const sp of specs) this.line(sp.color === 'yellow' ? D.yellow : D.white, sA, sB, sp.d, 0.15, y, sp.style);
      }
      const h = L.hash;
      if (marks === 'obscured') {
        // debris, tar patches and puddles that hide the lines
        for (let c = Math.ceil(sA / 6); c * 6 < sB; c++) specs.forEach((sp, j) => {
          if (h(c * 7.1 + j * 3.3) < 0.55) {
            const s0 = c * 6 + h(c + j) * 2, len = 2 + h(c * 1.7 + j) * 3, w = 0.35 + h(c * 2.9 + j) * 0.5, off = (h(c * 3.7 + j) - 0.5) * 0.3;
            this.ribbon(D.patch, s0, s0 + len, sp.d + off - w, sp.d + off + w, y + 0.004, len / 2);
          }
        });
      }
      if (marks === 'complex') {
        // old lane lines left over from a work zone, plus temporary orange lines
        for (let c = Math.ceil(sA / 14); c * 14 < sB; c++) {
          for (let i = 0; i <= N; i++) {
            const d0 = ownL + i * W + 0.9;
            if (h(c * 1.3 + i) < 0.75) this.ribbon(D.ghost, c * 14, c * 14 + 9, d0 - 0.07, d0 + 0.07, y, 3);
          }
        }
        for (let c = Math.ceil(sA / 40); c * 40 < sB; c++) {
          const lane = Math.floor(h(c * 5.1) * N), dl = ownL + lane * W;
          this.slant(D.orange, c * 40, c * 40 + 28, dl + 0.2, dl + W - 0.2, 0.08, y + 0.002, 2);
          this.slant(D.orange, c * 40 + 6, c * 40 + 34, dl + 0.2, dl + W - 0.2, 0.08, y + 0.002, 2);
        }
      }
      const snowy = e.weather === 'snow' ? e.intensity : 0;
      if (snowy > 0.15 && marks !== 'none') {
        for (let c = Math.ceil(sA / 4); c * 4 < sB; c++) specs.forEach((sp, j) => {
          if (h(c * 4.3 + j * 1.9) < snowy * 1.1) { const s0 = c * 4 + h(c * 2.3 + j) * 1.5, len = 1.2 + h(c * 6.1 + j) * 2.6, w = 0.12 + h(c + j * 2) * 0.22, off = (h(c * 3.1 + j) - 0.5) * 0.2; this.ribbon(D.snow, s0, s0 + len, sp.d + off - w, sp.d + off + w, y + 0.006, len / 2); }
        });
        // snow banks along the edges
        this.ribbon(D.snow, sA, sB, ownR - 0.1, edgeR, 0.008, 3);
        if (R.shoulderL) this.ribbon(D.snow, sA, sB, edgeL, ownL + 0.1, 0.008, 3);
      }
      this.edgeL = edgeL; this.edgeR = edgeR;
    }

    buildOverlays() {
      const sim = this.sim, ctrl = sim.ctrl, eg = sim.ego, e = sim.env, D = this.d, t = this.tmp;
      if (!this.overlays) return;
      const lane = ctrl.homeLane == null ? sim.laneOf(eg.d) : ctrl.homeLane;
      const detected = ctrl.faults().length === 0;
      const c = sim.laneCenter(lane), W = e.laneW;
      if (detected) {
        const range = 18 + ctrl.q * 0.6;
        this.ribbon(D.detect, eg.s + 1, eg.s + range, c - W / 2 - 0.1, c - W / 2 + 0.1, 0.03, 2);
        this.ribbon(D.detect, eg.s + 1, eg.s + range, c + W / 2 - 0.1, c + W / 2 + 0.1, 0.03, 2);
      }
      if (ctrl.mode === 'ACTIVE') {
        for (let s = Math.ceil((eg.s + 3) / 4) * 4; s < eg.s + 60; s += 4) this.ribbon(D.center, s, s + 1.4, c - 0.07, c + 0.07, 0.035, 1.4);
      }
      // predicted path (SRS 6.3)
      const v = eg.v;
      if (v > 3) {
        const kRoad = sim.road.kAt(eg.s), T = C.predT, n = 12;
        let a = null, b = null;
        for (let i = 0; i <= n; i++) {
          const tau = T * i / n;
          const s = eg.s + 2.3 + v * tau, d = eg.d + v * tau * Math.sin(eg.psi) + 0.5 * v * v * tau * tau * (eg.kTotal - kRoad);
          const p = this.P(s, d - C.carW * 0.45, 0.04, i % 2 ? t[2] : t[0]), q = this.P(s, d + C.carW * 0.45, 0.04, i % 2 ? t[3] : t[1]);
          if (a) D.pred.quad(a, b, p, q);
          a = { x: p.x, y: p.y, z: p.z }; b = { x: q.x, y: q.y, z: q.z };
        }
        this.mat.pred.color.setHex(ctrl.predOut && ctrl.mode === 'ACTIVE' ? 0xf5b642 : 0x74a7ff);
      }
      // camera field of view, shown from outside the car
      if (this.view !== 'fpv' && !e.camFail) {
        const g = this.ego.group, range = 15 + ctrl.q * 0.3, half = 0.3, segs = 8;
        const o = this.v3.set(2.0, 0.05, 0).applyMatrix4(g.matrixWorld);
        const O = { x: o.x, y: 0.05, z: o.z };
        let prev = null;
        for (let i = 0; i <= segs; i++) {
          const ang = -half + (2 * half * i) / segs;
          const p = this.v3b.set(2.0 + Math.cos(ang) * range, 0.05, Math.sin(ang) * range).applyMatrix4(g.matrixWorld);
          const P = { x: p.x, y: 0.05, z: p.z };
          if (prev) D.fov.tri(O, prev, P);
          prev = P;
        }
      }
    }

    placeScenery() {
      const sim = this.sim, eg = sim.ego, h = L.hash, R = sim.road_();
      const sA = eg.s - 70, sB = eg.s + 400;
      const m = this.m4, q = this.q4, sc = this.s4, p = this.p4, pt = this.tmp[4];
      let nt = 0;
      const up = new THREE.Vector3(0, 1, 0);
      for (let c = Math.ceil(sA / 15); c * 15 < sB && nt < 138; c++) {
        for (const side of [-1, 1]) {
          const r = h(c * 3.17 + side * 11.3);
          if (r > 0.62) continue;
          const s = c * 15 + h(c * 1.9 + side) * 10;
          const base = side > 0 ? this.edgeR + 7 : this.edgeL - (R.median ? 9 : 7);
          const d = base + side * h(c * 7.7 + side * 2) * 26;
          sim.road.point(s, d, pt);
          const k = 0.75 + h(c * 5.3 + side) * 0.7;
          p.set(pt.x, 3.25 * k + 1.2 * k, pt.z); q.setFromAxisAngle(up, 0); sc.set(k, k, k);
          m.compose(p, q, sc); this.trees.setMatrixAt(nt, m);
          p.set(pt.x, 0.9 * k, pt.z); m.compose(p, q, sc); this.trunks.setMatrixAt(nt, m);
          nt++;
        }
      }
      this.trees.count = nt; this.trunks.count = nt;
      this.trees.instanceMatrix.needsUpdate = true; this.trunks.instanceMatrix.needsUpdate = true;
      let np = 0;
      for (let c = Math.ceil(sA / 25); c * 25 < sB && np < 40; c++) {
        sim.road.point(c * 25, this.edgeR + 0.5, pt);
        p.set(pt.x, 0.5, pt.z); sc.set(1, 1, 1); m.compose(p, q, sc); this.posts.setMatrixAt(np++, m);
      }
      this.posts.count = np; this.posts.instanceMatrix.needsUpdate = true;
      let nl = 0;
      if (R.median) for (let c = Math.ceil(sA / 60); c * 60 < sB && nl < 20; c++) {
        sim.road.point(c * 60, this.edgeL - 0.7, pt);
        p.set(pt.x, 4.5, pt.z); sc.set(1, 1, 1); m.compose(p, q, sc); this.poles.setMatrixAt(nl++, m);
      }
      this.poles.count = nl; this.poles.instanceMatrix.needsUpdate = true;
    }

    placeVehicles(blinkOn) {
      const sim = this.sim, eg = sim.ego, pt = this.tmp[4];
      sim.road.point(eg.s, eg.d, pt);
      const g = this.ego.group;
      g.position.set(pt.x, 0, pt.z);
      g.rotation.y = -(pt.th + eg.psi);
      g.updateMatrixWorld();
      this.egoHeading = pt.th + eg.psi;
      this.ego.ambL.color.setHex(sim.signal < 0 && blinkOn ? 0xffb020 : 0x3a2a10);
      this.ego.ambR.color.setHex(sim.signal > 0 && blinkOn ? 0xffb020 : 0x3a2a10);
      const fpv = this.view === 'fpv' && this.blend > 0.5;
      this.interior.visible = fpv;
      for (const b of this.ego.body) b.visible = !fpv;

      const seen = new Set();
      for (const c of sim.traffic.cars) {
        let mm = this.trafficMeshes.get(c.id);
        if (mm && (mm.kind !== c.kind || mm.color !== c.color)) { this.scene.remove(mm.group); this.trafficMeshes.delete(c.id); mm = null; }
        if (!mm) { mm = this.makeVehicle(c.kind, c.color); this.scene.add(mm.group); this.trafficMeshes.set(c.id, mm); mm.tailMat.color.setHex(sim.env.night ? 0xff3434 : 0xa3141c); mm.headMat.color.setHex(sim.env.night ? 0xfff6dc : 0xd8dde0); }
        seen.add(c.id);
        sim.road.point(c.s, c.d, pt);
        mm.group.position.set(pt.x, 0, pt.z);
        mm.group.rotation.y = -(pt.th + (c.onc ? Math.PI : 0));
        mm.ambL.color.setHex(c.sig < 0 && blinkOn ? 0xffb020 : 0x3a2a10);
        mm.ambR.color.setHex(c.sig > 0 && blinkOn ? 0xffb020 : 0x3a2a10);
      }
      for (const [id, mm] of this.trafficMeshes) if (!seen.has(id)) { this.scene.remove(mm.group); this.trafficMeshes.delete(id); }
    }

    updateWeather(dt, center) {
      const e = this.sim.env, I = e.weather === 'clear' ? 0 : e.intensity;
      const rainN = e.weather === 'rain' ? Math.floor(this.NR * I) : 0;
      const snowN = e.weather === 'snow' ? Math.floor(this.NS * I) : 0;
      this.rain.visible = rainN > 0; this.snow.visible = snowN > 0;
      const wind = e.wind ? 4 : 0.6;
      const wrap = (v, size) => ((v % size) + size) % size - size / 2;
      if (rainN) {
        const P = this.rainPos, S = this.rainSeed;
        for (let i = 0; i < rainN; i++) {
          S[i * 3 + 1] -= 19 * dt; S[i * 3] += wind * dt;
          if (S[i * 3 + 1] < 0) S[i * 3 + 1] += 26;
          const x = center.x + wrap(S[i * 3] - center.x, 60), yy = center.y - 8 + S[i * 3 + 1], z = center.z + wrap(S[i * 3 + 2] - center.z, 60);
          const j = i * 6;
          P[j] = x; P[j + 1] = yy; P[j + 2] = z; P[j + 3] = x - wind * 0.03; P[j + 4] = yy + 0.55; P[j + 5] = z;
        }
        this.rain.geometry.setDrawRange(0, rainN * 2);
        this.rain.geometry.attributes.position.needsUpdate = true;
        this.rain.material.color.setHex(e.night ? 0x5d6670 : 0xb4bec8);
      }
      if (snowN) {
        const S = this.snowPos, P = this.snow.geometry.attributes.position.array, t = this.sim.t;
        for (let i = 0; i < snowN; i++) {
          S[i * 3 + 1] -= 1.6 * dt; S[i * 3] += (wind * 0.6 + Math.sin(t * 0.9 + i) * 0.5) * dt;
          if (S[i * 3 + 1] < 0) S[i * 3 + 1] += 26;
          P[i * 3] = center.x + wrap(S[i * 3] - center.x, 60);
          P[i * 3 + 1] = center.y - 8 + S[i * 3 + 1];
          P[i * 3 + 2] = center.z + wrap(S[i * 3 + 2] - center.z, 60);
        }
        this.snow.geometry.setDrawRange(0, snowN);
        this.snow.geometry.attributes.position.needsUpdate = true;
        this.snow.material.color.setHex(e.night ? 0x8d97a3 : 0xffffff);
      }
    }

    /* ---------- camera ---------- */
    targetPose(view, dt) {
      const g = this.ego.group;
      const th = this.egoHeading;
      if (this.headingSmooth == null || Math.abs(th - this.headingSmooth) > 1) this.headingSmooth = th;
      this.headingSmooth += (th - this.headingSmooth) * (1 - Math.exp(-(dt || 0.016) * 5));
      const hs = this.headingSmooth;
      const fx = Math.cos(hs), fz = Math.sin(hs);
      const px = g.position.x, pz = g.position.z;
      if (view === 'fpv') {
        const pos = new THREE.Vector3(0.12, 1.22, -0.37).applyMatrix4(g.matrixWorld);
        const look = new THREE.Vector3(40, 1.0, -0.37).applyMatrix4(g.matrixWorld);
        const ctrl = this.sim.ctrl;
        if (ctrl.ldw && ctrl.mode === 'ACTIVE') { pos.x += (Math.random() - 0.5) * 0.012; pos.y += (Math.random() - 0.5) * 0.01; }
        return { pos, look, up: new THREE.Vector3(0, 1, 0), fov: 62 };
      }
      if (view === 'chase') {
        const z = this.chaseZoom, back = 10 * z, up = 3.8 * Math.pow(z, 0.85);
        return { pos: new THREE.Vector3(px - fx * back, up, pz - fz * back), look: new THREE.Vector3(px + fx * 16, 0.9, pz + fz * 16), up: new THREE.Vector3(0, 1, 0), fov: 55 };
      }
      const H = this.overheadH, ahead = H * 0.3;
      const tx = px + fx * ahead, tz = pz + fz * ahead;
      return { pos: new THREE.Vector3(tx, H, tz), look: new THREE.Vector3(tx, 0, tz), up: new THREE.Vector3(fx, 0, fz), fov: 50 };
    }

    updateCamera(dt) {
      const T = this.targetPose(this.view, dt), cam = this.camera;
      if (this.blend < 1 && this.from) {
        this.blend = Math.min(1, this.blend + dt / 0.8);
        const u = this.blend < 0.5 ? 2 * this.blend * this.blend : 1 - Math.pow(-2 * this.blend + 2, 2) / 2;
        T.pos.lerpVectors(this.from.pos, T.pos, u);
        T.look.lerpVectors(this.from.look, T.look, u);
        T.up.lerpVectors(this.from.up, T.up, u).normalize();
        T.fov = this.from.fov + (T.fov - this.from.fov) * u;
      }
      cam.position.copy(T.pos); cam.up.copy(T.up); cam.lookAt(T.look);
      this._look = T.look;
      if (Math.abs(cam.fov - T.fov) > 0.01) { cam.fov = T.fov; }
      cam.near = this.view === 'fpv' && this.blend > 0.5 ? 0.08 : 0.4;
      cam.updateProjectionMatrix();
      this.sun.position.set(cam.position.x + 120, 180, cam.position.z + 60);
      this.sun.target.position.set(cam.position.x, 0, cam.position.z);
      this.ground.position.set(Math.round(cam.position.x / 50) * 50, -0.15, Math.round(cam.position.z / 50) * 50);
    }

    render(dt, dtSim) {
      if (dtSim == null) dtSim = dt;
      const sim = this.sim, ctrl = sim.ctrl;
      this.updateAtmosphere(dt);
      const blinkOn = Math.floor(performance.now() / 380) % 2 === 0;
      this.placeVehicles(blinkOn);
      this.buildRoad();
      this.buildOverlays();
      for (const k in this.d) this.d[k].end();
      this.placeScenery();
      // steering wheel follows the total steering, and shakes during a departure warning
      const steerDeg = (sim.driver.steer * 40 + (ctrl.mode === 'ACTIVE' ? ctrl.kCmd : 0) * C.degPerK + sim.driver.dmFb * C.degPerK);
      this.wheelSpin.rotation.z = -steerDeg * Math.PI / 180 * 2;
      if (ctrl.ldw && ctrl.mode === 'ACTIVE') this.wheelSpin.position.set((Math.random() - 0.5) * 0.006, (Math.random() - 0.5) * 0.006, 0);
      else this.wheelSpin.position.set(0, 0, 0);
      this.updateCamera(dt);
      const g = this.ego.group.position;
      const center = this.view === 'overhead' ? { x: g.x, y: 12, z: g.z } : { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
      this.updateWeather(dtSim, center);
      this.renderer.render(this.scene, this.camera);
    }
  }

  L.World3D = World3D;
})();
