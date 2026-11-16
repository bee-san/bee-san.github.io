// Crochet Round Tracker: views, events and wiring.
import { analyze, roundState, instruction, completeText, tally, wheelLabel } from './model.js';
import { wheelSVG } from './wheel.js';
import {
  loadState, saveState, createProject, reconcile, exportJSON, importJSON, fileName,
} from './store.js';
import { EXAMPLE_NAME, EXAMPLE_TEXT } from './example.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- state
let state = loadState();
let analysis = { pieces: [], warnings: [] };
let view = 'pattern';
let saveFailed = false;

const project = () => state.projects.find((p) => p.id === state.activeProjectId) ?? null;
const allRounds = () => analysis.pieces.flatMap((p) => p.rounds);

function persist() {
  const ok = saveState(state);
  if (!ok && !saveFailed) {
    saveFailed = true;
    showBanner("Your browser isn't letting this page save, so progress only lasts until you close the tab. Use Export to keep a copy.", { sticky: true });
  }
}

let bannerTimer = 0;
function showBanner(msg, { sticky = false } = {}) {
  const b = $('banner');
  clearTimeout(bannerTimer);
  b.textContent = msg;
  b.hidden = !msg;
  if (msg && !sticky) bannerTimer = setTimeout(() => { b.hidden = true; }, 6000);
}

/** Re-parse the active project and keep its progress in line with the text. */
function refresh() {
  const p = project();
  analysis = p ? analyze(p.text) : { pieces: [], warnings: [] };
  if (p) {
    const next = reconcile(p, analysis.pieces);
    Object.assign(p, next);
  }
}

function touch() {
  const p = project();
  if (p) p.updatedAt = Date.now();
}

function getDone(round) {
  const p = project();
  return Math.min(p?.progress[round.key] ?? 0, round.steps.length);
}

function currentRound() {
  const p = project();
  const rounds = allRounds();
  return rounds.find((r) => r.key === p?.current?.round) ?? rounds[0] ?? null;
}

function setCurrent(round) {
  const p = project();
  if (!p || !round) return;
  p.current = { piece: round.piece, round: round.key };
}

function nextRoundOf(round) {
  const rounds = allRounds();
  const i = rounds.findIndex((r) => r.key === round.key);
  return i >= 0 ? rounds[i + 1] ?? null : null;
}

