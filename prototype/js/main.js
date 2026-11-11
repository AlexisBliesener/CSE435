/* Start-up and the main loop: physics at a fixed 20 ms step, 3D render every frame. */
(function () {
  'use strict';
  const L = window.LMS;
  const sim = new L.Sim();
  let world = null;
  try {
    if (!window.THREE) throw new Error('three.js did not load');
    world = new L.World3D(document.getElementById('scene'), sim);
  } catch (e) {
    console.error(e);
    document.getElementById('noGl').hidden = false;
  }

  let ui;
  const app = {
    running: true, mul: 1, scenario: 0,
    startScenario(i, instant) {
      this.scenario = i;
      L.startScenario(sim, i);
      ui.onScenario(i);
      const v = L.SCENARIOS[i].view;
      if (v) this.setView(v, instant);
      this.running = true; ui.syncPlay();
    },
    setView(v, instant) {
      if (world) { world.setView(v); if (instant) { world.blend = 1; world.from = null; } }
      ui.syncView(v);
    },
    togglePause() { this.running = !this.running; ui.syncPlay(); }
  };
  ui = new L.UI(sim, world, app);
  sim.on('beep', k => L.Audio.beep(k));
  L.app = app; L.sim = sim; L.world = world;

  const vp = document.getElementById('viewport');
  if (world) {
    const fit = () => world.resize(vp.clientWidth, vp.clientHeight);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(vp);
    else window.addEventListener('resize', fit);
    fit();
  }

  app.startScenario(0, true);

  let last = performance.now(), acc = 0, frame = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ui.tick(dt);
    let dtSim = 0;
    if (app.running) {
      acc += dt * app.mul;
      let n = 0;
      while (acc >= 0.02 && n < 60) { sim.step(0.02); acc -= 0.02; n++; dtSim += 0.02; }
      if (n >= 60) acc = 0;
    }
    if (world) { try { world.render(dt, dtSim); } catch (e) { console.error(e); } }
    if (frame++ % 2 === 0) ui.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
