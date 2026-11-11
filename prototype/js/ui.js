/* Dashboard, control panel, keyboard, decision log and requirement trace. */
(function () {
  'use strict';
  const L = window.LMS, C = L.CFG, clamp = L.clamp;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const STATE = {
    OFF: ['off', 'OFF'], ACTIVE: ['active', 'ACTIVE'], SUSPENDED: ['susp', 'PAUSED'],
    FAULT: ['fault', 'FAULT'], OVERRIDE: ['over', 'OVERRIDE'], TAKEOVER: ['fault', 'TAKE CONTROL']
  };
  const VIEWS = ['fpv', 'overhead', 'chase'];

  class UI {
    constructor(sim, world, app) {
      this.sim = sim; this.world = world; this.app = app;
      this.keys = new Set(); this.steerFromKeys = false;
      this.lastNoticeKey = ''; this.showSteer = true; this.view = 'chase';
      this.buildReqs(); this.buildScenarioList(); this.bind();
      sim.on('hit', id => { const li = $('rq' + id.replace('.', '_')); if (li) li.classList.add('hit'); this.countReqs(); });
      sim.on('env', () => { this.envDirty = true; });
      sim.on('driver', () => { this.envDirty = true; this.keys.clear(); this.steerFromKeys = false; if (this.modeShown !== sim.driverMode) { this.modeShown = sim.driverMode; this.buildSteps(); this.syncMode(); } });
      sim.on('step', e => { if (e.prompt) this.prompt('Your turn', e.prompt, 8); });
    }

    /* ---------- static content ---------- */
    buildReqs() {
      $('reqs').innerHTML = L.REQS.map(r => '<li id="rq' + r[0].replace('.', '_') + '"' + (this.sim.hits.has(r[0]) ? ' class="hit"' : '') + '><span class="box"></span><b>' + r[0] + '</b><span>' + esc(r[1]) + '</span></li>').join('');
      this.countReqs();
    }
    countReqs() { $('reqCount').textContent = L.REQS.filter(r => this.sim.hits.has(r[0])).length + ' of ' + L.REQS.length; }

    buildScenarioList() {
      $('scList').innerHTML = L.SCENARIOS.map((s, i) => {
        const m = s.tab.match(/^(\d)\s+(.*)$/);
        const name = m ? m[2] : s.tab;
        const sub = m ? (+m[1] <= 4 ? 'Customer ' + m[1] : 'Environment') : 'No script';
        return '<button class="scbtn" data-i="' + i + '" aria-pressed="false"><b>' + esc(name) + '</b><small>' + sub + '</small></button>';
      }).join('');
      $('ctlRoad').innerHTML = Object.keys(L.ROADS).map(k => '<option value="' + k + '">' + esc(L.ROADS[k].name) + '</option>').join('');
    }

    onScenario(i) {
      const sc = L.SCENARIOS[i];
      [...$('scList').children].forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
      $('scTitle').textContent = sc.title;
      $('scSum').textContent = sc.summary;
      this.modeShown = this.sim.driverMode;
      this.buildSteps(); this.syncMode(); this.hidePrompt();
      this.keys.clear(); this.steerFromKeys = false;
      this.envDirty = true; this.syncControls(true);
      this.sim.logDirty = true;
    }

    // step list: narration for the automatic driver, prompts for self drive
    buildSteps() {
      const r = this.sim.runner, sc = r ? r.sc : L.SCENARIOS[this.app.scenario], self = this.sim.driverMode === 'self';
      $('steps').innerHTML = sc.steps.length
        ? sc.steps.map(st => '<li>' + (self && st.you ? '<span class="you">YOU</span>' + esc(st.you) : esc(st.text)) + '</li>').join('')
        : '<li>' + (self ? 'You are driving. Use the keyboard or the Driver tab, and change the road and weather as you go.' : 'The automatic driver holds the lane. Change the road and weather, or choose Self drive.') + '</li>';
      if (r) r.dirty = true;
    }

    syncMode() {
      const self = this.sim.driverMode === 'self';
      [...$('segDriver').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === this.sim.driverMode)));
      $('btnTake').setAttribute('aria-pressed', String(self));
      $('takeLbl').textContent = self ? 'You are driving' : 'Automatic driver';
      $('takeAct').textContent = self ? 'Hand back' : 'Take control';
      $('drvNote').textContent = self
        ? 'You drive: speed, steering, signals and the LMS button are yours. Road, weather and fault events still happen on schedule, and the steps below tell you what to try.'
        : 'The automatic driver follows the script. Choose Self drive to take the wheel; road, weather and fault events still happen on schedule.';
      $('drvLock').hidden = self;
      this.syncKeyHint();
      this.syncControls(true);
    }

    syncKeyHint() {
      const self = this.sim.driverMode === 'self';
      $('keyHint').textContent = self
        ? 'W S speed · A D steer · Q E signal · L LMS · T hand back · V view'
        : 'T take control · V view · Space pause' + (this.view !== 'fpv' ? ' · Scroll to zoom' : '');
    }

    toggleDriver() { this.sim.setDriverMode(this.sim.driverMode === 'self' ? 'auto' : 'self'); }

    prompt(head, text, secs, kind) {
      $('vpPromptH').textContent = head; $('vpPromptT').textContent = text;
      $('vpPrompt').className = 'vp-prompt' + (kind ? ' ' + kind : '');
      $('vpPrompt').hidden = false;
      this.promptUntil = performance.now() + secs * 1000;
    }
    hidePrompt() { $('vpPrompt').hidden = true; this.promptUntil = 0; }

    /* ---------- bindings ---------- */
    bind() {
      const S = this.sim, app = this.app;
      const seg = (id, fn) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) { fn(b.dataset.v); this.envDirty = true; this.syncControls(true); } });
      const logChange = (id, fn) => $(id).addEventListener('change', fn);

      $('panelTabs').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        [...$('panelTabs').children].forEach(t => { const on = t === b; t.setAttribute('aria-selected', String(on)); $(t.getAttribute('aria-controls')).hidden = !on; });
      });
      $('segDriver').addEventListener('click', e => { const b = e.target.closest('button'); if (b) S.setDriverMode(b.dataset.v); });
      $('btnTake').onclick = () => this.toggleDriver();
      $('btnTake2').onclick = () => this.toggleDriver();
      $('scList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) app.startScenario(+b.dataset.i); });
      $('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) app.setView(b.dataset.view); });
      $('btnOverlay').onclick = () => { if (!this.world) return; this.world.overlays = !this.world.overlays; $('btnOverlay').setAttribute('aria-pressed', String(this.world.overlays)); $('ovLegend').hidden = !this.world.overlays; };
      $('btnSound').onclick = () => { L.Audio.on = !L.Audio.on; L.Audio.ensure(); $('btnSound').setAttribute('aria-pressed', String(L.Audio.on)); $('btnSound').textContent = L.Audio.on ? 'Sound on' : 'Sound off'; };

      // road and weather
      $('ctlRoad').onchange = e => S.setEnv({ road: e.target.value });
      seg('segTraffic', v => S.setEnv({ traffic: v }));
      $('btnCutIn').onclick = () => { if (S.traffic.cutIn()) S.ev('INFO', 'A car cuts in ahead. LMS does not detect vehicles and keeps centering'); else S.notify('No neighboring lane for a cut-in', 'info', 3); };
      seg('segWeather', v => S.setEnv({ weather: v, intensity: v !== 'clear' && S.env.intensity < 0.15 ? 0.6 : S.env.intensity }));
      $('ctlInt').oninput = e => { S.tweens = S.tweens.filter(t => t.key !== 'intensity'); S.setEnv({ intensity: +e.target.value }, true); };
      logChange('ctlInt', () => S.ev('INFO', 'Environment: intensity ' + Math.round(S.env.intensity * 100) + '%'));
      seg('segNight', v => S.setEnv({ night: v === '1' }));
      seg('segWind', v => S.setEnv({ wind: v === '1' }));
      $('ctlMarks').onchange = e => S.setEnv({ marks: e.target.value });
      $('ctlWidth').oninput = e => S.setEnv({ laneW: +e.target.value }, true);
      logChange('ctlWidth', () => S.ev('INFO', 'Environment: lane width ' + S.env.laneW.toFixed(1) + ' m'));
      $('ctlCurv').oninput = e => { $('oCurv').textContent = this.curvTxt(+e.target.value); };
      $('ctlCurv').onchange = e => S.setEnv({ curv: +e.target.value });

      // driver
      $('btnLms').onclick = () => { L.Audio.ensure(); S.ctrl.pressEnable(); };
      $('ctlSpeed').oninput = e => { S.ego.target = +e.target.value; };
      $('ctlSteer').oninput = e => { S.driver.steer = +e.target.value / 100; this.steerFromKeys = false; };
      seg('segSig', v => S.setSignal(+v));
      $('btnLaneL').onclick = () => S.changeLane(-1);
      $('btnLaneR').onclick = () => S.changeLane(1);
      seg('segAttn', v => S.setAttention(v));
      seg('segDrift', v => { S.driver.driftDir = +v; });

      // faults
      $('ctlDirt').oninput = e => { S.tweens = S.tweens.filter(t => t.key !== 'dirt'); S.setEnv({ dirt: +e.target.value }, true); };
      logChange('ctlDirt', () => S.ev('INFO', 'Environment: camera contamination ' + Math.round(S.env.dirt) + '%'));
      [['tgCam', 'camFail'], ['tgVse', 'vseFail'], ['tgLdw', 'ldwFail'], ['tgMis', 'mismatch']].forEach(([id, k]) => {
        $(id).onclick = () => { const p = {}; p[k] = !S.env[k]; S.setEnv(p); this.syncControls(true); };
      });
      $('injForged').onclick = () => S.inject('forged');
      $('injStale').onclick = () => S.inject('stale');
      $('injCorrupt').onclick = () => S.inject('corrupt');
      $('ctlX').oninput = e => { C.ldwX = +e.target.value; };
      $('ctlResume').oninput = e => { C.resumeDelay = +e.target.value; $('oResume').textContent = C.resumeDelay.toFixed(1) + ' s'; };
      $('ctlResume').onchange = () => S.ev('INFO', 'Setting: LMS re-enables ' + C.resumeDelay.toFixed(1) + ' s after an override');
      $('ctlCap').onchange = e => { C.captureMs = +e.target.value; };

      // scenario runner
      $('btnPlay').onclick = () => app.togglePause();
      $('btnNext').onclick = () => { if (S.runner && !S.runner.done) S.runner.fire(); };
      $('btnRestart').onclick = () => app.startScenario(app.scenario);
      $('ctlMul').onchange = e => { app.mul = +e.target.value; };

      // log
      $('btnSteerRows').onclick = () => { this.showSteer = !this.showSteer; $('btnSteerRows').setAttribute('aria-pressed', String(this.showSteer)); S.logDirty = true; };
      $('btnCopy').onclick = () => {
        const head = 'time_s,lane,lane_offset_m,speed_mph,lms_mode,lms_cmd_deg,out_of_lane,image_quality,road_curvature,weather,traffic\n';
        const csv = head + S.tele.map(r => [r[0].toFixed(2), r[1], r[2].toFixed(3), r[3].toFixed(1), r[4], r[5].toFixed(2), r[6], r[7].toFixed(0), r[8].toFixed(5), r[9], r[10]].join(',')).join('\n');
        const note = m => { $('copyNote').textContent = m; };
        try { navigator.clipboard.writeText(csv).then(() => note('Copied ' + S.tele.length + ' telemetry samples as CSV.'), () => note('Clipboard is blocked in this view. The log above stays on the page.')); }
        catch (e) { note('Clipboard is blocked in this view.'); }
      };

      // camera zoom
      const cv = $('scene');
      cv.addEventListener('wheel', e => { if (!this.world || this.view === 'fpv') return; e.preventDefault(); this.world.zoom(Math.sign(e.deltaY)); }, { passive: false });

      // keyboard
      const isForm = el => el && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'range') || el.isContentEditable);
      window.addEventListener('keydown', e => {
        L.Audio.ensure();
        if (e.ctrlKey || e.metaKey || e.altKey || isForm(e.target)) return;
        const k = e.key.toLowerCase();
        const onRange = e.target && e.target.type === 'range';
        const arrows = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
        const held = { w: 'up', s: 'down', a: 'left', d: 'right' };
        if (k === 't' && !e.repeat) { this.toggleDriver(); e.preventDefault(); return; }
        const driving = held[k] || (arrows[k] && !onRange) || 'qezxlf'.indexOf(k) >= 0 && k.length === 1;
        if (driving && S.driverMode !== 'self') {
          if (!e.repeat) this.prompt('Automatic driver', 'The automatic driver is driving. Press T or Take control to drive yourself.', 3, 'auto');
          e.preventDefault(); return;
        }
        if (held[k]) { this.keys.add(held[k]); e.preventDefault(); return; }
        if (arrows[k] && !onRange) { this.keys.add(arrows[k]); e.preventDefault(); return; }
        if (e.repeat) return;
        if (k === 'q') S.setSignal(S.signal === -1 ? 0 : -1);
        else if (k === 'e') S.setSignal(S.signal === 1 ? 0 : 1);
        else if (k === 'z') S.changeLane(-1);
        else if (k === 'x') S.changeLane(1);
        else if (k === 'l') S.ctrl.pressEnable();
        else if (k === 'f') S.setAttention(S.driver.attention === 'distracted' ? 'attentive' : 'distracted');
        else if (k === 'v') app.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]);
        else if (k === '1' || k === '2' || k === '3') app.setView(VIEWS[+k - 1]);
        else if (k === ' ' && e.target.tagName !== 'BUTTON') { app.togglePause(); }
        else return;
        e.preventDefault();
        this.syncControls(true);
      });
      window.addEventListener('keyup', e => {
        const k = e.key.toLowerCase();
        const map = { w: 'up', s: 'down', a: 'left', d: 'right', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
        if (map[k]) this.keys.delete(map[k]);
      });
      window.addEventListener('blur', () => this.keys.clear());
      document.addEventListener('pointerdown', () => L.Audio.ensure(), { once: true });
    }

    syncView(v) {
      this.view = v;
      $('cockpit').classList.toggle('on', v === 'fpv');
      $('viewport').classList.toggle('fpv', v === 'fpv');
      [...$('viewSeg').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      this.syncKeyHint();
    }

    syncPlay() {
      $('btnPlay').textContent = this.app.running ? 'Pause' : 'Play';
      $('pausedBadge').hidden = this.app.running;
    }

    /* ---------- per-frame input ---------- */
    tick(dt) {
      const S = this.sim, k = this.keys;
      if (this.promptUntil && performance.now() > this.promptUntil) this.hidePrompt();
      if (S.driverMode !== 'self') { if (k.size) k.clear(); this.steerFromKeys = false; return; }
      if (k.has('up')) S.ego.target = clamp(S.ego.target + 18 * dt, 0, 100);
      if (k.has('down')) S.ego.target = clamp(S.ego.target - 24 * dt, 0, 100);
      const l = k.has('left'), r = k.has('right');
      if (l !== r) {
        const dir = r ? 1 : -1;
        if (S.driver.steer * dir < 0) S.driver.steer *= 0.7;
        S.driver.steer = clamp(S.driver.steer + dir * 1.5 * dt, -1, 1);
        this.steerFromKeys = true;
      } else if (this.steerFromKeys) {
        const st = S.driver.steer, step = 2.6 * dt;
        S.driver.steer = Math.abs(st) <= step ? 0 : st - Math.sign(st) * step;
        if (S.driver.steer === 0) this.steerFromKeys = false;
      }
    }

    /* ---------- rendering ---------- */
    curvTxt(c) { return Math.abs(c) < 1e-5 ? 'Straight' : Math.round(1 / Math.abs(c)) + ' m ' + (c > 0 ? 'right' : 'left'); }

    setSys(id, cls, txt) { const e = $(id); e.className = 'sys ' + cls; e.lastElementChild.textContent = txt; }

    render() {
      const S = this.sim, ctrl = S.ctrl, eg = S.ego, env = S.env, dr = S.driver;
      const m = STATE[ctrl.mode];
      $('stateChip').className = 'chip ' + m[0]; $('stateChip').textContent = m[1];
      const lane = ctrl.homeLane == null ? S.laneOf(eg.d) : ctrl.homeLane;
      let sub = 'Driver in control';
      if (ctrl.mode === 'ACTIVE') sub = { centering: 'Centering in lane ' + (lane + 1), warning: 'Lane departure warning', keeping: ctrl.lksEdge ? 'Keeping the car off the road edge' : 'Steering back into the lane', idle: '' }[ctrl.sub] || '';
      else if (ctrl.mode === 'SUSPENDED') sub = 'Paused while the turn signal is on';
      else if (ctrl.mode === 'FAULT') sub = ctrl.reasons[0] || 'Fault';
      else if (ctrl.mode === 'OVERRIDE') sub = ctrl.resumeT > 0 ? 'Resuming in ' + Math.max(0, C.resumeDelay - ctrl.resumeT).toFixed(1) + ' s' : 'Driver steering. Resumes ' + C.resumeDelay.toFixed(1) + ' s after release';
      else if (ctrl.mode === 'TAKEOVER') sub = 'Steering limit reached';
      $('stateSub').textContent = sub; $('stateSub').title = sub;

      $('spdNum').textContent = Math.round(eg.speed);
      $('spdBand').style.left = C.vMin + '%'; $('spdBand').style.width = (C.vMax - C.vMin) + '%';
      $('spdNeedle').style.left = clamp(eg.speed, 0, 100) + '%';
      const inR = eg.speed > C.vMin && eg.speed < C.vMax;
      $('spdLbl').textContent = inR ? 'Inside the LMS range, 35 to 85 mph' : 'Outside the LMS range, 35 to 85 mph';

      const act = ctrl.mode === 'ACTIVE', susp = ctrl.mode === 'SUSPENDED';
      const idle = susp ? ['info', 'PAUSED'] : ['', 'OFF'];
      if (env.ldwFail) { this.setSys('sysLdw', 'bad', 'FAULT'); this.setSys('sysLks', 'bad', 'UNAVAILABLE'); }
      else {
        this.setSys('sysLdw', act ? (ctrl.ldw ? 'warn' : 'on') : idle[0], act ? (ctrl.ldw ? 'WARNING' : 'MONITORING') : idle[1]);
        this.setSys('sysLks', act ? (ctrl.lks ? 'warn' : 'on') : idle[0], act ? (ctrl.lks ? (ctrl.lksEdge ? 'EDGE ASSIST' : 'STEERING') : 'READY') : idle[1]);
      }
      this.setSys('sysLcs', act ? (ctrl.lks ? 'info' : ctrl.limited ? 'warn' : 'on') : idle[0], act ? (ctrl.lks ? 'SUSPENDED' : ctrl.limited ? 'AT LIMIT' : 'CENTERING') : idle[1]);

      // dashboard notices (SRS Fig 19: shown for 5 s)
      const list = [];
      if (ctrl.ldw && act) { const out = S.t - ctrl.ldwStart; list.push(['bad sticky', 'LANE DEPARTURE ' + (ctrl.outSide < 0 ? 'LEFT' : 'RIGHT') + (out >= C.ldwX ? '. Out of lane for ' + out.toFixed(1) + ' s' : '')]); }
      S.notices.slice().reverse().forEach(n => { if (list.length < 3) list.push([n.sev, n.text]); });
      if (!list.length) list.push(['idle', act ? 'No alerts' : 'Dashboard notices appear here']);
      const key = JSON.stringify(list);
      if (key !== this.lastNoticeKey) { this.lastNoticeKey = key; $('notices').innerHTML = list.map(x => '<div class="n ' + x[0] + '">' + esc(x[1]) + '</div>').join(''); }

      // lane position, with the customer's abstract labels
      const W = env.laneW, span = W + 1.2, y = ctrl.yTrue, lim = ctrl.laneLim();
      $('laneNo').textContent = lane + 1;
      $('posCar').style.left = (50 + (y / span) * 100 - (C.carW / span) * 50) + '%';
      $('posCar').style.width = (C.carW / span) * 100 + '%';
      $('posCar').className = 'car' + (Math.abs(y) > lim ? ' out' : '');
      const el = 50 - (W / 2 / span) * 100;
      $('edgeL').style.left = el + '%'; $('edgeR').style.left = (100 - el) + '%';
      $('posPred').style.left = clamp(50 + (ctrl.predY / span) * 100, 0, 100) + '%';
      const ay = Math.abs(y), side = y < 0 ? 'left' : 'right';
      const abs = ay < 0.15 ? 'Center' : ay < 0.5 ? 'Slightly ' + side : ay < lim ? 'Extreme ' + side : 'Out of lane, ' + side;
      $('posTxt').textContent = abs + ' · ' + (y >= 0 ? 'R ' : 'L ') + Math.round(ay * 100) + ' cm';
      const bt = S.boundaryTypes(lane);
      $('bL').textContent = 'Left: ' + bt.left; $('bL').className = bt.left === 'road edge' ? 'edge' : '';
      $('bR').textContent = 'Right: ' + bt.right; $('bR').className = bt.right === 'road edge' ? 'edge' : '';

      const q = Math.floor(ctrl.q);
      $('qTxt').textContent = q + ' / 100';
      $('qFill').style.width = q + '%'; $('qFill').className = 'fill' + (q < C.qMin ? ' low' : '');
      $('qTick').style.left = C.qMin + '%';
      $('capTxt').textContent = 'Capture every ' + C.captureMs + ' ms';
      $('occTxt').textContent = ctrl.occl > 8 ? (ctrl.occlBy === 'lead' ? 'Car ahead blocks view' : 'Car alongside') : '';

      const tq = Math.abs(dr.steer) * C.torqueNm, cmdDeg = (act ? ctrl.kCmd : 0) * C.degPerK;
      let au;
      if (act) au = ctrl.lks ? 'LMS (LKS)' : (Math.abs(dr.steer) > 0.05 ? 'Shared' : 'LMS (LCS)');
      else if (S.driverMode === 'self') au = dr.maneuver ? 'You, lane change' : dr.attention === 'distracted' ? 'Nobody, distracted' : 'You';
      else au = dr.handsOn ? (dr.maneuver ? 'Auto driver, lane change' : 'Automatic driver') : 'Nobody, distracted';
      $('auth').textContent = au;
      $('torq').textContent = tq.toFixed(1) + ' Nm';
      $('torq').style.color = tq >= C.torqueSig ? 'var(--c-warn)' : '';
      $('cmdTxt').textContent = (cmdDeg >= 0 ? '+' : '') + cmdDeg.toFixed(1) + '°';
      const hap = ctrl.ldw && act;
      $('icWheel').className = 'ic' + (hap ? ' on shake' : '');
      $('icSeat').className = 'ic' + (hap ? ' on shake' : '');
      $('icSpk').className = 'ic' + (performance.now() - L.Audio.lastAt < 450 ? ' on' : '');
      $('spkTxt').textContent = L.Audio.on ? 'Speaker' : 'Muted';
      $('icL').className = 'ic sig' + (S.signal < 0 ? ' on' : '');
      $('icR').className = 'ic sig' + (S.signal > 0 ? ' on' : '');
      $('wheelG').style.transform = 'rotate(' + (dr.steer * 40 + cmdDeg * 6 + dr.dmFb * C.degPerK * 6) + 'deg)';
      $('btnLms').textContent = act || susp || ctrl.mode === 'OVERRIDE' ? 'Disable LMS' : 'Enable LMS';
      $('flash').className = 'flash' + (S.t - S.flash < 0.5 && S.flash > 0 ? ' hit' : hap ? ' on' : '');
      $('clock').textContent = L.fmtT(S.t);

      if (this.envDirty) { this.envDirty = false; this.renderChips(); this.syncControls(true); }
      else this.syncControls(false);
      this.renderSteps();
      this.renderLog();
      this.renderCockpit();
    }

    /* ---------- first person cockpit: wheel, cluster, center screen, windshield HUD ---------- */
    renderCockpit() {
      if (this.view !== 'fpv') return;
      const S = this.sim, ctrl = S.ctrl, eg = S.ego, dr = S.driver, env = S.env;
      const mode = ctrl.mode, act = mode === 'ACTIVE';
      if (mode !== this.lastMode) { this.lastMode = mode; this.modeT = S.t; }
      const col = act ? (ctrl.lks ? '#F5B642' : '#3DDC97') : mode === 'FAULT' || mode === 'TAKEOVER' ? '#FF6B73' : mode === 'SUSPENDED' ? '#74A7FF' : mode === 'OVERRIDE' ? '#F5B642' : '#6c7a84';

      // steering wheel: turns with every steering input, shakes during a departure warning
      const deg = clamp((eg.steerK || 0) * C.degPerK * 4 + dr.steer * 60, -220, 220);
      const hap = ctrl.ldw && act;
      const jx = hap ? (Math.random() - 0.5) * 3.2 : 0, jy = hap ? (Math.random() - 0.5) * 3.2 : 0;
      $('ckWheel').setAttribute('transform', 'translate(' + jx.toFixed(2) + ' ' + jy.toFixed(2) + ') rotate(' + deg.toFixed(1) + ')');
      const ring = $('ckRing');
      ring.setAttribute('stroke', col);
      ring.setAttribute('opacity', act ? (ctrl.lks ? '0.95' : '0.55') : mode === 'OVERRIDE' ? '0.35' : '0');
      $('ckHub').style.fill = col;

      // cluster behind the wheel
      $('ckSpeed').textContent = Math.round(eg.speed);
      const st = { OFF: 'LMS OFF', ACTIVE: ctrl.lks ? 'LKS STEERING' : ctrl.ldw ? 'DEPARTURE' : 'LMS ACTIVE', SUSPENDED: 'LMS PAUSED', FAULT: 'LMS FAULT', OVERRIDE: 'OVERRIDE', TAKEOVER: 'TAKE CONTROL' }[mode];
      $('ckState').textContent = st; $('ckState').style.color = ctrl.ldw && act ? '#FF6B73' : col;
      $('ckSigL').className = 'ck-sig' + (S.signal < 0 ? ' on' : '');
      $('ckSigR').className = 'ck-sig' + (S.signal > 0 ? ' on' : '');

      // center screen
      $('csChip').textContent = STATE[mode][1]; $('csChip').style.color = col;
      const lamp = (id, cls) => { $(id).className = cls; };
      const susp = mode === 'SUSPENDED';
      if (env.ldwFail) { lamp('csLdw', 'bad'); lamp('csLks', 'bad'); }
      else { lamp('csLdw', act ? (ctrl.ldw ? 'warn' : 'on') : susp ? 'info' : ''); lamp('csLks', act ? (ctrl.lks ? 'warn' : 'on') : susp ? 'info' : ''); }
      lamp('csLcs', act ? (ctrl.lks ? 'info' : ctrl.limited ? 'warn' : 'on') : susp ? 'info' : '');

      const lane = ctrl.homeLane == null ? S.laneOf(eg.d) : ctrl.homeLane;
      const bt = S.boundaryTypes(lane), detected = ctrl.faults().length === 0;
      const lineStyle = (el, type, out) => {
        const c = !detected ? '#3a464f' : out ? '#FF6B73' : act ? '#3DDC97' : '#8a96a0';
        el.setAttribute('stroke', c);
        el.setAttribute('stroke-width', type === 'road edge' ? '3.6' : '2.6');
        el.setAttribute('stroke-dasharray', !detected ? '2 4' : type === 'dashed' ? '7 6' : 'none');
      };
      const outL = act && ctrl.ldw && ctrl.outSide < 0, outR = act && ctrl.ldw && ctrl.outSide > 0;
      lineStyle($('csL'), bt.left, outL); lineStyle($('csR'), bt.right, outR);
      const half = env.laneW / 2;
      const cx = 50 + clamp(ctrl.yTrue / half, -1.6, 1.6) * 22.5;
      $('csCar').setAttribute('transform', 'translate(' + cx.toFixed(1) + ' 0)');
      $('csCar').firstElementChild.setAttribute('fill', Math.abs(ctrl.yTrue) > ctrl.laneLim() ? '#FF6B73' : '#74A7FF');
      const px = 50 + clamp(ctrl.predY / half, -2, 2) * 9.8;
      $('csP').setAttribute('d', 'M' + cx.toFixed(1) + ' 56 L' + px.toFixed(1) + ' 20');
      $('csP').setAttribute('stroke', ctrl.predOut && act ? '#F5B642' : '#74A7FF');

      let msg = 'No alerts', sev = '';
      if (ctrl.ldw && act) { msg = 'Lane departure ' + (ctrl.outSide < 0 ? 'left' : 'right') + (ctrl.lks ? '. LKS steering back.' : '.'); sev = 'bad'; }
      else if (S.notices.length) { const n = S.notices[S.notices.length - 1]; msg = n.text; sev = n.sev; }
      $('csMsg').textContent = msg; $('csMsg').className = 'cs-msg ' + sev;
      $('csWv').className = 'cs-ic' + (hap ? ' on shake' : '');
      $('csSeat').className = 'cs-ic' + (hap ? ' on shake' : '');
      $('csSpk').className = 'cs-ic' + (performance.now() - L.Audio.lastAt < 450 ? ' on' : '');
      $('csLaneNo').textContent = lane + 1;
      $('csQ').textContent = Math.floor(ctrl.q);

      // windshield head-up display for the events that matter most
      let hud = null;
      const since = S.t - (this.modeT || 0);
      if (mode === 'TAKEOVER') hud = ['red flash', 'TAKE CONTROL', 'Steering limit reached'];
      else if (ctrl.ldw && act) hud = ['red', (ctrl.outSide < 0 ? '◀ ' : '') + 'LANE DEPARTURE' + (ctrl.outSide > 0 ? ' ▶' : ''), ctrl.lks ? (ctrl.lksEdge ? 'Road edge. LKS steering back' : 'LKS steering back') : 'Steer back into your lane'];
      else if (mode === 'OVERRIDE') hud = ['amber', 'DRIVER OVERRIDE', ctrl.resumeT > 0 ? 'LMS resumes in ' + Math.max(0, C.resumeDelay - ctrl.resumeT).toFixed(1) + ' s' : 'LMS resumes ' + C.resumeDelay.toFixed(1) + ' s after you let go'];
      else if (mode === 'SUSPENDED') hud = ['blue', 'LMS PAUSED', (S.signal < 0 ? 'Left' : 'Right') + ' turn signal on'];
      else if (mode === 'FAULT' && since < 6) hud = ['red', 'LMS UNAVAILABLE', ctrl.reasons[0] || ''];
      else if (act && since < 2.5 && S.t > 0.5) hud = ['green', 'LMS ACTIVE', 'Lane ' + (lane + 1)];
      else if (ctrl.fatigue && S.t - ctrl.lastFatigue < 8) hud = ['amber', 'TAKE A BREAK?', 'Repeated lane departures'];
      const hudEl = $('ckHud');
      if (hud) { hudEl.className = 'ck-hud on ' + hud[0]; $('ckHudT').textContent = hud[1]; $('ckHudS').textContent = hud[2]; }
      else hudEl.className = 'ck-hud';
    }

    renderChips() {
      const e = this.sim.env, R = this.sim.road_();
      const chips = [R.short, L.TRAFFIC[e.traffic].name, e.weather === 'clear' ? 'Clear' : L.WEATHER[e.weather].name + ' ' + Math.round(e.intensity * 100) + '%', e.night ? 'Night' : 'Day'];
      if (e.wind) chips.push('Gusty wind');
      if (e.marks !== 'clear') chips.push('Markings: ' + L.MARKS[e.marks].toLowerCase());
      if (Math.abs(e.curv) > 1e-5) chips.push('Curve ' + this.curvTxt(e.curv));
      $('envChips').innerHTML = chips.map(c => '<span class="envchip">' + esc(c) + '</span>').join('');
    }

    syncControls(force) {
      const S = this.sim, e = S.env;
      const set = (id, v) => { const el = $(id); if (force || document.activeElement !== el) el.value = v; };
      set('ctlRoad', e.road); set('ctlMarks', e.marks);
      set('ctlInt', e.intensity); set('ctlWidth', e.laneW); set('ctlDirt', Math.round(e.dirt));
      if (force) set('ctlCurv', e.curv);
      set('ctlSpeed', Math.round(S.ego.target)); set('ctlSteer', Math.round(S.driver.steer * 100));
      set('ctlX', C.ldwX); set('ctlCap', C.captureMs); set('ctlResume', C.resumeDelay);
      $('oResume').textContent = C.resumeDelay.toFixed(1) + ' s';
      $('oInt').textContent = Math.round(e.intensity * 100) + '%';
      $('oWidth').textContent = e.laneW.toFixed(1) + ' m';
      if (document.activeElement !== $('ctlCurv')) $('oCurv').textContent = this.curvTxt(e.curv);
      $('oDirt').textContent = Math.round(e.dirt) + '%';
      $('oSpeed').textContent = Math.round(S.ego.target) + ' mph';
      $('oSteer').textContent = Math.round(S.driver.steer * 100) + '% · ' + (Math.abs(S.driver.steer) * C.torqueNm).toFixed(1) + ' Nm';
      $('oX').textContent = C.ldwX.toFixed(1) + ' s';
      if (!force && !this._segTick) { this._segTick = 0; }
      if (force || (this._segTick = (this._segTick + 1) % 6) === 0) {
        const press = (id, val) => [...$(id).children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(val))));
        press('segTraffic', e.traffic); press('segWeather', e.weather); press('segNight', e.night ? '1' : '0'); press('segWind', e.wind ? '1' : '0');
        press('segSig', S.signal); press('segAttn', S.driver.attention); press('segDrift', S.driver.driftDir);
        [['tgCam', 'camFail'], ['tgVse', 'vseFail'], ['tgLdw', 'ldwFail'], ['tgMis', 'mismatch']].forEach(([id, k]) => { const b = $(id); b.setAttribute('aria-pressed', String(!!e[k])); b.lastElementChild.textContent = e[k] ? 'on' : 'off'; });
        const N = S.lanes(), cur = S.laneOf(S.ego.d);
        const auto = S.driverMode !== 'self';
        $('btnLaneL').disabled = auto || cur <= 0; $('btnLaneR').disabled = auto || cur >= N - 1;
        ['btnLms', 'ctlSpeed', 'ctlSteer'].forEach(id => { $(id).disabled = auto; });
        ['segSig', 'segAttn', 'segDrift'].forEach(id => [...$(id).children].forEach(b => { b.disabled = auto; }));
        $('drvLock').hidden = !auto;
        $('btnCutIn').disabled = e.traffic === 'none' || N < 2;
        this.renderChips();
      }
    }

    renderSteps() {
      const r = this.sim.runner;
      if (!r || !r.dirty) return;
      r.dirty = false;
      const lis = $('steps').children;
      if (!r.sc.steps.length) { $('runCount').textContent = ''; return; }
      for (let i = 0; i < lis.length; i++) lis[i].className = i < r.idx - 1 ? 'done' : i === r.idx - 1 ? 'cur' : i === r.idx ? 'next' : '';
      $('runCount').textContent = r.done ? 'Scenario complete' : 'Step ' + Math.max(1, r.idx) + ' of ' + r.sc.steps.length;
      const cur = lis[Math.max(0, r.idx - 1)], box = $('steps');
      if (cur) { const top = cur.offsetTop, h = cur.offsetHeight; if (top < box.scrollTop || top + h > box.scrollTop + box.clientHeight) box.scrollTop = top - 8; }
    }

    renderLog() {
      const S = this.sim;
      if (!S.logDirty) return;
      S.logDirty = false;
      const rows = S.logRows.filter(r => this.showSteer || r.kind !== 'STEER').slice(-150).reverse();
      $('logBody').innerHTML = rows.map(r => '<tr><td>' + L.fmtT(r.t) + '</td><td>' + r.lane + '</td><td>' + (r.y >= 0 ? 'R ' : 'L ') + Math.round(Math.abs(r.y) * 100) + ' cm</td><td>' + Math.round(r.v) + ' mph</td><td>' + r.mode + '</td><td class="msg"><span class="tag ' + r.kind + '">' + r.kind + '</span>' + esc(r.text) + '</td></tr>').join('');
    }
  }

  L.UI = UI;
})();
