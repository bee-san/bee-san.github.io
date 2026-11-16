// Crochet Round Tracker: items -> steps, counts, warnings, step text.
// Pure module: no DOM, no storage. Tested with `node --test`.

import { parsePattern, vsOf, holesOf } from './parser.js';

/** One step per ring sc, sc, dec and text item; two per inc (part 0 = a, part 1 = b). */
export function buildSteps(items) {
  const steps = [];
  items.forEach((it, idx) => {
    steps.push({ idx, part: 0 });
    if (it.type === 'inc') steps.push({ idx, part: 1 });
  });
  return steps;
}

/** Warnings for one round. prevVs is the round below's V's, or null. */
export function checkRound(round, prevVs) {
  const out = [];
  const vs = vsOf(round.items);
  const holes = holesOf(round.items);
  if (round.stated != null && round.stated !== vs) {
    out.push(`Says ${round.stated} but the stitches make ${vs}.`);
  }
  if (!round.ring && prevVs != null && holes !== prevVs) {
    out.push(`Uses ${holes} holes but the round before has ${prevVs}.`);
  }
  return out;
}

/**
 * Parse and check a whole pattern.
 * Each round gains: steps, holes, vs, warnings, index (within its piece).
 * Returns { pieces, warnings: [{ line, message, key? }], ok }.
 */
export function analyze(text) {
  const { pieces, warnings } = parsePattern(text);
  const all = [...warnings];
  for (const piece of pieces) {
    let prev = null;
    piece.rounds.forEach((round, index) => {
      round.index = index;
      round.steps = buildSteps(round.items);
      round.holes = holesOf(round.items);
      round.vs = round.steps.length;
      round.warnings = checkRound(round, prev ? prev.vs : null);
      for (const w of round.warnings) {
        all.push({ line: round.lineNo, key: round.key, message: `${piece.name} ${round.label} (line ${round.lineNo}): ${w}` });
      }
      prev = round;
    });
  }
  all.sort((a, b) => a.line - b.line);
  return { pieces, warnings: all, ok: all.length === 0 };
}

/** Is this a plain round (no repeats, only sc)? Plain rounds get a divider every 6 holes. */
export function isPlain(round) {
  return !round.items.some((it) => it.rep != null);
}

/** Everything the tracker shows, derived from stepsDone. */
export function roundState(round, stepsDone) {
  const steps = round.steps ?? buildSteps(round.items);
  const total = steps.length;
  const done = Math.max(0, Math.min(stepsDone | 0, total));
  const finished = done >= total;
  const step = finished ? null : steps[done];
  const itemIdx = step ? step.idx : round.items.length;
  const item = step ? round.items[step.idx] : null;

  let holesUsed = 0;
  for (let i = 0; i < itemIdx; i++) holesUsed += round.items[i].span;
  if (item && item.type === 'inc' && step.part === 1) holesUsed += item.span;

  const reps = round.items.reduce((m, it) => (it.rep != null ? Math.max(m, it.rep + 1) : m), 0);
  let repeat = null;
  if (reps > 0) {
    const ref = item ?? round.items[round.items.length - 1];
    repeat = { current: ref && ref.rep != null ? ref.rep + 1 : null, total: reps };
  }

  return {
    stepsDone: done,
    total,
    finished,
    step,
    item,
    itemIdx,
    part: step ? step.part : null,
    vsMade: done,
    holesUsed,
    holesTotal: holesOf(round.items),
    repeat,
    lastIsInc: round.items.length > 0 && round.items[round.items.length - 1].type === 'inc',
  };
}

const MARKER_FIRST =
  'Goes into the V with the marker. Take the marker out, make the stitch, clip the marker into it.';
const MARKER_RING = 'This is the first stitch of the piece. When it is made, clip the marker into it.';

