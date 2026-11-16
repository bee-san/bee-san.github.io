// Crochet Round Tracker: saving progress in localStorage, export and import.
// Every storage call is wrapped so the app keeps working when storage is missing or throws.
// Functions take an optional storage object so Node tests can pass a fake one.

export const KEY = 'crochet-tracker:v1';

export function emptyState() {
  return { version: 1, projects: [], activeProjectId: null };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Clean up a project from storage or a file; returns null if it is unusable. */
export function normaliseProject(p) {
  if (!isObj(p) || typeof p.text !== 'string') return null;
  const progress = {};
  if (isObj(p.progress)) {
    for (const [k, v] of Object.entries(p.progress)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) progress[k] = n;
    }
  }
  const lines = {};
  if (isObj(p.lines)) {
    for (const [k, v] of Object.entries(p.lines)) if (typeof v === 'string') lines[k] = v;
  }
  const current = isObj(p.current) && typeof p.current.piece === 'string' && typeof p.current.round === 'string'
    ? { piece: p.current.piece, round: p.current.round }
    : null;
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId(),
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 200) : 'Untitled pattern',
    text: p.text,
    progress,
    lines,
    current,
    updatedAt: Number.isFinite(Number(p.updatedAt)) ? Number(p.updatedAt) : Date.now(),
  };
}

export function loadState(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyState();
    const data = JSON.parse(raw);
    if (!isObj(data) || data.version !== 1 || !Array.isArray(data.projects)) return emptyState();
    const projects = data.projects.map(normaliseProject).filter(Boolean);
    const active = projects.some((p) => p.id === data.activeProjectId) ? data.activeProjectId : null;
    return { version: 1, projects, activeProjectId: active };
  } catch {
    return emptyState();
  }
}

/** Returns true when the write worked. */
export function saveState(state, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function createProject(name, text = '') {
  return normaliseProject({ id: newId(), name, text, progress: {}, lines: {}, current: null, updatedAt: Date.now() });
}

/**
 * After a (re-)parse, keep progress only for rounds whose line is unchanged,
 * clamp it to the round's length and make sure `current` points at a real round.
 * `pieces` come from model.analyze(). Returns a new project.
 */
export function reconcile(project, pieces) {
  const progress = {};
  const lines = {};
  const known = Object.keys(project.lines ?? {}).length > 0;
  const rounds = pieces.flatMap((p) => p.rounds);
  for (const r of rounds) {
    lines[r.key] = r.line;
    const done = project.progress?.[r.key];
    if (!done) continue;
    // Old saves without a line map keep their progress; otherwise the line must match.
    if (known && project.lines[r.key] !== r.line) continue;
    progress[r.key] = Math.min(done, r.steps.length);
  }
  let current = project.current;
  if (!current || !rounds.some((r) => r.key === current.round)) {
    const first = rounds[0];
    current = first ? { piece: first.piece, round: first.key } : null;
  }
  return { ...project, progress, lines, current };
}

/** JSON text for one project's backup file. */
export function exportJSON(project) {
  return JSON.stringify({ app: 'crochet-tracker', version: 1, exportedAt: new Date().toISOString(), project }, null, 2);
}

/**
 * Read a backup file. Accepts an exported file, or a bare project object.
 * Throws an Error with a readable message on bad input.
 * The project gets a fresh id if one with the same id already exists.
 */
export function importJSON(text, existingIds = []) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Crochet Round Tracker backup (it isn't JSON).");
  }
  const raw = isObj(data) && isObj(data.project) ? data.project : data;
  const project = normaliseProject(raw);
  if (!project) throw new Error("That file doesn't contain a pattern.");
  if (existingIds.includes(project.id)) project.id = newId();
  project.updatedAt = Date.now();
  return project;
}

/** A safe file name for an export. */
export function fileName(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${slug || 'pattern'}.crochet.json`;
}
