// UI, storage and scoring.
(() => {
  const $ = (s) => document.querySelector(s);
  const CAL_N = 5;
  const KEY = 'attn.v1';

  // rel: scale floor is a fraction of the baseline median; otherwise a floor of 1 (counts)
  const METRICS = [
    { k: 'pvt_rt', label: 'Reaction time', unit: 'ms', rel: true },
    { k: 'pvt_bad', label: 'Lapses + false starts', unit: '', rel: false },
    { k: 'gng_rt', label: 'Go/No-Go time', unit: 'ms', rel: true },
    { k: 'gng_err', label: 'Go/No-Go errors', unit: '', rel: false },
    { k: 'stroop_rt', label: 'Stroop time', unit: 'ms', rel: true },
    { k: 'stroop_err', label: 'Stroop errors', unit: '', rel: false },
  ];

  // --- storage (falls back to memory if localStorage is blocked) ------------
  let mem = { sessions: [] };
  let storageOK = true;
  const load = () => {
    try {
      const r = localStorage.getItem(KEY);
      if (r) return (mem = JSON.parse(r));
    } catch { storageOK = false; }
    return mem;
  };
  const save = (d) => {
    mem = d;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { storageOK = false; }
  };

  // --- scoring ----------------------------------------------------------------
  const device = () => (matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse');

  function baselineFor(dev, sessions) {
    const cal = sessions.filter((s) => s.device === dev && s.calibration);
    if (cal.length < CAL_N) return null;
    const base = {};
    for (const m of METRICS) {
      const vals = cal.map((s) => s.metrics[m.k]);
      const med = Tests.median(vals);
      base[m.k] = { med, mad: Tests.median(vals.map((v) => Math.abs(v - med))) };
    }
    return base;
  }
  const zScore = (m, v, b) => (v - b.med) / Math.max(1.4826 * b.mad, m.rel ? 0.05 * b.med : 1);
  function composite(metrics, base) {
    const zs = METRICS.map((m) => Math.max(-2, Math.min(4, zScore(m, metrics[m.k], base[m.k]))));
    return zs.reduce((a, b) => a + b, 0) / zs.length;
  }
  const band = (c) =>
    c < 1 ? { cls: 'sharp', text: 'Sharp' } : c < 2 ? { cls: 'off', text: 'Slightly off' } : { cls: 'impaired', text: 'Impaired' };

  // --- views --------------------------------------------------------------------
  const views = ['home', 'test', 'result', 'history'];
  const show = (id) => views.forEach((v) => ($('#' + v).hidden = v !== id));
  const fmt = (m, v) => (v == null ? '–' : m.unit ? Math.round(v) + ' ' + m.unit : String(Math.round(v * 10) / 10));

  function renderHome(notice = '') {
    const d = load();
    const dev = device();
    const calDone = d.sessions.filter((s) => s.device === dev && s.calibration).length;
    const last = d.sessions[d.sessions.length - 1];
    let html = `<div>Device: <b>${dev}</b></div>`;
    if (calDone < CAL_N) {
      html += `<div>Calibration: <b>${calDone}/${CAL_N}</b></div>
        <div class="muted">Do these sessions when you're well rested, ideally on different days. Results are compared to this baseline.</div>`;
    } else {
      html += `<div>Baseline: <b>set</b> (${CAL_N} sessions)</div>`;
    }
    if (last && last.composite != null) {
      const b = band(last.composite);
      html += `<div style="margin-top:8px">Last: <span class="badge ${b.cls}">${b.text}</span> <span class="muted">${new Date(last.ts).toLocaleString()}</span></div>`;
    }
    $('#status').innerHTML = html;
    $('#notice').textContent = notice || (storageOK ? '' : 'Storage is blocked in this browser, so results will not be saved after you close the page.');
    show('home');
    renderAuth();
  }

  // --- cloud sync (optional; see sync.js) -----------------------------------
  let syncMsg = '';
  function renderAuth() {
    const el = $('#auth');
    el.textContent = '';
    if (!window.Sync) { el.textContent = 'Cloud sync unavailable (using this device only).'; return; }
    const name = Sync.name();
    if (name) {
      el.append(`Syncing as "${name}"${syncMsg ? ' · ' + syncMsg : ''} `);
      const btn = document.createElement('button');
      btn.textContent = 'Change name';
      btn.onclick = () => { Sync.setName(null); syncMsg = ''; renderAuth(); };
      el.append(btn);
    } else {
      // No name yet: ask for one. Anyone who types the same name shares the same data.
      const input = document.createElement('input');
      input.placeholder = 'Your name (to sync devices)';
      input.maxLength = 32;
      input.autocapitalize = 'none';
      const btn = document.createElement('button');
      btn.textContent = 'Sync';
      btn.onclick = () => {
        try { Sync.setName(input.value); } catch (e) { $('#notice').textContent = e.message; return; }
        syncNow();
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
      el.append(input, ' ', btn);
    }
  }

  // Merge local and remote sessions (union by timestamp) and push anything the cloud is missing.
  async function syncNow() {
    if (!window.Sync || !Sync.name()) return renderAuth();
    try {
      syncMsg = 'syncing…';
      renderAuth();
      const remote = await Sync.fetchAll();
      const d = load();
      const have = new Set(remote.map((s) => s.ts));
      const local = d.sessions.filter((s) => !have.has(s.ts));
      await Promise.all(local.map((s) => Sync.push(s)));
      d.sessions = [...remote, ...local].sort((a, b) => a.ts - b.ts);
      save(d);
      syncMsg = 'synced';
    } catch (e) {
      syncMsg = 'sync failed (' + (e.code || e.message) + ')';
    }
    if (!$('#home').hidden) renderHome();
    else renderAuth();
  }

  function renderResult(session, base) {
    let html;
    if (session.calibration) {
      const n = load().sessions.filter((s) => s.device === session.device && s.calibration).length;
      html = `<h2>Calibration ${n}/${CAL_N} saved</h2>
        <p class="muted">${n < CAL_N ? 'Keep going while rested.' : 'Baseline is now set. Future checks are compared to it.'}</p>`;
    } else {
      const b = band(session.composite);
      html = `<h2><span class="badge ${b.cls}">${b.text}</span></h2>
        <p class="muted">Score: ${session.composite.toFixed(2)} SD vs. your baseline (&lt;1 sharp, 1–2 slightly off, &gt;2 impaired)</p>`;
    }
    html += '<div class="card"><table><tr><th>Metric</th><th>Now</th>' + (base ? '<th>Baseline</th>' : '') + '</tr>';
    for (const m of METRICS) {
      html += `<tr><td>${m.label}</td><td>${fmt(m, session.metrics[m.k])}</td>${base ? `<td>${fmt(m, base[m.k].med)}</td>` : ''}</tr>`;
    }
    $('#resultBody').innerHTML = html + '</table></div>';
    show('result');
  }

  function renderHistory() {
    const { sessions } = load();
    const pts = sessions.filter((s) => s.composite != null).slice(-30);
    if (!pts.length) {
      $('#chart').innerHTML = '<span class="muted">No scored sessions yet. Finish calibration first.</span>';
    } else {
      const W = 600, H = 200, P = 24, lo = -2, hi = 4;
      const y = (z) => H - P - ((Math.max(lo, Math.min(hi, z)) - lo) / (hi - lo)) * (H - 2 * P);
      const x = (i) => P + (pts.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
      const line = (z, c) => `<line x1="${P}" x2="${W - P}" y1="${y(z)}" y2="${y(z)}" stroke="${c}" stroke-dasharray="4 4" opacity=".6"/>`;
      $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Composite score history">
        ${line(0, '#94a3b8')}${line(1, '#eab308')}${line(2, '#ef4444')}
        <polyline fill="none" stroke="#38bdf8" stroke-width="2" points="${pts.map((p, i) => `${x(i)},${y(p.composite)}`).join(' ')}"/>
        ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.composite)}" r="4" fill="#38bdf8"/>`).join('')}
        </svg><div class="muted">Higher = worse than your baseline. Dashed lines: 0, 1, 2 SD.</div>`;
    }
    const rows = sessions.slice(-10).reverse().map((s) => {
      const res = s.composite == null ? 'calibration' : band(s.composite).text;
      return `<tr><td>${new Date(s.ts).toLocaleString()}</td><td>${s.device}</td><td>${res}</td><td>${fmt(METRICS[0], s.metrics.pvt_rt)}</td></tr>`;
    }).join('');
    $('#table').innerHTML = rows
      ? `<table><tr><th>When</th><th>Device</th><th>Result</th><th>RT</th></tr>${rows}</table>`
      : '<span class="muted">Nothing yet.</span>';
    show('history');
  }

  function exportCsv() {
    const { sessions } = load();
    const keys = METRICS.map((m) => m.k);
    const lines = [['timestamp', 'device', 'calibration', 'composite', ...keys].join(',')];
    for (const s of sessions) {
      lines.push([new Date(s.ts).toISOString(), s.device, s.calibration, s.composite ?? '', ...keys.map((k) => s.metrics[k])].join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'attn-sessions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- session flow -------------------------------------------------------------
  let running = false;
  async function runSession() {
    if (running) return;
    running = true;
    show('test');
    const ui = { stage: $('#stage'), hud: (t) => ($('#hud').textContent = t) };
    try {
      const metrics = {};
      for (const t of Tests.list) Object.assign(metrics, await Tests.runTest(t, ui));
      const d = load();
      const dev = device();
      const calibration = d.sessions.filter((s) => s.device === dev && s.calibration).length < CAL_N;
      const base = calibration ? null : baselineFor(dev, d.sessions);
      const session = { ts: Date.now(), device: dev, calibration, metrics, composite: base ? composite(metrics, base) : null };
      d.sessions.push(session);
      save(d);
      if (window.Sync && Sync.name()) Sync.push(session).catch(() => { syncMsg = 'sync failed, will retry next visit'; });
      renderResult(session, calibration ? null : base);
    } catch (e) {
      if (e.message !== 'aborted') throw e;
      renderHome('Check interrupted (you left the page), so it was not saved.');
    } finally {
      running = false;
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && running) Tests.abort(); });
  $('#start').onclick = runSession;
  $('#resultDone').onclick = () => renderHome();
  $('#showHistory').onclick = renderHistory;
  $('#historyBack').onclick = () => renderHome();
  $('#exportCsv').onclick = exportCsv;
  $('#reset').onclick = async () => {
    if (!confirm('Delete all sessions and your baseline' + (window.Sync && Sync.name() ? ', including the synced copy' : '') + '?')) return;
    save({ sessions: [] });
    if (window.Sync && Sync.name()) {
      try { await Sync.deleteAll(); } catch (e) { $('#notice').textContent = 'Could not delete synced copy: ' + (e.code || e.message); }
    }
    renderHistory();
  };
  renderHome();
  if (window.Sync) syncNow(); else addEventListener('sync-ready', syncNow, { once: true });
})();
