// The three alertness tests. Exposes a global `Tests`.
(() => {
  const COLORS = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#eab308' };
  const rand = (a, b) => a + Math.random() * (b - a);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // --- abortable primitives -------------------------------------------------
  const cancels = new Set();
  const abort = () => [...cancels].forEach((c) => c());

  const sleep = (ms) =>
    new Promise((res, rej) => {
      const c = () => { clearTimeout(id); cancels.delete(c); rej(new Error('aborted')); };
      const id = setTimeout(() => { cancels.delete(c); res(); }, ms);
      cancels.add(c);
    });

  // Resolves {t, target} on first pointerdown, or null after `ms`.
  const nextTap = (el, ms) =>
    new Promise((res, rej) => {
      let id;
      const cleanup = () => { clearTimeout(id); el.removeEventListener('pointerdown', h); cancels.delete(c); };
      const h = (e) => { e.preventDefault(); cleanup(); res({ t: performance.now(), target: e.target }); };
      const c = () => { cleanup(); rej(new Error('aborted')); };
      el.addEventListener('pointerdown', h);
      if (ms) id = setTimeout(() => { cleanup(); res(null); }, ms);
      cancels.add(c);
    });

  // Time stamp taken right as the browser is about to paint the new stimulus.
  const frame = () =>
    new Promise((res) => requestAnimationFrame(() => res(performance.now())));

  const setStage = (stage, cls, big = '', small = '') => {
    stage.className = 'stage ' + cls;
    stage.querySelector('.big').textContent = big;
    stage.querySelector('.small').textContent = small;
  };
  const tapStage = (stage) => {
    stage.innerHTML = '<div class="big"></div><div class="small"></div>';
  };

  // --- PVT ------------------------------------------------------------------
  async function pvt(ui) {
    const N = 10, LAPSE = 500;
    const rts = [];
    let falseStarts = 0;
    tapStage(ui.stage);
    for (let i = 0; i < N; ) {
      ui.hud(`Reaction · ${i + 1}/${N}`);
      setStage(ui.stage, 'wait', 'Wait…', 'tap when it turns green');
      if (await nextTap(ui.stage, rand(2000, 7000))) {
        falseStarts++;
        setStage(ui.stage, 'bad', 'Too early!');
        await sleep(900);
        continue;
      }
      setStage(ui.stage, 'go', 'TAP!');
      const t0 = await frame();
      const tap = await nextTap(ui.stage, 2000);
      const rt = tap ? tap.t - t0 : 2000;
      rts.push(rt);
      i++;
      setStage(ui.stage, 'idle', Math.round(rt) + ' ms');
      await sleep(600);
    }
    return { pvt_rt: median(rts), pvt_bad: rts.filter((r) => r > LAPSE).length + falseStarts };
  }

  // --- Go / No-Go -----------------------------------------------------------
  async function gng(ui) {
    const trials = shuffle([...Array(21).fill('go'), ...Array(9).fill('nogo')]);
    const rts = [];
    let omissions = 0, commissions = 0;
    tapStage(ui.stage);
    for (let i = 0; i < trials.length; i++) {
      ui.hud(`Go / No-Go · ${i + 1}/${trials.length}`);
      setStage(ui.stage, 'idle', '');
      await sleep(rand(500, 1200));
      const isGo = trials[i] === 'go';
      setStage(ui.stage, isGo ? 'go' : 'nogo', isGo ? 'TAP' : "DON'T");
      const t0 = await frame();
      const tap = await nextTap(ui.stage, 800);
      if (isGo) tap ? rts.push(tap.t - t0) : omissions++;
      else if (tap) commissions++;
    }
    return { gng_rt: median(rts) ?? 800, gng_err: omissions + commissions };
  }

  // --- Stroop ---------------------------------------------------------------
  async function stroop(ui) {
    const names = Object.keys(COLORS);
    const N = 20;
    ui.stage.className = 'stage idle';
    ui.stage.innerHTML =
      '<div class="word"></div><div class="btns">' +
      names.map((n) => `<button data-color="${n}">${n}</button>`).join('') +
      '</div>';
    const word = ui.stage.querySelector('.word');
    const btns = ui.stage.querySelector('.btns');
    const rts = [];
    let errors = 0;
    for (let i = 0; i < N; i++) {
      ui.hud(`Stroop · ${i + 1}/${N}`);
      const w = names[Math.floor(Math.random() * 4)];
      const ink = i % 2 === 0 ? w : names.filter((n) => n !== w)[Math.floor(Math.random() * 3)];
      word.textContent = '';
      await sleep(400);
      word.textContent = w.toUpperCase();
      word.style.color = COLORS[ink];
      const t0 = await frame();
      const tap = await nextTap(btns, 3000);
      const hit = tap && tap.target.dataset && tap.target.dataset.color === ink;
      if (hit) rts.push(tap.t - t0);
      else errors++;
    }
    return { stroop_rt: median(rts) ?? 3000, stroop_err: errors };
  }

  // --- Flanker (distractibility) ---------------------------------------------
  async function flanker(ui) {
    const N = 24;
    ui.stage.className = 'stage idle';
    ui.stage.innerHTML =
      '<div class="word flank"></div><div class="btns"><button data-choice="L">←</button><button data-choice="R">→</button></div>';
    const word = ui.stage.querySelector('.word');
    const btns = ui.stage.querySelector('.btns');
    const rts = [];
    let errors = 0;
    for (let i = 0; i < N; i++) {
      ui.hud(`Flanker · ${i + 1}/${N}`);
      const target = Math.random() < 0.5 ? 'L' : 'R';
      const other = target === 'L' ? 'R' : 'L';
      const ch = (d) => (d === 'L' ? '←' : '→');
      const flank = i % 2 === 0 ? target : other; // half congruent, half incongruent
      word.textContent = '';
      await sleep(rand(400, 800));
      word.textContent = ch(flank) + ch(flank) + ch(target) + ch(flank) + ch(flank);
      const t0 = await frame();
      const tap = await nextTap(btns, 2500);
      if (tap && tap.target.dataset && tap.target.dataset.choice === target) rts.push(tap.t - t0);
      else errors++;
    }
    return { flanker_rt: median(rts) ?? 2500, flanker_err: errors };
  }

  // --- Task switching (multitasking) -------------------------------------------
  async function taskSwitch(ui) {
    const N = 24;
    const digits = [1, 2, 3, 4, 6, 7, 8, 9];
    ui.stage.className = 'stage idle';
    ui.stage.innerHTML =
      '<div class="cue"></div><div class="word"></div><div class="btns"><button data-choice="a"></button><button data-choice="b"></button></div>';
    const cue = ui.stage.querySelector('.cue');
    const word = ui.stage.querySelector('.word');
    const btns = ui.stage.querySelector('.btns');
    const [bA, bB] = btns.querySelectorAll('button');
    const rts = [];
    let errors = 0;
    let rule = Math.random() < 0.5 ? 'parity' : 'size';
    for (let i = 0; i < N; i++) {
      ui.hud(`Task switch · ${i + 1}/${N}`);
      if (i > 0 && Math.random() < 0.5) rule = rule === 'parity' ? 'size' : 'parity'; // ~half the trials switch
      const n = digits[Math.floor(Math.random() * digits.length)];
      const answer = rule === 'parity' ? (n % 2 ? 'a' : 'b') : n < 5 ? 'a' : 'b';
      word.textContent = '';
      cue.textContent = '';
      await sleep(400);
      cue.textContent = rule === 'parity' ? 'ODD or EVEN?' : 'LOW (1–4) or HIGH (6–9)?';
      bA.textContent = rule === 'parity' ? 'odd' : 'low';
      bB.textContent = rule === 'parity' ? 'even' : 'high';
      word.textContent = n;
      const t0 = await frame();
      const tap = await nextTap(btns, 3000);
      if (tap && tap.target.dataset && tap.target.dataset.choice === answer) rts.push(tap.t - t0);
      else errors++;
    }
    return { switch_rt: median(rts) ?? 3000, switch_err: errors };
  }

  const list = [
    { id: 'pvt', name: 'Reaction', run: pvt,
      text: 'The screen starts blue. When it turns green, tap as fast as you can. Don’t tap early.' },
    { id: 'gng', name: 'Go / No-Go', run: gng,
      text: 'Tap when you see green TAP. Do NOT tap when you see red DON’T.' },
    { id: 'stroop', name: 'Stroop', run: stroop,
      text: 'A color word appears. Tap the button for the INK color, ignoring what the word says.' },
    { id: 'flanker', name: 'Flanker', run: flanker,
      text: 'Five arrows appear. Tap the direction the MIDDLE arrow points, ignoring the others.' },
    { id: 'switch', name: 'Task switch', run: taskSwitch,
      text: 'A number appears with a question that keeps changing: odd/even, or low/high. Answer the current question.' },
  ];

  // Shows intro, waits for a tap on Start, then runs the test.
  async function runTest(test, ui) {
    ui.hud(test.name);
    ui.stage.className = 'stage idle';
    ui.stage.innerHTML =
      `<div class="intro"><h2>${test.name}</h2><p>${test.text}</p><button class="primary" id="startTest">Start</button></div>`;
    await nextTap(ui.stage.querySelector('#startTest'));
    return test.run(ui);
  }

  window.Tests = { list, runTest, abort, median };
})();
