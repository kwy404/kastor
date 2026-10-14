// Scene art: the wordmark, the log dam and the README banners.
import { C, kasParts, stickerFilter } from './mascot.mjs';

export const THEMES = {
  light: { bg: '#f6f1e4', grid: '#dbe3f1', grid2: '#c3d1ea', ink: '#13254d', muted: '#4a5b80', line: '#2a63e6', frame: '#13254d', water: '#4f86ef', water2: '#2a63e6', foam: '#ffffff', chipBg: '#ffffff', chipInk: '#13254d' },
  dark: { bg: '#0a1d45', grid: '#123068', grid2: '#1b3f82', ink: '#eef3ff', muted: '#a9bde6', line: '#8fb2ff', frame: '#cfe0ff', water: '#2a63e6', water2: '#1b45b0', foam: '#cfe0ff', chipBg: '#10295e', chipInk: '#eef3ff' },
};

export const WORDMARK_PATHS = [
  'M0 -150 V0', 'M0 -38 L54 -100', 'M20 -60 L60 0',
  'M98 -50 A46 46 0 1 0 190 -50 A46 46 0 1 0 98 -50', 'M190 -100 V0',
  'M292 -84 C284 -98 262 -102 246 -100 C224 -96 218 -72 236 -62 C250 -54 280 -54 290 -36 C298 -16 282 2 258 2 C240 2 226 -6 222 -16',
  'M346 -140 V-28 C346 -8 358 0 378 -4', 'M326 -100 H374',
  'M414 -50 A46 46 0 1 0 506 -50 A46 46 0 1 0 414 -50',
  'M548 -100 V0', 'M548 -50 C548 -86 572 -102 608 -98',
];
/** The kastor wordmark: monoline rounded letters, baseline at y 0, 608 wide, 150 tall. */
export function wordmark(color, sw = 24) {
  return `<g fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

/** One log seen from the side: bark body, grain and a ring end cap on the left. */
export function log(x, y, w, h, opts = {}) {
  const r = h / 2;
  const bark = opts.bark || '#a2683a';
  const barkDark = opts.barkDark || '#7d4c27';
  const end = opts.end || '#efc58c';
  const ring = opts.ring || '#c98f52';
  const ink = opts.ink || C.ink;
  const label = opts.label
    ? `<text x="${x + r + 16}" y="${y + h / 2 + 4.5}" font-family="ui-monospace, Cascadia Code, Consolas, monospace" font-size="${Math.round(h * 0.42)}" font-weight="600" fill="#fff3df" opacity=".92">${opts.label}</text>`
    : '';
  return `<g>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${bark}" stroke="${ink}" stroke-width="4"/>
<path d="M${x + r + 8} ${y + h * 0.3} H${x + w - r - 10} M${x + r + 30} ${y + h * 0.72} H${x + w - r - 26}" stroke="${barkDark}" stroke-width="3" stroke-linecap="round" opacity="${label ? 0.35 : 0.8}"/>
<ellipse cx="${x + r}" cy="${y + r}" rx="${r * 0.82}" ry="${r}" fill="${end}" stroke="${ink}" stroke-width="4"/>
<ellipse cx="${x + r}" cy="${y + r}" rx="${r * 0.5}" ry="${r * 0.6}" fill="none" stroke="${ring}" stroke-width="2.5"/>
<ellipse cx="${x + r}" cy="${y + r}" rx="${r * 0.2}" ry="${r * 0.24}" fill="${ring}"/>
${label}</g>`;
}

/** One log seen end on: the bark ring, the cut face and its growth rings. */
export function logEnd(cx, cy, r, ink = C.ink) {
  return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#9a6034" stroke="${ink}" stroke-width="${Math.max(2.5, r * 0.18)}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.74}" fill="#efc58c"/><circle cx="${cx}" cy="${cy}" r="${r * 0.48}" fill="none" stroke="#c98f52" stroke-width="${Math.max(1.4, r * 0.1)}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#c98f52"/></g>`;
}

/**
 * The dam in cross section, the way a drawing would show it: logs seen end
 * on and stacked in rows, high water upstream on the right, a calm stream
 * downstream on the left. Local box: width w, height h; base row of n logs.
 */