// ---------------------------------------------------------------- views
function setView(v, { focus = false } = {}) {
  view = v === 'track' ? 'track' : 'pattern';
  $('view-pattern').hidden = view !== 'pattern';
  $('view-track').hidden = view !== 'track';
  for (const b of document.querySelectorAll('.view-btn')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  if (view === 'track') renderTrack();
  else renderPattern();
  if (focus) $('main').focus({ preventScroll: true });
  syncWakeLock();
}

// ---------------------------------------------------------------- pattern view
function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderProjects() {
  const list = $('project-list');
  const sorted = [...state.projects].sort((a, b) => b.updatedAt - a.updatedAt);
  $('projects-empty').hidden = sorted.length > 0;
  list.innerHTML = sorted.map((p) => {
    const a = analyze(p.text);
    const rounds = a.pieces.flatMap((x) => x.rounds);
    const finished = rounds.filter((r) => (p.progress[r.key] ?? 0) >= r.steps.length && r.steps.length).length;
    const active = p.id === state.activeProjectId;
    return `<li class="project${active ? ' is-active' : ''}">
      <div class="project-info">
        <div class="project-name">${esc(p.name)}${active ? ' <span class="muted small">(open)</span>' : ''}</div>
        <div class="project-meta">${finished} of ${rounds.length} rounds done · updated ${esc(relTime(p.updatedAt))}</div>
      </div>
      <div class="row">
        <button type="button" class="btn btn-small" data-open="${esc(p.id)}">Open<span class="vh"> ${esc(p.name)}</span></button>
        <button type="button" class="btn btn-small btn-danger" data-delete="${esc(p.id)}">Delete<span class="vh"> ${esc(p.name)}</span></button>
      </div>
    </li>`;
  }).join('');
}

function renderPreview() {
  const el = $('preview');
  const p = project();
  if (!p || !p.text.trim()) {
    el.innerHTML = '<p class="muted">Paste a pattern above and each round shows up here with its counts.</p>';
    return;
  }
  const rounds = allRounds();
  const roundWarnings = rounds.reduce((n, r) => n + r.warnings.length, 0);
  const general = analysis.warnings.filter((w) => !w.key);
  const total = roundWarnings + general.length;
  let html = `<p class="preview-summary">${analysis.pieces.length} piece${analysis.pieces.length === 1 ? '' : 's'}, ${rounds.length} round${rounds.length === 1 ? '' : 's'}, ${total ? `${total} warning${total === 1 ? '' : 's'}` : 'no warnings'}.</p>`;
  if (general.length) {
    html += `<ul class="general-warnings">${general.map((w) => `<li class="warn-chip">${esc(w.message)}</li>`).join('')}</ul>`;
  }
  for (const piece of analysis.pieces) {
    html += `<h4 class="preview-piece">${esc(piece.name)}</h4>`;
    html += '<table class="preview-table"><thead><tr><th scope="col">Round</th><th scope="col">Holes</th><th scope="col">V\'s</th><th scope="col">Check</th></tr></thead><tbody>';
    for (const r of piece.rounds) {
      const check = r.warnings.length
        ? r.warnings.map((w) => `<span class="warn-chip">${esc(w)}</span>`).join('')
        : '<span class="ok-chip">✓ OK</span>';
      html += `<tr><td>${esc(r.label)}</td><td class="num">${r.ring ? 'ring' : r.holes}</td><td class="num">${r.vs}</td><td>${check}</td></tr>`;
      if (r.notes.length) html += `<tr class="note-row"><td></td><td colspan="3">${r.notes.map(esc).join('<br>')}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  el.innerHTML = html;
}

function renderPattern() {
  const p = project();
  const name = $('name');
  const text = $('text');
  if (document.activeElement !== name) name.value = p?.name ?? '';
  if (document.activeElement !== text) text.value = p?.text ?? '';
  $('export-btn').disabled = !p;
  renderProjects();
  renderPreview();
}

function ensureProject() {
  let p = project();
  if (!p) {
    p = createProject($('name').value.trim() || 'Untitled pattern', '');
    state.projects.push(p);
    state.activeProjectId = p.id;
  }
  return p;
}

let textTimer = 0;
function onTextInput() {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    const value = $('text').value;
    if (!project() && !value.trim()) return;
    const p = ensureProject();
    p.text = value;
    if (p.name === 'Untitled pattern' && !$('name').value.trim()) {
      const first = analyze(value).pieces[0];
      if (first && first.name !== 'Main') p.name = first.name;
    }
    touch();
    refresh();
    persist();
    renderPattern();
  }, 150);
}

function onNameInput() {
  const value = $('name').value;
  if (!project() && !value.trim()) return;
  const p = ensureProject();
  p.name = value.trim() || 'Untitled pattern';
  touch();
  persist();
  renderProjects();
}

function openProject(id, goTrack = true) {
  state.activeProjectId = id;
  refresh();
  persist();
  if (goTrack && allRounds().length) setView('track', { focus: true });
  else setView('pattern');
}

function loadExample() {
  const p = createProject(EXAMPLE_NAME, EXAMPLE_TEXT);
  state.projects.push(p);
  state.activeProjectId = p.id;
  refresh();
  persist();
  renderPattern();
  $('text').focus();
}

function newPattern() {
  state.activeProjectId = null;
  refresh();
  persist();
  $('name').value = '';
  $('text').value = '';
  renderPattern();
  $('name').focus();
}

function clearText() {
  const p = project();
  if (!p || !p.text) return;
  const hasProgress = Object.keys(p.progress).length > 0;
  if (hasProgress && !confirm('Clear the pattern text? Progress on its rounds will be lost.')) return;
  p.text = '';
  touch();
  refresh();
  persist();
  $('text').value = '';
  renderPattern();
  $('text').focus();
}

function deleteProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.name}" and its progress from this device?`)) return;
  state.projects = state.projects.filter((x) => x.id !== id);
  if (state.activeProjectId === id) state.activeProjectId = null;
  refresh();
  persist();
  renderPattern();
}

function exportProject() {
  const p = project();
  if (!p) return;
  const blob = new Blob([exportJSON(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(p.name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const p = importJSON(text, state.projects.map((x) => x.id));
    state.projects.push(p);
    state.activeProjectId = p.id;
    refresh();
    persist();
    showBanner(`Imported "${p.name}".`);
    renderPattern();
  } catch (err) {
    showBanner(err instanceof Error ? err.message : "Couldn't read that file.");
  }
}

// ---------------------------------------------------------------- track view
function renderTrack() {
  const rounds = allRounds();
  const has = rounds.length > 0;
  $('track-empty').hidden = has;
  $('track-main').hidden = !has;
  if (!has) return;

  const p = project();
  const round = currentRound();
  const done = getDone(round);
  const s = roundState(round, done);
  const piece = analysis.pieces.find((x) => x.name === round.piece);

  $('track-title').textContent = p.name;

  // piece tabs
  const tabs = $('piece-tabs');
  tabs.innerHTML = analysis.pieces.length > 1
    ? analysis.pieces.map((x) => `<button type="button" class="btn btn-small piece-tab" data-piece="${esc(x.name)}" aria-pressed="${x.name === round.piece}">${esc(x.name)}</button>`).join('')
    : '';

  // round chips
  const chips = $('round-chips');
  chips.innerHTML = piece.rounds.map((r) => {
    const d = getDone(r);
    const total = r.steps.length;
    const cls = ['round-chip'];
    let st = 'not started';
    if (d >= total) { cls.push('is-done'); st = 'done'; }
    else if (d > 0) { cls.push('is-part'); st = `${d} of ${total}`; }
    if (r.key === round.key) cls.push('is-current');
    if (r.warnings.length) cls.push('has-warning');
    const pct = total ? Math.round((d / total) * 100) : 0;
    return `<button type="button" class="${cls.join(' ')}" data-round="${esc(r.key)}" style="--pct:${pct}%"
      ${r.key === round.key ? 'aria-current="step"' : ''} aria-label="${esc(`${r.label}, ${st}${r.warnings.length ? ', has a warning' : ''}`)}">${esc(r.label)}</button>`;
  }).join('');
  const curChip = chips.querySelector('[aria-current]');
  if (curChip) {
    const left = curChip.offsetLeft - chips.clientWidth / 2 + curChip.clientWidth / 2;
    chips.scrollTo({ left: Math.max(0, left) });
  }

  // wheel
  const wheel = $('wheel');
  wheel.innerHTML = wheelSVG(round, done);
  wheel.setAttribute('aria-label', wheelLabel(round, done));

  // stats
  const stats = [
    `<span class="stat"><b>${s.vsMade}</b> / ${s.total} V's made</span>`,
    round.ring ? '<span class="stat">into the magic ring</span>' : `<span class="stat"><b>${s.holesUsed}</b> / ${s.holesTotal} holes used</span>`,
  ];
  if (s.repeat) stats.push(`<span class="stat">repeat <b>${s.repeat.current ?? s.repeat.total}</b> of ${s.repeat.total}</span>`);
  $('stats').innerHTML = stats.join('');
  $('round-warnings').innerHTML = round.warnings.map((w) => `<span class="warn-chip">${esc(w)}</span>`).join('');

  // instruction / complete card
  const card = $('instruction');
  const next = nextRoundOf(round);
  const notes = [...(round.index === 0 ? piece.notes : []), ...round.notes];
  const notesHtml = notes.length
    ? `<div class="note-box"><strong>Pattern note</strong>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`
    : '';
  if (s.finished) {
    const c = completeText(round, next);
    let nextHtml = '';
    if (next) {
      const label = next.piece !== round.piece ? `${next.piece}, ${c.next}` : c.next;
      nextHtml = `<p><strong>Next:</strong></p><p class="next-pattern">${esc(label)}</p>`;
    } else {
      nextHtml = '<p><strong>That was the last round of the pattern. Well done!</strong></p>';
    }
    card.className = 'card instr complete';
    card.innerHTML = `<p class="instr-eyebrow">${esc(round.piece)} · ${esc(round.label)} complete</p>
      <h3>Round done 🎉</h3>
      ${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${nextHtml}${notesHtml}`;
  } else {
    const ins = instruction(round, done);
    const title = esc(ins.title).replace('SAME hole', '<em>SAME hole</em>');
    card.className = 'card instr';
    card.innerHTML = `<p class="instr-eyebrow">${esc(round.piece)} · ${esc(round.label)} · stitch ${done + 1} of ${s.total}</p>
      <p class="instr-title">${title}</p>
      ${ins.detail ? `<p class="instr-detail">${esc(ins.detail)}</p>` : ''}
      ${ins.marker ? `<p class="marker-tip">${esc(ins.marker)}</p>` : ''}
      ${notesHtml}`;
  }

  // tally
  $('tally').innerHTML = tally(round, done).map((g) =>
    `<span class="tally-group">${g.chips.map((c) => `<span class="tally-chip is-${c.state}">${esc(c.label)}</span>`).join('')}</span>`,
  ).join('');

  // buttons
  const doneBtn = $('done-btn');
  if (s.finished) {
    if (next) {
      doneBtn.textContent = next.piece !== round.piece ? `Start ${next.piece} ${next.label}` : `Start round ${next.number}`;
      doneBtn.disabled = false;
    } else {
      doneBtn.textContent = 'All rounds done';
      doneBtn.disabled = true;
    }
  } else {
    doneBtn.textContent = 'Done';
    doneBtn.disabled = false;
  }
  $('undo-btn').disabled = done === 0;
  $('restart-btn').disabled = done === 0;
}

function setDone(round, n) {
  const p = project();
  const total = round.steps.length;
  const v = Math.max(0, Math.min(n, total));
  if (v) p.progress[round.key] = v;
  else delete p.progress[round.key];
  setCurrent(round);
  touch();
  persist();
  if (v === total && n > 0) {
    try { navigator.vibrate?.([60, 40, 60]); } catch { /* not supported */ }
  }
  renderTrack();
}

function doDone() {
  const round = currentRound();
  if (!round) return;
  const done = getDone(round);
  if (done < round.steps.length) {
    setDone(round, done + 1);
    return;
  }
  const next = nextRoundOf(round);
  if (next) {
    setCurrent(next);
    touch();
    persist();
    renderTrack();
  }
}

function doUndo() {
  const round = currentRound();
  if (!round) return;
  const done = getDone(round);
  if (done > 0) setDone(round, done - 1);
}

function doRestart() {
  const round = currentRound();
  if (!round || getDone(round) === 0) return;
  if (!confirm(`Restart ${round.label}? Its stitch count goes back to 0.`)) return;
  setDone(round, 0);
}

function jumpToRound(key) {
  const round = allRounds().find((r) => r.key === key);
  if (!round) return;
  setCurrent(round);
  touch();
  persist();
  renderTrack();
}

function jumpToPiece(name) {
  const piece = analysis.pieces.find((x) => x.name === name);
  if (!piece) return;
  const target = piece.rounds.find((r) => getDone(r) < r.steps.length) ?? piece.rounds[0];
  jumpToRound(target.key);
}

// ---------------------------------------------------------------- wake lock
let wakeLock = null;
async function syncWakeLock() {
  const want = view === 'track' && $('wake').checked && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

// ---------------------------------------------------------------- theme
const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches);
function labelTheme() {
  $('theme-btn').setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
}

// ---------------------------------------------------------------- events
function isTyping(t) {
  return t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('button') : null;
    if (!t) return;
    if (t.dataset.view) setView(t.dataset.view, { focus: true });
    else if (t.dataset.open) openProject(t.dataset.open);
    else if (t.dataset.delete) deleteProject(t.dataset.delete);
    else if (t.dataset.round) jumpToRound(t.dataset.round);
    else if (t.dataset.piece) jumpToPiece(t.dataset.piece);
  });

  $('text').addEventListener('input', onTextInput);
  $('name').addEventListener('input', onNameInput);
  $('start-btn').addEventListener('click', () => {
    clearTimeout(textTimer);
    const p = project();
    if (p && p.text !== $('text').value) { p.text = $('text').value; touch(); refresh(); persist(); }
    if (allRounds().length) setView('track', { focus: true });
    else {
      showBanner('No rounds found yet. Paste a pattern with lines like "R1: 6 sc in magic ring (6)", or load the example.');
      $('text').focus();
    }
  });
  $('example-btn').addEventListener('click', loadExample);
  $('clear-btn').addEventListener('click', clearText);
  $('new-btn').addEventListener('click', newPattern);
  $('export-btn').addEventListener('click', exportProject);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    importFile(e.target.files?.[0]);
    e.target.value = '';
  });

  $('done-btn').addEventListener('click', doDone);
  $('undo-btn').addEventListener('click', doUndo);
  $('restart-btn').addEventListener('click', doRestart);

  document.addEventListener('keydown', (e) => {
    if (view !== 'track' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) doDone();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (!e.repeat) doUndo();
    }
  });
  // a focused button would otherwise also fire its own click on Space keyup
  document.addEventListener('keyup', (e) => {
    if (view === 'track' && (e.key === ' ' || e.code === 'Space') && e.target instanceof HTMLButtonElement) e.preventDefault();
  });

  if ('wakeLock' in navigator) {
    $('wake-wrap').hidden = false;
    try { $('wake').checked = localStorage.getItem('crochet-tracker:wake') === '1'; } catch { /* ignore */ }
    $('wake').addEventListener('change', () => {
      try { localStorage.setItem('crochet-tracker:wake', $('wake').checked ? '1' : '0'); } catch { /* ignore */ }
      syncWakeLock();
    });
    document.addEventListener('visibilitychange', syncWakeLock);
  }

  $('theme-btn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('bee-theme', next); } catch { /* ignore */ }
    labelTheme();
    if (view === 'track') renderTrack(); // redraw the wheel in the new palette
  });
  darkQuery.addEventListener?.('change', () => { labelTheme(); if (view === 'track') renderTrack(); });

  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
  // another tab changed the saved data
  window.addEventListener('storage', (e) => {
    if (e.key && e.key !== 'crochet-tracker:v1') return;
    state = loadState();
    refresh();
    setView(view);
  });
}

// ---------------------------------------------------------------- start
function start() {
  try {
    bind();
    labelTheme();
    refresh();
    const hash = location.hash.slice(1);
    const initial = hash === 'track' || hash === 'pattern' ? hash : allRounds().length ? 'track' : 'pattern';
    setView(initial);
  } catch (err) {
    console.error(err);
    showBanner('Something went wrong while starting the tracker. Try reloading the page.', { sticky: true });
  }
}

start();
