import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, buildSteps, roundState, instruction, completeText, slices, tally, wheelLabel } from '../src/model.js';

/** Analyse `prevLine` + `line` and return the second round (or the only one). */
function round(line, prevVs) {
  const prev = prevVs == null ? '' : `R0: sc*${prevVs} in MR (${prevVs})\n`;
  const { pieces } = analyze(prev + line);
  const rounds = pieces[0].rounds;
  return prevVs == null ? rounds : rounds.slice(1);
}

// The plan's test table: input, prev V's, holes, V's, steps, warning?
const TABLE = [
  ['R1: 6 sc in magic ring (6)', null, 0, 6, 6, null],
  ['R2: inc*6 (12)', 6, 6, 12, 12, null],
  ['R3: (sc, inc)*6 (18)', 12, 12, 18, 18, null],
  ['R4: (2sc, inc)*6 (24)', 18, 18, 24, 24, null],
  ['R4: [sc, sc, inc] x 6 = 24', 18, 18, 24, 24, null],
  ['R5: sc around (24)', 24, 24, 24, 24, null],
  ['R6-9: sc*24 (24)', 24, 24, 24, 24, null],
  ['R10: (2sc, dec)*6 (18)', 24, 24, 18, 18, null],
  ['R11: dec*6 (6)', 12, 12, 6, 6, null],
  ['R5: (3sc, inc)*6 (30)', 28, 24, 30, 30, 'Uses 24 holes but the round before has 28.'],
  ['R3: (sc, inc)*6 (20)', 12, 12, 18, 18, 'Says 20 but the stitches make 18.'],
];

for (const [line, prev, holes, vs, steps, warning] of TABLE) {
  test(`table: ${line} (prev ${prev ?? 'none'})`, () => {
    const rounds = round(line, prev);
    assert.ok(rounds.length >= 1);
    for (const r of rounds) {
      assert.equal(r.holes, holes, 'holes');
      assert.equal(r.vs, vs, "V's");
      assert.equal(r.steps.length, steps, 'steps');
      if (warning) assert.deepEqual(r.warnings, [warning]);
      else assert.deepEqual(r.warnings, []);
    }
    if (line.startsWith('R6-9')) assert.equal(rounds.length, 4);
  });
}

test('steps: inc makes two steps (part a, part b), everything else one', () => {
  const [r] = round('R2: (sc, inc, dec)*1', null);
  assert.deepEqual(buildSteps(r.items), [
    { idx: 0, part: 0 },
    { idx: 1, part: 0 },
    { idx: 1, part: 1 },
    { idx: 2, part: 0 },
  ]);
});

test('roundState derives holes used, including the current inc after part a', () => {
  const [r] = round('R3: (sc, inc)*6 (18)', 12);
  assert.deepEqual(
    [0, 1, 2, 3, 18].map((d) => { const s = roundState(r, d); return [s.vsMade, s.holesUsed, s.itemIdx, s.part]; }),
    [[0, 0, 0, 0], [1, 1, 1, 0], [2, 2, 1, 1], [3, 2, 2, 0], [18, 12, 12, null]],
  );
  assert.deepEqual(roundState(r, 4).repeat, { current: 2, total: 6 });
  assert.equal(roundState(r, 18).finished, true);
  assert.equal(roundState(r, 99).stepsDone, 18, 'clamped');
  assert.equal(roundState(r, -3).stepsDone, 0, 'clamped');
});

test('plain rounds have no repeat chip', () => {
  const [r] = round('R5: sc around (24)', 24);
  assert.equal(roundState(r, 3).repeat, null);
});

test('instructions: increase part b says SAME hole', () => {
  const [r] = round('R2: inc*6 (12)', 6);
  assert.match(instruction(r, 0).title, /part a/);
  assert.match(instruction(r, 1).title, /SAME hole/);
  assert.equal(instruction(r, 12), null);
});

