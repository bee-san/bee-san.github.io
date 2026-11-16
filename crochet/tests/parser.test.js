import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePattern, parseRoundBody, vsOf, holesOf } from '../src/parser.js';

const types = (items) => items.map((i) => i.type).join(' ');

/** Parse a single labelled line with a given previous V count. */
function one(line, prevVs = null) {
  const body = line.replace(/^\s*R\d+(?:-\d+)?:\s*/, '');
  return parseRoundBody(body, { prevVs });
}

test('R1: 6 sc in magic ring (6) -> ring round, 0 holes, 6 Vs', () => {
  const r = one('R1: 6 sc in magic ring (6)');
  assert.equal(r.ring, true);
  assert.equal(holesOf(r.items), 0);
  assert.equal(vsOf(r.items), 6);
  assert.equal(r.stated, 6);
  assert.equal(types(r.items), 'ring ring ring ring ring ring');
});

test('R1: sc*6 in MR is the same as 6 sc in magic ring', () => {
  const r = one('R1: sc*6 in MR');
  assert.equal(r.ring, true);
  assert.equal(holesOf(r.items), 0);
  assert.equal(vsOf(r.items), 6);
  assert.equal(r.stated, null);
});

test('R2: inc*6 (12) and inc x6 = 12 and 6 inc', () => {
  for (const line of ['R2: inc*6 (12)', 'R2: inc x6 = 12', 'R2: 6 inc (12)', 'R2: inc × 6 (12)', 'R2: increase x 6 (12)']) {
    const r = one(line, 6);
    assert.equal(holesOf(r.items), 6, line);
    assert.equal(vsOf(r.items), 12, line);
    assert.equal(r.stated, 12, line);
    assert.equal(r.repeats, 6, line);
  }
});

test('R3: (sc, inc)*6 (18) and [sc, inc] x 6', () => {
  for (const line of ['R3: (sc, inc)*6 (18)', 'R3: [sc, inc] x 6', 'R3: (sc, inc) 6 times (18)', 'R3: 6x (sc, inc) (18)']) {
    const r = one(line, 12);
    assert.equal(holesOf(r.items), 12, line);
    assert.equal(vsOf(r.items), 18, line);
    assert.equal(r.repeats, 6, line);
    assert.equal(types(r.items.slice(0, 4)), 'sc inc sc inc', line);
  }
});

test('R4: (2sc, inc)*6 (24): 2sc means one sc in each of 2 holes', () => {
  const r = one('R4: (2sc, inc)*6 (24)', 18);
  assert.equal(holesOf(r.items), 18);
  assert.equal(vsOf(r.items), 24);
  assert.equal(types(r.items.slice(0, 3)), 'sc sc inc');
});

test('R4: [sc, sc, inc] x 6 = 24 is the same as (2sc, inc)*6', () => {
  const a = one('R4: (2sc, inc)*6 (24)', 18);
  const b = one('R4: [sc, sc, inc] x 6 = 24', 18);
  assert.deepEqual(a.items, b.items);
  assert.equal(b.stated, 24);
});

test('R5: sc around (24) uses every hole of the previous round', () => {
  const r = one('R5: sc around (24)', 24);
  assert.equal(holesOf(r.items), 24);
  assert.equal(vsOf(r.items), 24);
  assert.equal(r.repeats, 0);
  const b = one('R5: sc in each st around (24)', 24);
  assert.equal(vsOf(b.items), 24);
});

test('R5: sc*24 is a plain round, not 24 repeats', () => {
  const r = one('R5: sc*24', 24);
  assert.equal(vsOf(r.items), 24);
  assert.equal(r.repeats, 0);
  assert.ok(r.items.every((i) => i.rep === null));
});

test('R6-9: sc*24 (24) expands into 4 rounds', () => {
  const { pieces } = parsePattern('R1: sc*24 in MR (24)\nR6-9: sc*24 (24)');
  const rounds = pieces[0].rounds.slice(1);
  assert.deepEqual(rounds.map((r) => r.number), [6, 7, 8, 9]);
  for (const r of rounds) {
    assert.equal(holesOf(r.items), 24);
    assert.equal(vsOf(r.items), 24);
  }
});

test('R10: (2sc, dec)*6 (18): dec uses 2 holes, makes 1 V', () => {
  const r = one('R10: (2sc, dec)*6 (18)', 24);
  assert.equal(holesOf(r.items), 24);
  assert.equal(vsOf(r.items), 18);
  const dec = r.items[2];
  assert.equal(dec.type, 'dec');
  assert.equal(dec.span, 2);
  assert.equal(dec.hole, 2);
  assert.equal(r.items[3].hole, 4);
});

test('R11: dec*6 (6)', () => {
  const r = one('R11: dec*6 (6)', 12);
  assert.equal(holesOf(r.items), 12);
  assert.equal(vsOf(r.items), 6);
});

test('decrease synonyms: invdec, inv dec, sc2tog, decrease', () => {
  for (const w of ['invdec', 'inv dec', 'sc2tog', 'decrease', 'dec', 'invisible decrease']) {
    const r = one(`R11: ${w}*6 (6)`, 12);
    assert.equal(types(r.items), 'dec dec dec dec dec dec', w);
  }
});

