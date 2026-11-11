/* Speaker system: beeps generated with Web Audio. Sound starts after the first click or key press. */
(function () {
  'use strict';
  const L = window.LMS;
  const A = (L.Audio = { on: true, ctx: null, lastAt: -1e9 });

  A.ensure = function () {
    try {
      if (!A.ctx) { const Ctx = window.AudioContext || window.webkitAudioContext; if (Ctx) A.ctx = new Ctx(); }
      if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    } catch (e) { /* no audio */ }
  };

  function tone(f, d, at, vol, type) {
    const ac = A.ctx;
    if (!ac || !A.on) return;
    try {
      const t0 = ac.currentTime + (at || 0), o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol || 0.07, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) { /* ignore */ }
  }

  A.beep = function (kind) {
    A.lastAt = performance.now();
    if (kind === 'warn') { tone(880, 0.12); tone(880, 0.12, 0.18); }
    else if (kind === 'fault') { [0, 0.25, 0.5].forEach(a => tone(440, 0.18, a, 0.08, 'square')); }
    else if (kind === 'chime') { tone(523, 0.14); tone(784, 0.24, 0.16); }
    else if (kind === 'off') { tone(660, 0.12); tone(440, 0.2, 0.14); }
  };
})();