test('instructions: the first step of every round explains the marker', () => {
  const { pieces } = analyze(readFileSync(new URL('../examples/ball.txt', import.meta.url), 'utf8'));
  for (const r of pieces[0].rounds) {
    const first = instruction(r, 0);
    assert.ok(first.marker.length > 0, r.label);
    if (!r.ring) assert.match(first.marker, /Goes into the V with the marker/);
    assert.equal(instruction(r, 1).marker, '', `${r.label} step 2 has no marker text`);
  }
});

test('instructions: decrease and ring', () => {
  const [r1] = round('R1: 6 sc in MR (6)', null);
  assert.equal(instruction(r1, 0).title, '1 sc into the magic ring');
  const [r] = round('R11: dec*6 (6)', 12);
  assert.match(instruction(r, 0).title, /next 2 holes together/);
});

test('round complete card: count, last-is-increase hint, next round, notes', () => {
  const { pieces } = analyze('R1: 6 sc in MR (6)\nR2: (sc, inc)*3 (9) stuff now\nR3: sc around (9)');
  const [, r2, r3] = pieces[0].rounds;
  const c = completeText(r2, r3);
  assert.equal(c.lines[0], "Count the V's from the marker: you should have 9.");
  assert.equal(c.lines[1], 'The last stitch should be an increase.');
  assert.equal(c.next, 'R3: sc around (9)');
  assert.deepEqual(c.notes, ['stuff now']);
  assert.equal(completeText(r3, null).lines.length, 1);
});

test('wheel slices: one per hole below, dec spans two, repeat starts marked', () => {
  const [r] = round('R10: (2sc, dec)*6 (18)', 24);
  const sl = slices(r, 3);
  assert.equal(sl.length, 24);
  assert.deepEqual(sl.slice(0, 5).map((s) => [s.label, s.state, s.decPart, s.repeatStart]), [
    ['1', 'done', null, true],
    ['1', 'done', null, false],
    ['dec', 'done', 0, false],
    ['dec', 'done', 1, false],
    ['1', 'current', null, true],
  ]);
});

test('wheel slices: plain round gets a divider every 6 holes', () => {
  const [r] = round('R5: sc around (24)', 24);
  const sl = slices(r, 0);
  assert.deepEqual(sl.map((s, i) => (s.sixStart ? i : -1)).filter((i) => i >= 0), [0, 6, 12, 18]);
  assert.ok(sl.every((s) => !s.repeatStart));
});

test('wheel slices: ring round has one slice per stitch', () => {
  const [r] = round('R1: 6 sc in MR (6)', null);
  assert.equal(slices(r, 2).length, 6);
});

test('tally strip groups chips per repeat', () => {
  const [r] = round('R4: (2sc, inc)*6 (24)', 18);
  const t = tally(r, 0);
  assert.equal(t.length, 6);
  assert.deepEqual(t[0].chips.map((c) => c.label), ['1', '1', '2']);
  assert.equal(t[0].chips[0].state, 'current');
});

test('wheel aria label', () => {
  const [r] = round('R4: (2sc, inc)*6 (24)', 18);
  assert.equal(wheelLabel(r, 6), 'Round 4, stitch 7 of 24, current hole is an increase');
});

test("acceptance: the example ball has no warnings and every round's steps equal its stated count", () => {
  const { pieces, warnings } = analyze(readFileSync(new URL('../examples/ball.txt', import.meta.url), 'utf8'));
  assert.deepEqual(warnings, []);
  for (const r of pieces[0].rounds) assert.equal(r.steps.length, r.stated, r.label);
});

test('analyze reports chain and count warnings with line numbers', () => {
  const { warnings, ok } = analyze('R1: 6 sc in MR (6)\nR2: inc*7 (12)');
  assert.equal(ok, false);
  assert.deepEqual(warnings.map((w) => w.message), [
    "Main R2 (line 2): Says 12 but the stitches make 14.",
    'Main R2 (line 2): Uses 7 holes but the round before has 6.',
  ]);
});