/** Plain-words instruction for the step at stepsDone. */
export function instruction(round, stepsDone) {
  const s = roundState(round, stepsDone);
  if (s.finished) return null;
  const it = s.item;
  let title;
  let detail = '';
  switch (it.type) {
    case 'ring':
      title = '1 sc into the magic ring';
      break;
    case 'sc':
      title = '1 sc in the next hole';
      break;
    case 'inc':
      if (s.part === 0) {
        title = 'Increase, part a: 1 sc in the next hole';
        detail = 'Then you will put another sc in the same hole.';
      } else {
        title = 'Increase, part b: another sc in the SAME hole';
        detail = 'Same hole as the stitch you just made.';
      }
      break;
    case 'dec':
      title = 'Decrease: work the next 2 holes together into 1 stitch';
      break;
    default:
      title = `${it.text} (as written in your pattern)`;
      detail = 'The tracker counts this as 1 stitch.';
  }
  const first = s.stepsDone === 0;
  const marker = first ? (round.ring ? MARKER_RING : MARKER_FIRST) : '';
  return { title, detail, marker, first, type: it.type, part: s.part };
}

/** Text for the round-complete card. */
export function completeText(round, nextRound) {
  const s = roundState(round, round.steps?.length ?? 0);
  const lines = [`Count the V's from the marker: you should have ${s.total}.`];
  if (s.lastIsInc) lines.push('The last stitch should be an increase.');
  return {
    lines,
    next: nextRound ? `${nextRound.label}: ${nextRound.line.replace(/^\s*(?:rounds|round|rnds|rnd|rds|rd|r)\s*\.?\s*\d+(?:\s*(?:-|to)\s*\S*\d+)?\s*[:.)]?\s*/i, '')}` : null,
    notes: round.notes ?? [],
  };
}

function itemLabel(it) {
  if (it.type === 'inc') return '2';
  if (it.type === 'dec') return 'dec';
  if (it.type === 'text') return '?';
  return '1';
}

/**
 * Wheel slices: one per hole in the round below (one per stitch for a ring round).
 * Each: { itemIdx, label, state: 'done' | 'current' | 'todo', decPart: 0|1|null, repeatStart, sixStart }
 */
export function slices(round, stepsDone) {
  const s = roundState(round, stepsDone);
  const plain = isPlain(round);
  const out = [];
  round.items.forEach((it, idx) => {
    const state = idx < s.itemIdx ? 'done' : idx === s.itemIdx ? 'current' : 'todo';
    const n = Math.max(1, it.span);
    for (let k = 0; k < n; k++) {
      out.push({
        itemIdx: idx,
        label: itemLabel(it),
        state,
        decPart: it.type === 'dec' ? k : null,
        repeatStart: !plain && it.firstInRepeat && k === 0,
      });
    }
  });
  out.forEach((sl, i) => { sl.sixStart = plain && i % 6 === 0; });
  return out;
}

/** Tally strip: chips grouped per repeat. [{ rep, chips: [{ itemIdx, label, state }] }] */
export function tally(round, stepsDone) {
  const s = roundState(round, stepsDone);
  const groups = [];
  round.items.forEach((it, idx) => {
    const chip = { itemIdx: idx, label: itemLabel(it), state: idx < s.itemIdx ? 'done' : idx === s.itemIdx ? 'current' : 'todo' };
    const last = groups[groups.length - 1];
    if (last && last.rep === it.rep && !(it.firstInRepeat)) last.chips.push(chip);
    else groups.push({ rep: it.rep, chips: [chip] });
  });
  return groups;
}

/** Short screen-reader description of the wheel. */
export function wheelLabel(round, stepsDone) {
  const s = roundState(round, stepsDone);
  if (s.finished) return `Round ${round.number} finished, ${s.total} of ${s.total} V's made`;
  const kind = { ring: 'into the ring', sc: 'a single crochet', inc: 'an increase', dec: 'a decrease', text: 'a pattern step' }[s.item.type];
  return `Round ${round.number}, stitch ${s.stepsDone + 1} of ${s.total}, current hole is ${kind}`;
}