export function dam({ w = 320, h = 220, n = 5, t = THEMES.light, dims = true } = {}) {
  const r = Math.min(h / (n * 1.9 + 1), w / (n * 2 + 5));
  const base = h - 10 - r;
  const x0 = r * 2.2;
  const out = [];
  const topY = base - (n - 1) * r * 1.72;
  const surf = topY + r * 0.6;
  const rightX = x0 + (n - 1) * 2 * r;
  // upstream water (right), behind the logs
  out.push(`<path d="M${x0 + (n - 1) * r} ${surf} C ${rightX + r * 1.5} ${surf - 7}, ${rightX + r * 3} ${surf + 7}, ${rightX + r * 4.5} ${surf} S ${w - 10} ${surf - 6}, ${w} ${surf} V ${h - 6} H ${x0 + r} Z" fill="${t.water}"/>`);
  const fx = rightX + r * 1.3;
  const fw = w - fx;
  out.push(`<path d="M${fx + fw * 0.1} ${surf + 22} c 9 -5 18 -5 27 0 M${fx + fw * 0.45} ${surf + 40} c 9 -5 18 -5 27 0 M${fx + fw * 0.2} ${surf + 62} c 9 -5 18 -5 27 0" stroke="${t.foam}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".65"/>`);
  // downstream stream (left)
  out.push(`<path d="M0 ${h - 22} C ${x0 * 0.6} ${h - 26}, ${x0} ${h - 18}, ${x0 + r} ${h - 22} V ${h - 6} H 0 Z" fill="${t.water}" opacity=".75"/>`);
  for (let row = 0; row < n; row++) {
    const count = n - row;
    for (let i = 0; i < count; i++) out.push(logEnd(x0 + row * r + i * 2 * r, base - row * r * 1.72, r));
  }
  out.push(`<path d="M0 ${h - 6} H ${w}" stroke="${t.ink}" stroke-width="3" stroke-linecap="round" opacity=".55"/>`);
  out.push(`<path d="M${w - 2} ${h - 6} l -10 10 M${w - 26} ${h - 6} l -10 10 M${w - 50} ${h - 6} l -10 10 M14 ${h - 6} l -10 10 M38 ${h - 6} l -10 10" stroke="${t.ink}" stroke-width="2" opacity=".35"/>`);
  if (dims) {
    const dx = x0 - r - 14;
    out.push(`<g stroke="${t.line}" stroke-width="1.6" fill="none"><path d="M${dx - 6} ${topY - r} H${dx + 6} M${dx - 6} ${base + r} H${dx + 6} M${dx} ${topY - r} V${base + r}"/><path d="M${dx - 4} ${topY - r + 8} L${dx} ${topY - r} L${dx + 4} ${topY - r + 8} M${dx - 4} ${base + r - 8} L${dx} ${base + r} L${dx + 4} ${base + r - 8}"/></g>`);
    out.push(`<text x="${dx - 8}" y="${(topY + base) / 2}" transform="rotate(-90 ${dx - 8} ${(topY + base) / 2})" text-anchor="middle" font-family="ui-monospace, Cascadia Code, Consolas, monospace" font-size="11" fill="${t.line}">${n} rows</text>`);
    out.push(`<text x="${w - 4}" y="${surf - 12}" text-anchor="end" font-family="ui-monospace, Cascadia Code, Consolas, monospace" font-size="11" fill="${t.line}">your data</text>`);
  }
  return out.join('');
}

function grid(W, H, t, step = 20) {
  return `<defs><pattern id="g-minor" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><path d="M${step} 0 H0 V${step}" fill="none" stroke="${t.grid}" stroke-width="1"/></pattern><pattern id="g-major" width="${step * 5}" height="${step * 5}" patternUnits="userSpaceOnUse"><rect width="${step * 5}" height="${step * 5}" fill="url(#g-minor)"/><path d="M${step * 5} 0 H0 V${step * 5}" fill="none" stroke="${t.grid2}" stroke-width="1.4"/></pattern></defs><rect width="${W}" height="${H}" fill="${t.bg}"/><rect width="${W}" height="${H}" fill="url(#g-major)"/>`;
}

function frameMarks(W, H, t) {
  const m = 14;
  const k = 22;
  const c = `stroke="${t.frame}" stroke-width="2" fill="none" opacity=".55"`;
  return `<rect x="${m}" y="${m}" width="${W - m * 2}" height="${H - m * 2}" ${c}/><rect x="${m + 6}" y="${m + 6}" width="${W - m * 2 - 12}" height="${H - m * 2 - 12}" stroke="${t.frame}" stroke-width="1" fill="none" opacity=".3"/>
<path d="M${m} ${m + k} V${m} H${m + k} M${W - m - k} ${m} H${W - m} V${m + k} M${W - m} ${H - m - k} V${H - m} H${W - m - k} M${m + k} ${H - m} H${m} V${H - m - k}" stroke="${t.line}" stroke-width="4" fill="none"/>`;
}

