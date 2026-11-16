import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEY, loadState, saveState, createProject, reconcile, exportJSON, importJSON, fileName, emptyState,
} from '../src/store.js';
import { analyze } from '../src/model.js';
import { EXAMPLE_TEXT } from '../src/example.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };

test('the embedded example matches examples/ball.txt', () => {
  assert.equal(EXAMPLE_TEXT, readFileSync(new URL('../examples/ball.txt', import.meta.url), 'utf8'));
});

test('load/save round trip under the versioned key', () => {
  const st = fakeStorage();
  const state = emptyState();
  const p = createProject('Ball', EXAMPLE_TEXT);
  p.progress['Ball/2'] = 5;
  p.current = { piece: 'Ball', round: 'Ball/2' };
  state.projects.push(p);
  state.activeProjectId = p.id;
  assert.equal(saveState(state, st), true);
  assert.ok(st.map.has(KEY));
  const back = loadState(st);
  assert.equal(back.activeProjectId, p.id);
  assert.deepEqual(back.projects[0].progress, { 'Ball/2': 5 });
  assert.deepEqual(back.projects[0].current, { piece: 'Ball', round: 'Ball/2' });
});

test('missing or throwing storage never breaks the app', () => {
  assert.deepEqual(loadState(null), emptyState());
  assert.deepEqual(loadState(throwing), emptyState());
  assert.equal(saveState(emptyState(), throwing), false);
  assert.equal(saveState(emptyState(), null), false);
  const st = fakeStorage();
  st.setItem(KEY, '{not json');
  assert.deepEqual(loadState(st), emptyState());
  st.setItem(KEY, JSON.stringify({ version: 99, projects: [] }));
  assert.deepEqual(loadState(st), emptyState());
});

test('reconcile keeps progress for unchanged lines and resets edited ones', () => {
  let p = createProject('x', 'R1: 6 sc in MR (6)\nR2: inc*6 (12)\nR3: (sc, inc)*6 (18)');
  p = reconcile(p, analyze(p.text).pieces);
  p.progress = { 'Main/1': 6, 'Main/2': 12, 'Main/3': 4 };
  // edit R3 only
  p.text = 'R1: 6 sc in MR (6)\nR2: inc*6 (12)\nR3: (sc, inc) x 6 (18)';
  const q = reconcile(p, analyze(p.text).pieces);
  assert.deepEqual(q.progress, { 'Main/1': 6, 'Main/2': 12 });
});

test('reconcile clamps progress, drops removed rounds and fixes current', () => {
  const p = { ...createProject('x', 'R1: 6 sc in MR (6)'), progress: { 'Main/1': 50, 'Main/9': 3 }, current: { piece: 'Main', round: 'Main/9' } };
  const q = reconcile(p, analyze(p.text).pieces);
  assert.deepEqual(q.progress, { 'Main/1': 6 });
  assert.deepEqual(q.current, { piece: 'Main', round: 'Main/1' });
});

test('export then import restores the project', () => {
  const p = createProject('Little bee', EXAMPLE_TEXT);
  p.progress = { 'Ball/4': 7 };
  p.current = { piece: 'Ball', round: 'Ball/4' };
  const back = importJSON(exportJSON(p));
  assert.equal(back.name, 'Little bee');
  assert.equal(back.text, EXAMPLE_TEXT);
  assert.deepEqual(back.progress, { 'Ball/4': 7 });
  assert.deepEqual(back.current, p.current);
  assert.equal(back.id, p.id);
  assert.notEqual(importJSON(exportJSON(p), [p.id]).id, p.id, 'fresh id on collision');
});

test('import rejects junk with a readable message', () => {
  assert.throws(() => importJSON('hello'), /isn't JSON/);
  assert.throws(() => importJSON('{"a":1}'), /doesn't contain a pattern/);
});

test('fileName makes a safe slug', () => {
  assert.equal(fileName('Little Bee: body!'), 'little-bee-body.crochet.json');
  assert.equal(fileName('???'), 'pattern.crochet.json');
});
