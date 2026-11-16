// Crochet Round Tracker: the stitch wheel as an SVG string.
// One slice per hole of the round below (one per stitch for a magic-ring round).
// Colours come from CSS classes (see style.css), so the wheel follows the theme.

import { slices, roundState } from './model.js';

const TAU = Math.PI * 2;
const R = 100; // outer radius
const R0 = 50; // inner radius
const START = -Math.PI / 2; // slice 0 starts at 12 o'clock

const f = (n) => Math.round(n * 100) / 100;
const pt = (r, a) => `${f(r * Math.cos(a))} ${f(r * Math.sin(a))}`;

function sector(a0, a1) {
  if (a1 - a0 >= TAU - 1e-6) {
    // a single slice: a full ring drawn as two halves
    const m = a0 + Math.PI;
    return `M${pt(R, a0)}A${R} ${R} 0 1 1 ${pt(R, m)}A${R} ${R} 0 1 1 ${pt(R, a0)}` +
      `M${pt(R0, a0)}A${R0} ${R0} 0 1 0 ${pt(R0, m)}A${R0} ${R0} 0 1 0 ${pt(R0, a0)}Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(R, a0)}A${R} ${R} 0 ${large} 1 ${pt(R, a1)}L${pt(R0, a1)}A${R0} ${R0} 0 ${large} 0 ${pt(R0, a0)}Z`;
}

function fontSize(n) {
  if (n <= 8) return 17;
  if (n <= 14) return 13;
  if (n <= 24) return 10;
  if (n <= 40) return 7.5;
  if (n <= 64) return 5.5;
  return 4;
}

/** SVG markup for a round at a given stepsDone. */
export function wheelSVG(round, stepsDone) {
  const sl = slices(round, stepsDone);
  const s = roundState(round, stepsDone);
  const n = sl.length;
  const step = TAU / Math.max(n, 1);
  const fs = fontSize(n);
  const mid = (R + R0) / 2;

  const fills = [];
  const labels = [];
  const dividers = [];

  sl.forEach((slice, i) => {
    const a0 = START + i * step;
    const a1 = a0 + step;
    fills.push(`<path class="sl sl-${slice.state}" d="${sector(a0, a1)}"/>`);

    // label: once per stitch; a dec's label sits across its two slices
    if (slice.decPart !== 1) {
      const span = slice.decPart === 0 ? 2 : 1;
      const am = a0 + (step * span) / 2;
      const rot = ((am * 180) / Math.PI + 90) % 360;
      const upright = rot > 90 && rot < 270 ? rot + 180 : rot;
      const [x, y] = pt(mid, am).split(' ');
      const size = slice.label === 'dec' ? fs * 0.8 : fs;
      labels.push(
        `<text class="lb lb-${slice.state}" x="${x}" y="${y}" font-size="${f(size)}" ` +
        `transform="rotate(${f(upright)} ${x} ${y})">${slice.label}</text>`,
      );
    }

    if (n > 1) {
      let cls = 'dv';
      if (slice.repeatStart || (slice.sixStart && n > 6)) cls = 'dv dv-thick';
      else if (slice.decPart === 1) cls = 'dv dv-dash';
      dividers.push(`<line class="${cls}" x1="${pt(R0, a0).split(' ')[0]}" y1="${pt(R0, a0).split(' ')[1]}" x2="${pt(R, a0).split(' ')[0]}" y2="${pt(R, a0).split(' ')[1]}"/>`);
    }
  });

  // the current slice gets an outline drawn on top so it never hides under neighbours
  const cur = sl.findIndex((x) => x.state === 'current');
  let outline = '';
  if (cur >= 0) {
    const span = sl[cur].decPart === 0 ? 2 : 1;
    const a0 = START + cur * step;
    outline = `<path class="sl-outline" d="${sector(a0, a0 + step * span)}"/>`;
  }

  // marker dot at slice 0, just outside the rim
  const am = START + step / 2;
  const [mx, my] = pt(R + 7, n > 0 ? am : START).split(' ');
  const marker = `<circle class="marker" cx="${mx}" cy="${my}" r="5"/>`;

  const centre =
    `<circle class="hub" r="${R0 - 1}"/>` +
    `<text class="ct-big" y="2">${s.vsMade} / ${s.total}</text>` +
    `<text class="ct-small" y="22">V's made</text>`;

  return (
    `<svg viewBox="-116 -116 232 232" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    `<g>${fills.join('')}</g><g>${dividers.join('')}</g>` +
    `<circle class="rim" r="${R}"/><circle class="rim" r="${R0}"/>` +
    `${outline}<g>${labels.join('')}</g>${marker}${centre}</svg>`
  );
}