/** A dimension marker: a measured line with ticks, arrows and a label. */
export function dimension(x1, x2, y, label, t, size = 15) {
  const mid = (x1 + x2) / 2;
  const tw = label.length * size * 0.6 + 16;
  return `<g stroke="${t.line}" stroke-width="2" fill="none">
<path d="M${x1} ${y - 10} V${y + 10} M${x2} ${y - 10} V${y + 10}"/>
<path d="M${x1} ${y} H${mid - tw / 2} M${mid + tw / 2} ${y} H${x2}"/>
<path d="M${x1 + 10} ${y - 5} L${x1} ${y} L${x1 + 10} ${y + 5} M${x2 - 10} ${y - 5} L${x2} ${y} L${x2 - 10} ${y + 5}" stroke-linejoin="round"/>
</g><text x="${mid}" y="${y + size * 0.35}" text-anchor="middle" font-family="ui-monospace, Cascadia Code, Consolas, monospace" font-size="${size}" fill="${t.line}">${label}</text>`;
}

const SANS = 'Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';

/** README banner, 1280 by 400. */
export function banner(mode = 'light') {
  const t = THEMES[mode];
  const W = 1280;
  const H = 400;
  const rim = mode === 'dark' ? stickerFilter('kas-rim', '#fff4df', 9) : '';
  const chips = ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server', 'Oracle', 'MongoDB', '+4'];
  let cx = 382;
  const chipEls = chips
    .map((c) => {
      const w = c.length * 8.6 + 26;
      const el = `<g><rect x="${cx}" y="300" width="${w}" height="30" rx="15" fill="${t.chipBg}" stroke="${t.line}" stroke-width="1.5"/><text x="${cx + w / 2}" y="320" text-anchor="middle" font-family="${SANS}" font-size="14.5" font-weight="600" fill="${t.chipInk}">${c}</text></g>`;
      cx += w + 8;
      return el;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="bn-title bn-desc"><title id="bn-title">kastor</title><desc id="bn-desc">Kas the beaver engineer next to the kastor wordmark: the TypeScript ORM for almost every database.</desc>
${grid(W, H, t)}
<defs>${rim}</defs>
${frameMarks(W, H, t)}
<g transform="translate(1004 112)">${dam({ w: 248, h: 252, n: 5, t })}</g>
<g transform="translate(40 52) scale(0.62)"><ellipse cx="262" cy="482" rx="170" ry="14" fill="${C.ink}" opacity="${mode === 'dark' ? 0.35 : 0.12}"/><g${mode === 'dark' ? ' filter="url(#kas-rim)"' : ''}>${kasParts()}</g></g>
${dimension(382, 382 + 608 * 0.62, 72, 'castor: Latin for beaver', t, 14)}
<g transform="translate(382 202) scale(0.62)">${wordmark(t.ink, 26)}</g>
<text x="382" y="264" font-family="${SANS}" font-size="28" font-weight="600" fill="${t.ink}">The TypeScript ORM for almost every database</text>
${chipEls}
<text x="${W - 34}" y="${H - 26}" text-anchor="end" font-family="ui-monospace, Cascadia Code, Consolas, monospace" font-size="12" fill="${t.muted}">SHEET 01  SCALE 1:1  KASTOR 0.1.0</text>
</svg>`;
}

/**
 * The signature drawing for the site hero: a river in longitudinal section,
 * held by a dam of log rows, with ten databases downstream. Colors come from
 * CSS variables so the same markup works on drafting paper and blueprint.
 */
export function riverScene(dbSymbols, kas) {
  const W = 1200;
  const H = 330;
  const bed = 300;
  const r = 17;
  const n = 6;
  const dx0 = 470;
  const logs = [];
  for (let row = 0; row < n; row++) {
    for (let i = 0; i < n - row; i++) logs.push(logEnd(dx0 + row * r + i * 2 * r, bed - r - row * r * 1.72, r));
  }
  const damTop = bed - r - (n - 1) * r * 1.72 - r;
  const damRight = dx0 + (n - 1) * 2 * r + r;
  const up = 132;
  const down = 252;
  const wave = (x1, x2, y, amp = 5, step = 60) => {
    let d = `M${x1} ${y}`;
    for (let x = x1; x < x2; x += step) d += ` q ${step / 4} ${-amp} ${step / 2} 0 t ${step / 2} 0`;
    return d;
  };
  const cyl = dbSymbols
    .map((s, i) => {
      const col = i % 5;
      const rowi = Math.floor(i / 5);
      const x = 902 + col * 56 + rowi * 28;
      const y = 112 + rowi * 52;
      return `<svg x="${x}" y="${y}" width="44" height="44" viewBox="0 0 48 48">${s}</svg>`;
    })
    .join('');
  const floats = [
    [60, up - 6, 'row 41'],
    [196, up + 2, 'row 42'],
    [326, up - 4, 'row 43'],
  ]
    .map(([x, y, label]) => `<g class="rv-float" style="--d:${x / 40}s">${log(x, y - 10, 104, 22, { label })}</g>`)
    .join('');
  return `<svg class="river" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="rv-t rv-d" preserveAspectRatio="xMidYMax meet"><title id="rv-t">The kastor dam</title><desc id="rv-d">A technical drawing of a river: your application's rows float in from upstream, a dam built from log rows holds them, and ten databases sit downstream.</desc>
<defs><clipPath id="rv-up"><rect x="0" y="${up - 12}" width="${dx0 + r}" height="${bed - up + 12}"/></clipPath><clipPath id="rv-down"><rect x="${damRight - 20}" y="${down - 12}" width="${900 - damRight + 20}" height="${bed - down + 12}"/></clipPath></defs>
<g clip-path="url(#rv-up)"><path class="rv-water rv-wave" d="${wave(-120, dx0 + 140, up)} V ${bed} H -120 Z"/></g>
<path class="rv-hatch" d="M0 ${up + 34} H ${dx0 - 20} M0 ${up + 74} H ${dx0 - 30} M0 ${up + 114} H ${dx0 - 40}" />
<g clip-path="url(#rv-down)"><path class="rv-water rv-water-low rv-wave" d="${wave(damRight - 140, 1000, down, 4, 50)} V ${bed} H ${damRight - 140} Z"/></g>
<path class="rv-bank" d="M880 ${bed} L 880 ${down - 4} C 890 190, 894 152, 902 150 H ${W} V ${bed} Z"/>
<path class="rv-pipe" d="M${damRight - 6} ${bed - 14} H 862 C 878 ${bed - 14}, 884 ${bed - 30}, 892 ${bed - 52} L 896 230"/>
${cyl}
${floats}
${logs.join('')}
<g transform="translate(${dx0 + (n - 1) * r - 46} ${damTop - 108}) scale(0.2)">${kas}</g>
<path class="rv-ground" d="M0 ${bed} H ${W}"/>
<path class="rv-ground-hatch" d="${Array.from({ length: 50 }, (_, i) => `M${i * 24 + 10} ${bed} l -10 12`).join(' ')}"/>
<g class="rv-dim">
  <path d="M${dx0 - r} ${bed + 22} V ${bed + 30} M${damRight} ${bed + 22} V ${bed + 30} M${dx0 - r} ${bed + 26} H ${damRight}"/>
  <path d="M${dx0 - r + 8} ${bed + 22} L ${dx0 - r} ${bed + 26} L ${dx0 - r + 8} ${bed + 30} M${damRight - 8} ${bed + 22} L ${damRight} ${bed + 26} L ${damRight - 8} ${bed + 30}"/>
  <path d="M${damRight + 26} ${damTop} H ${damRight + 40} M${damRight + 26} ${bed} H ${damRight + 40} M${damRight + 33} ${damTop} V ${bed}"/>
  <path d="M${damRight + 29} ${damTop + 8} L ${damRight + 33} ${damTop} L ${damRight + 37} ${damTop + 8} M${damRight + 29} ${bed - 8} L ${damRight + 33} ${bed} L ${damRight + 37} ${bed - 8}"/>
</g>
<g class="rv-label">
  <text x="${(dx0 - r + damRight) / 2}" y="${bed + 24}" text-anchor="middle" dy="0">one TypeScript schema</text>
  <text x="${damRight + 48}" y="${(damTop + bed) / 2}">${n} rows of logs</text>
  <text x="18" y="${up - 34}">UPSTREAM: your app</text>
  <text x="${W - 18}" y="92" text-anchor="end">DOWNSTREAM: 10 databases</text>
</g>
</svg>`;
}
