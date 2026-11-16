// Crochet Round Tracker: pattern text -> pieces -> rounds -> items.
// Pure module: no DOM, no storage. Tested with `node --test`.
//
// Item shape: { type, rep, firstInRepeat, hole, span, text? }
//   type  'ring' | 'sc' | 'inc' | 'dec' | 'text'
//   rep   0-based repeat number this item belongs to, or null outside a repeat
//   hole  index of the first hole (in the round below) this item uses
//   span  holes used: ring 0, sc 1, inc 1, dec 2, text 1

export const SPAN = { ring: 0, sc: 1, inc: 1, dec: 2, text: 1 };
export const VS = { ring: 1, sc: 1, inc: 2, dec: 1, text: 1 };

const KNOWN = new Set(['sc', 'inc', 'dec']);

// Words that carry no stitch meaning in a round line ("sc in each st around").
const FILLER = new Set([
  'in', 'into', 'each', 'every', 'st', 'sts', 'stitch', 'stitches', 'the', 'next',
  'of', 'a', 'an', 'and', 'then', 'work', 'make', 'blo', 'flo', 'bl', 'fl',
  'repeat', 'rep', 'from', 'all', 'evenly', 'loop', 'loops', 'back', 'front', 'only',
  'total', 'more',
]);

const LABEL_RE =
  /^\s*(?:rounds|round|rnds|rnd|rds|rd|r)\s*\.?\s*(\d+)(?:\s*(?:-|to)\s*(?:(?:rounds|round|rnds|rnd|rd|r)\s*\.?\s*)?(\d+))?\s*(?:[:.)]\s*|\s+|$)/i;

const COUNT_RE =
  /\(\s*(\d+)\s*(?:sts?|stitch(?:es)?)?\s*\)|\[\s*(\d+)\s*(?:sts?|stitch(?:es)?)?\s*\]|=\s*(\d+)(?:\s*(?:sts?|stitch(?:es)?)\b)?/i;

const RING_RE =
  /\b(?:in(?:to)?\s+(?:an?\s+|the\s+)?)?(?:magic\s+(?:ring|circle|loop)|adjustable\s+ring|mr|ring)\b/g;

/** Normalise dashes, multiplication signs and stitch synonyms. */
export function normalise(s) {
  return s
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/×/g, ' x ')
    .replace(/\bsingle\s+crochets?\b/g, 'sc')
    .replace(/\b(?:invisible\s+decreases?|inv\.?\s*decs?|invdecs?|sc\s*2\s*tog|decreases?|decs)\b/g, 'dec')
    .replace(/\b(?:increases?|incs)\b/g, 'inc')
    .replace(/\bscs\b/g, 'sc')
    // "2 sc in each st" / "2 sc in next st" is an increase
    .replace(/\b2\s*sc\s+in\s+(?:the\s+)?(?:same|next|one|each|every)\s+(?:st|stitch|sc)\b/g, 'inc')
    // trailing "times" after a number: "(sc, inc) 6 times" -> "x 6"
    .replace(/\b(\d+)\s*times\b/g, ' x $1 ');
}