test('single crochet -> sc', () => {
  const r = one('R5: single crochet around (24)', 24);
  assert.equal(vsOf(r.items), 24);
  assert.equal(r.items[0].type, 'sc');
});

test('items carry repeat structure: rep, firstInRepeat, hole', () => {
  const r = one('R3: (sc, inc)*6 (18)', 12);
  assert.deepEqual(r.items.slice(0, 3), [
    { type: 'sc', rep: 0, firstInRepeat: true, hole: 0, span: 1 },
    { type: 'inc', rep: 0, firstInRepeat: false, hole: 1, span: 1 },
    { type: 'sc', rep: 1, firstInRepeat: true, hole: 2, span: 1 },
  ]);
});

test('note after the count is kept', () => {
  const { pieces } = parsePattern('R1: sc*24 in MR (24)\nR12: sc*24 (24) stuff now');
  const r = pieces[0].rounds[1];
  assert.equal(r.stated, 24);
  assert.deepEqual(r.notes, ['stuff now']);
});

test('Insert eyes between R6 and R7 becomes a note on the round above', () => {
  const text = 'R1: 6 sc in MR (6)\nR2: inc*6 (12)\nInsert eyes between R6 and R7\nR3: (sc, inc)*6 (18)';
  const { pieces, warnings } = parsePattern(text);
  assert.equal(pieces[0].rounds.length, 3);
  assert.deepEqual(pieces[0].rounds[1].notes, ['Insert eyes between R6 and R7']);
  assert.equal(warnings.length, 0);
});

test('pieces: "Body:" and "# Belly" start new pieces, round numbers restart', () => {
  const text = 'Body:\nR1: 6 sc in MR (6)\nR2: inc*6 (12)\n# Belly\nR1: 6 sc in MR (6)\nArms (make 2):\nR1: 5 sc in MR (5)';
  const { pieces } = parsePattern(text);
  assert.deepEqual(pieces.map((p) => p.name), ['Body', 'Belly', 'Arms (make 2)']);
  assert.deepEqual(pieces[1].rounds.map((r) => r.key), ['Belly/1']);
  assert.equal(pieces[0].rounds[1].key, 'Body/2');
});

test('round label variants: Rnd, Round, ranges with R on both ends', () => {
  const { pieces } = parsePattern('Rnd 1: 6 sc in MR (6)\nRound 2: inc*6 (12)\nR3-R4: sc*12 (12)\nRnds 5 - 6: sc around');
  assert.deepEqual(pieces[0].rounds.map((r) => r.number), [1, 2, 3, 4, 5, 6]);
  assert.equal(vsOf(pieces[0].rounds[5].items), 12);
});

test('unknown stitches become text steps with a warning, never a crash', () => {
  const { pieces, warnings } = parsePattern('R1: 6 sc in MR (6)\nR2: 6 bobble (6)');
  const r = pieces[0].rounds[1];
  assert.equal(r.items.length, 6);
  assert.ok(r.items.every((i) => i.type === 'text' && i.span === 1));
  assert.match(warnings[0].message, /didn't recognise "bobble"/);
});

test('an unknown stitch with no number fills the stated count', () => {
  const { pieces } = parsePattern('R1: 6 sc in MR (6)\nR2: puff stitch (6)');
  assert.equal(pieces[0].rounds[1].items.length, 6);
});

test('remarks next to stitches that already add up become a note', () => {
  const { pieces } = parsePattern('R1: 6 sc in MR (6)\nR2: BLO sc around (6)\nR3: with white, sc around (6)');
  assert.equal(pieces[0].rounds[1].items.length, 6);
  assert.equal(pieces[0].rounds[2].items.length, 6);
  assert.deepEqual(pieces[0].rounds[2].notes, ['with white']);
});

test('junk text never throws and gives readable warnings', () => {
  const junk = 'asdf qwerty\n)))(((***\nR: x x x\nR5:\n\u{1F9F6} yarn!!';
  const { pieces, warnings } = parsePattern(junk);
  assert.ok(Array.isArray(pieces));
  assert.ok(warnings.length > 0);
  for (const w of warnings) assert.equal(typeof w.message, 'string');
  assert.ok(warnings.some((w) => /Line 1/.test(w.message)));
});

test('empty input gives no pieces and no warnings', () => {
  assert.deepEqual(parsePattern(''), { pieces: [], warnings: [] });
});

test('examples/ball.txt parses into 10 rounds', () => {
  const text = readFileSync(new URL('../examples/ball.txt', import.meta.url), 'utf8');
  const { pieces, warnings } = parsePattern(text);
  assert.equal(warnings.length, 0);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].name, 'Ball');
  assert.deepEqual(pieces[0].rounds.map((r) => r.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(pieces[0].rounds[7].notes, ['Start stuffing the ball.']);
});

test('a label with no stitches is kept as a note, not an empty round', () => {
  const { pieces, warnings } = parsePattern('R1: 6 sc in MR (6)\nR2:');
  assert.equal(pieces[0].rounds.length, 1);
  assert.deepEqual(pieces[0].rounds[0].notes, ['R2:']);
  assert.match(warnings[0].message, /Line 2: couldn't find any stitches in "R2:"/);
});