/** Split normalised text into tokens: num, word, times, punct. */
export function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue; }
    if ((m = /^\d+/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); }
    else if ((m = /^(?:\*|x(?![a-z]))/.exec(rest))) { out.push({ t: 'times' }); }
    else if ((m = /^[a-z][a-z']*/.exec(rest))) {
      // "r6" inside a note stays one word; "sc" stays "sc"
      const d = /^\d+/.exec(rest.slice(m[0].length));
      if (d && !['sc', 'inc', 'dec'].includes(m[0])) m = [m[0] + d[0]];
      out.push({ t: 'word', v: m[0] });
    }
    else if ((m = /^[()[\]]/.exec(rest))) { out.push({ t: m[0] }); }
    else if ((m = /^[,;+&]/.exec(rest))) { out.push({ t: ',' }); }
    else { m = [rest[0]]; out.push({ t: 'junk', v: rest[0] }); }
    i += m[0].length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Body grammar (recursive descent)
//   body  = group (, group)*
//   group = term | ( body ) times | [ body ] times | N times group
//   term  = [N] op [N] [around] [times]
// A node is { kind: 'op', op, n, around, text? } or { kind: 'group', body, times }.

function parseBody(tokens) {
  let pos = 0;
  const peek = (k = 0) => tokens[pos + k];
  const isWord = (tok) => tok && tok.t === 'word';

  function skipFiller() {
    while (isWord(peek()) && FILLER.has(peek().v)) pos++;
  }

  function parseTimes() {
    // (* | x) N
    if (peek() && peek().t === 'times' && peek(1) && peek(1).t === 'num') {
      const n = peek(1).v;
      pos += 2;
      return n;
    }
    return null;
  }

  function parseSeq(close) {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = peek();
      if (close && tok.t === close) break;
      if (tok.t === ',' || tok.t === 'junk' || tok.t === ')' || tok.t === ']') { pos++; continue; }
      const before = pos;
      const node = parseGroup();
      if (node) nodes.push(node);
      if (pos === before) pos++; // never stall on a stray token
    }
    return nodes;
  }

  function parseGroup() {
    skipFiller();
    const tok = peek();
    if (!tok) return null;

    // N x ( ... )   /   N x inc
    if (tok.t === 'num' && peek(1) && peek(1).t === 'times' && !(peek(2) && peek(2).t === 'num')) {
      const times = tok.v;
      pos += 2;
      const inner = parseGroup();
      return inner ? { kind: 'group', body: [inner], times } : null;
    }

    if (tok.t === '(' || tok.t === '[') {
      const close = tok.t === '(' ? ')' : ']';
      pos++;
      const body = parseSeq(close);
      if (peek() && peek().t === close) pos++;
      skipFiller();
      let times = parseTimes();
      if (times == null) times = 1;
      if (body.length === 0) return null; // "(BLO)" and other empty asides
      return { kind: 'group', body, times };
    }

    return parseTerm();
  }

  function parseTerm() {
    let n = null;
    if (peek() && peek().t === 'num') { n = peek().v; pos++; skipFiller(); }
    const tok = peek();

    let node;
    if (isWord(tok) && (KNOWN.has(tok.v) || tok.v === 'around')) {
      pos++;
      if (tok.v === 'around') {
        node = { kind: 'op', op: 'sc', n: null, around: true };
      } else {
        node = { kind: 'op', op: tok.v, n: null, around: false };
      }
    } else if (isWord(tok)) {
      // unknown stitch or instruction: swallow consecutive unknown words
      const words = [];
      while (isWord(peek()) && !KNOWN.has(peek().v) && peek().v !== 'around') {
        if (!FILLER.has(peek().v)) words.push(peek().v);
        pos++;
      }
      node = { kind: 'op', op: 'text', text: words.join(' '), n: null, around: false };
    } else {
      // bare number: "R1: MR 6" -> n sc; resolved by the caller
      if (n != null) return { kind: 'op', op: 'bare', n, around: false };
      return null;
    }

    skipFiller();
    if (peek() && peek().t === 'num' && n == null && !(peek(1) && peek(1).t === 'times')) {
      n = peek().v; pos++; skipFiller();
    }
    if (isWord(peek()) && peek().v === 'around') { node.around = true; pos++; skipFiller(); }
    const times = parseTimes();
    node.n = (n ?? 1) * (times ?? 1);
    node.explicitN = n != null || times != null;
    node.times = times;
    if (node.op === 'text' && !node.text) node.text = 'stitch';
    return node;
  }

  return parseSeq(null);
}

/** Round's V's from a list of items. */
export function vsOf(items) {
  return items.reduce((s, it) => s + VS[it.type], 0);
}

/** Holes used from a list of items. */
export function holesOf(items) {
  return items.reduce((s, it) => s + it.span, 0);
}

/**
 * Turn nodes into the flat item list.
 * ctx: { ring, prevVs }
 */
function flatten(nodes, ctx) {
  const items = [];
  let repCounter = 0;

  function push(type, rep, extra) {
    const firstInRepeat = rep != null && !items.some((it) => it.rep === rep);
    items.push({ type, rep, firstInRepeat, hole: 0, span: SPAN[type], ...extra });
  }

  function emitOp(node, rep) {
    let { op, n } = node;
    if (op === 'bare') op = 'sc';
    if (node.around) {
      const holes = ctx.prevVs;
      if (holes != null) {
        n = op === 'dec' ? Math.floor(holes / 2) : holes;
      } else if (ctx.stated != null) {
        n = op === 'inc' ? Math.floor(ctx.stated / 2) : ctx.stated;
      }
    }
    for (let i = 0; i < n; i++) {
      if (op === 'text') push('text', rep, { text: node.text });
      else push(op, rep);
    }
  }

  function walk(list, rep) {
    for (const node of list) {
      if (node.kind === 'group') {
        for (let t = 0; t < node.times; t++) {
          const r = rep != null ? rep : node.times > 1 ? repCounter++ : null;
          walk(node.body, r);
        }
      } else if (rep == null && node.times > 1 && node.op !== 'sc' && node.op !== 'bare') {
        // inc*6, dec x6: each one is a repeat; "sc*24" stays a plain run
        const one = { ...node, n: node.n / node.times };
        for (let t = 0; t < node.times; t++) emitOp(one, repCounter++);
      } else if (rep == null && node.op === 'inc' && node.n > 1 && !node.around) {
        // "6 inc" reads like inc*6
        const one = { ...node, n: 1 };
        for (let t = 0; t < node.n; t++) emitOp(one, repCounter++);
      } else {
        emitOp(node, rep);
      }
    }
  }
  walk(nodes, null);

  if (ctx.ring) {
    // everything goes into the ring: inc becomes two ring sc
    const ringItems = [];
    for (const it of items) {
      const copies = it.type === 'inc' ? 2 : 1;
      for (let c = 0; c < copies; c++) {
        const type = it.type === 'text' ? 'text' : 'ring';
        ringItems.push({ ...it, type, span: 0, firstInRepeat: it.firstInRepeat && c === 0 });
      }
    }
    items.length = 0;
    items.push(...ringItems);
  }

  let hole = 0;
  for (const it of items) { it.hole = hole; hole += it.span; }
  return { items, repeats: repCounter };
}

/**
 * Parse one round body (the text after the label).
 * ctx: { prevVs } - V's made by the round below, or null.
 * Returns { items, stated, note, ring, repeats, unknown: string[], known }.
 */
export function parseRoundBody(bodyText, ctx = {}) {
  let body = bodyText;
  let stated = null;
  let note = '';

  const m = COUNT_RE.exec(body);
  if (m) {
    stated = Number(m[1] ?? m[2] ?? m[3]);
    note = body.slice(m.index + m[0].length);
    body = body.slice(0, m.index);
  }
  note = note.replace(/^[\s,.;:)\]-]+/, '').replace(/^(?:sts?|stitch(?:es)?)\b\s*/i, '').trim();

  let norm = normalise(body);
  let ring = false;
  norm = norm.replace(RING_RE, () => { ring = true; return ' '; });

  const nodes = parseBody(tokenize(norm));
  const { items, repeats } = flatten(nodes, { ring, prevVs: ctx.prevVs ?? null, stated });

  const textItems = items.filter((it) => it.type === 'text');
  const knownItems = items.filter((it) => it.type !== 'text');
  const unknown = [...new Set(textItems.map((it) => it.text))];

  let finalItems = items;
  if (textItems.length && stated != null) {
    const knownVs = vsOf(knownItems);
    const textNodes = nodes.filter((n) => n.kind === 'op' && n.op === 'text');
    if (knownVs === stated) {
      // the stitches already add up: unknown words are just remarks
      finalItems = knownItems;
      note = [unknown.join(', '), note].filter(Boolean).join(' · ');
    } else if (!knownItems.length && textNodes.length === 1 && !textNodes[0].explicitN && !textNodes[0].around) {
      // "R7: puff stitches (12)": the count says how many
      const t = textItems[0];
      finalItems = Array.from({ length: stated }, () => ({ ...t, rep: null, firstInRepeat: false }));
    }
    let hole = 0;
    for (const it of finalItems) { it.hole = hole; hole += it.span; }
  }

  return {
    items: finalItems,
    stated,
    note,
    ring,
    repeats: finalItems.some((it) => it.rep != null) ? repeats : 0,
    unknown: finalItems.some((it) => it.type === 'text') ? unknown : [],
    known: knownItems.length > 0,
  };
}

function cleanHeader(line) {
  return line.replace(/^#+/, '').replace(/[:*_]+$/, '').replace(/^[*_]+/, '').trim();
}

/**
 * Parse a whole pattern.
 * Returns {
 *   pieces: [{ name, notes: string[], rounds: Round[] }],
 *   warnings: [{ line, message }]   // only "couldn't read" warnings; counts are checked in model.js
 * }
 * Round: { key, piece, number, label, line, lineNo, items, stated, ring, repeats, notes, unknown }
 */
export function parsePattern(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const pieces = [];
  const warnings = [];
  let piece = null;
  let lastRound = null;

  const newPiece = (name) => {
    let unique = name || `Piece ${pieces.length + 1}`;
    let k = 2;
    while (pieces.some((p) => p.name === unique)) unique = `${name} (${k++})`;
    piece = { name: unique, notes: [], rounds: [], implicit: !name };
    pieces.push(piece);
    lastRound = null;
    return piece;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line) return;

    // Piece headers: "# Belly", "Body:"
    const label = LABEL_RE.exec(line);
    if (/^#/.test(line) || (!label && /:\s*[*_]*$/.test(line) && line.split(/\s+/).length <= 6)) {
      newPiece(cleanHeader(line));
      return;
    }

    const prevVs = lastRound ? vsOf(lastRound.items) : null;

    if (label) {
      const from = Number(label[1]);
      const to = label[2] != null ? Number(label[2]) : from;
      const body = line.slice(label[0].length);
      const parsed = parseRoundBody(body, { prevVs });
      if (!piece) { newPiece('Main'); piece.implicit = true; }
      if (to < from || to - from > 500) {
        warnings.push({ line: lineNo, message: `Line ${lineNo}: the round range "${line.slice(0, label[0].length).trim()}" runs backwards; read it as one round.` });
      }
      const last = to < from || to - from > 500 ? from : to;
      if (!parsed.items.length) {
        warnings.push({ line: lineNo, message: `Line ${lineNo}: couldn't find any stitches in "${line}"; kept as a note.` });
        (lastRound ? lastRound.notes : piece.notes).push(line);
        return;
      }
      if (parsed.unknown.length) {
        warnings.push({ line: lineNo, message: `Line ${lineNo}: didn't recognise "${parsed.unknown.join('", "')}"; it's shown as a plain step.` });
      }
      for (let n = from; n <= last; n++) {
        let p = parsed;
        if (n > from) {
          // "sc around" in a range can depend on the round before
          p = parseRoundBody(body, { prevVs: vsOf(lastRound.items) });
        }
        const round = {
          key: '',
          piece: piece.name,
          number: n,
          label: `R${n}`,
          line,
          lineNo,
          items: p.items,
          stated: p.stated,
          ring: p.ring,
          repeats: p.repeats,
          notes: p.note ? [p.note] : [],
          unknown: p.unknown,
        };
        let key = `${piece.name}/${n}`;
        let k = 2;
        while (piece.rounds.some((r) => r.key === key)) key = `${piece.name}/${n}#${k++}`;
        round.key = key;
        piece.rounds.push(round);
        lastRound = round;
      }
      return;
    }

    // No label: a round if it reads cleanly as stitches, otherwise a note.
    const parsed = parseRoundBody(line, { prevVs });
    if (parsed.known && !parsed.unknown.length && parsed.items.length) {
      if (!piece) { newPiece('Main'); piece.implicit = true; }
      const n = lastRound ? lastRound.number + 1 : 1;
      let key = `${piece.name}/${n}`;
      let k = 2;
      while (piece.rounds.some((r) => r.key === key)) key = `${piece.name}/${n}#${k++}`;
      const round = {
        key, piece: piece.name, number: n, label: `R${n}`, line, lineNo,
        items: parsed.items, stated: parsed.stated, ring: parsed.ring, repeats: parsed.repeats,
        notes: parsed.note ? [parsed.note] : [], unknown: [],
      };
      piece.rounds.push(round);
      lastRound = round;
      return;
    }

    if (lastRound) {
      lastRound.notes.push(line);
    } else {
      if (!piece) { newPiece('Main'); piece.implicit = true; }
      piece.notes.push(line);
      if (piece.implicit) warnings.push({ line: lineNo, message: `Line ${lineNo}: not a round, kept as a note: "${line}".` });
    }
  });

  // Drop headers that never got any rounds ("Materials:"), keeping their notes nowhere.
  const kept = pieces.filter((p) => p.rounds.length);
  for (const p of kept) delete p.implicit;
  if (!kept.length && lines.some((l) => l.trim())) {
    warnings.push({ line: 0, message: 'No rounds found. Start each round with a label like "R1:".' });
  }
  return { pieces: kept, warnings };
}
