// The kastor mark: a K built like a beaver builds, from logs. The stem is a
// stack of four logs seen end on (four rows, cut ends forward) and the arms
// are two logs laid on the diagonal. The flat mark is the logo and favicon;
// the lit version is the glowing object in the hero, the banner and the
// social images.

export const ACCENT = { a: '#ffb547', b: '#f08a3c', c: '#d4622b', deep: '#7c3414', pale: '#ffe2b0' };

/** Geometry of the flat mark in a 32 by 32 box. */
const FLAT = {
  stem: { cx: 8.6, r: 3.35, ys: [4.7, 12.25, 19.75, 27.3] },
  join: [13.4, 16],
  arms: [
    [27.2, 4.7],
    [27.2, 27.3],
  ],
  w: 6.7,
};

/** The flat mark parts. Logs follow `body`; the cut ends use the accent gradient. */
export function logoParts({ body = 'currentColor', id = 'kmark-g' } = {}) {
  const { stem, join, arms, w } = FLAT;
  const cap = `url(#${id})`;
  const armPaths = arms.map(([x, y]) => `<path d="M${join[0]} ${join[1]} L${x} ${y}" stroke="${body}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
  const armEnds = arms.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${(w / 2 - 0.15).toFixed(2)}" fill="${body}"/>`).join('');
  const ends = stem.ys.map((y) => `<circle cx="${stem.cx}" cy="${y}" r="${stem.r}" fill="${cap}"/>`).join('');
  const defs = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACCENT.a}"/><stop offset="1" stop-color="${ACCENT.c}"/></linearGradient>`;
  return { defs, rows: `${armPaths}${armEnds}${ends}` };
}

/** The logo as an inline SVG. Arms follow currentColor. */
export function logo({ size = 24, cls = 'k-logo', id = 'kmark-g', title = '' } = {}) {
  const { defs, rows } = logoParts({ id });
  const label = title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 32 32" width="${size}" height="${size}"${label}><defs>${defs}</defs>${rows}</svg>`;
}

/** A standalone logo file. */
export function logoFile(mode = 'light') {
  const { defs, rows } = logoParts({ body: mode === 'dark' ? '#ededed' : '#171717', id: 'k' });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128" role="img" aria-label="kastor"><defs>${defs}</defs>${rows}</svg>`;
}

/** The favicon: the mark on a near black tile. */
export function favicon() {
  const { defs, rows } = logoParts({ body: '#ededed', id: 'fav-g' });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><title>kastor</title><defs>${defs}</defs><rect width="32" height="32" rx="7.5" fill="#0a0a0a"/><g transform="translate(16 16) scale(.74) translate(-16 -16)">${rows}</g></svg>`;
}

// ---------- The lit mark ----------

export const LIT = {
  dark: { hi: '#6b6b6b', mid: '#262626', lo: '#0c0c0c', side: '#1a1a1a', grain: '#ffffff', grainOp: 0.06, rim: '#ffc27a', rimOp: 0.7, edge: '#000000', edgeOp: 0.5, halo: 0.6 },
  light: { hi: '#ffffff', mid: '#ececec', lo: '#b4b4b4', side: '#d6d6d6', grain: '#000000', grainOp: 0.07, rim: '#f08a3c', rimOp: 0.55, edge: '#8c8c8c', edgeOp: 0.45, halo: 0.42 },
};

const f = (n) => Math.round(n * 100) / 100;

/** Rings on a cut end, centered at the origin. */
function rings(rx, ry) {
  return [0.84, 0.66, 0.48, 0.3, 0.13]
    .map((s, j) => `<ellipse cx="${f(rx * (1 - s) * 0.12)}" cy="${f(-ry * (1 - s) * 0.06)}" rx="${f(rx * s)}" ry="${f(ry * s)}" fill="none" stroke="${ACCENT.deep}" stroke-opacity="${f(0.16 + j * 0.07)}" stroke-width="${j > 2 ? 1.5 : 1.1}"/>`)
    .join('');
}

/**
 * The lit mark. `vars: true` reads the log colors from CSS variables
 * (--lm-hi and friends) so the inline hero follows the theme.
 */
export function litMark({ mode = 'dark', vars = false, id = 'lm', cls = 'lit-mark', glow = true } = {}) {
  const P = LIT[mode];
  const col = (name) => (vars ? `var(--lm-${name})` : P[name]);
  const W = 600;
  const H = 480;
  // Stem: four logs seen end on, receding up and to the right.
  const R = 42;
  const sx = 180;
  const gap = 4;
  const ys = [0, 1, 2, 3].map((i) => 96 + i * (2 * R + gap));
  const depth = [44, -30];
  const len = Math.hypot(...depth);
  const nx = (-depth[1] / len) * R;
  const ny = (depth[0] / len) * R;
  const stemBodies = ys
    .slice()
    .reverse()
    .map((y) => {
      const bx = sx + depth[0];
      const by = y + depth[1];
      return `<path d="M${f(sx + nx)} ${f(y + ny)} L${f(bx + nx)} ${f(by + ny)} A${R} ${R} 0 0 0 ${f(bx - nx)} ${f(by - ny)} L${f(sx - nx)} ${f(y - ny)} Z" fill="url(#${id}-side)"/><path d="M${f(sx - nx)} ${f(y - ny)} L${f(bx - nx)} ${f(by - ny)}" stroke="${col('rim')}" stroke-opacity="${vars ? 'var(--lm-rimOp)' : P.rimOp}" stroke-width="1.5"/>`;
    })
    .join('');
  const stemEnds = ys
    .map((y, i) => `<g class="lm-end" style="--i:${i}" transform="translate(${sx} ${y})"><circle r="${R}" fill="url(#${id}-cap)"/>${rings(R, R)}<circle r="${R}" fill="none" stroke="${ACCENT.deep}" stroke-width="3"/><circle r="${R - 3.5}" fill="none" stroke="${ACCENT.pale}" stroke-opacity=".35" stroke-width="1"/><ellipse class="lm-shine" cx="${-R * 0.34}" cy="${-R * 0.42}" rx="${R * 0.3}" ry="${R * 0.16}" transform="rotate(-30 ${-R * 0.34} ${-R * 0.42})" fill="#fff8ec" fill-opacity=".5"/></g>`)
    .join('');
  // Arms: two logs on the diagonal, cut ends out.
  const jx = sx + 8;
  const jy = (ys[1] + ys[2]) / 2;
  const r = 34;
  const arms = [
    [ys[0] - 12, 0],
    [ys[3] + 12, 1],
  ]
    .map(([ty, k]) => {
      const tx = 506;
      const ang = (Math.atan2(ty - jy, tx - jx) * 180) / Math.PI;
      const L = Math.hypot(tx - jx, ty - jy);
      const rx = 15;
      const grain = [0.45, -0.2, 0.15, -0.55]
        .map((o, j) => {
          const a = 26 + ((k * 41 + j * 57) % 50);
          const b = Math.min(L - 30, a + 70 + ((k * 23 + j * 67) % 110));
          return `<path d="M${a} ${f(o * r)} H${f(b)}"/>`;
        })
        .join('');
      return `<g class="lm-arm" transform="translate(${f(jx)} ${f(jy)}) rotate(${f(ang)})">
  <path d="M0 ${-r} H${f(L)} A${rx} ${r} 0 0 1 ${f(L)} ${r} H0 A${rx} ${r} 0 0 1 0 ${-r} Z" fill="url(#${id}-body)"/>
  <path d="M10 ${-r + 0.9} H${f(L)}" stroke="${col('rim')}" stroke-opacity="${vars ? 'var(--lm-rimOp)' : P.rimOp}" stroke-width="1.6" fill="none"/>
  <g stroke="${col('grain')}" stroke-opacity="${vars ? 'var(--lm-grainOp)' : P.grainOp}" stroke-width="1.4" stroke-linecap="round" fill="none">${grain}</g>
  <path d="M0 ${-r} H${f(L)} A${rx} ${r} 0 0 1 ${f(L)} ${r} H0 A${rx} ${r} 0 0 1 0 ${-r} Z" fill="none" stroke="${col('edge')}" stroke-opacity="${vars ? 'var(--lm-edgeOp)' : P.edgeOp}" stroke-width="1"/>
  <g class="lm-end" style="--i:${k ? 5 : 4}" transform="translate(${f(L)} 0)"><ellipse rx="${rx}" ry="${r}" fill="url(#${id}-cap)"/>${rings(rx, r)}<ellipse rx="${rx}" ry="${r}" fill="none" stroke="${ACCENT.deep}" stroke-width="2.6"/></g>
</g>`;
    })
    .join('');
  const haloShapes = [...ys.map((y) => `<circle cx="${sx}" cy="${y}" r="${R * 1.25}"/>`), `<circle cx="506" cy="${ys[0] - 12}" r="50"/>`, `<circle cx="506" cy="${ys[3] + 12}" r="50"/>`].join('');
  const defs = `<defs>
  <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${col('hi')}"/><stop offset=".2" stop-color="${col('mid')}"/><stop offset=".7" stop-color="${col('mid')}"/><stop offset="1" stop-color="${col('lo')}"/>
  </linearGradient>
  <linearGradient id="${id}-side" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="${col('mid')}"/><stop offset=".6" stop-color="${col('side')}"/><stop offset="1" stop-color="${col('hi')}"/>
  </linearGradient>
  <radialGradient id="${id}-cap" cx=".4" cy=".36" r=".78">
    <stop offset="0" stop-color="${ACCENT.pale}"/><stop offset=".32" stop-color="${ACCENT.a}"/><stop offset=".74" stop-color="${ACCENT.b}"/><stop offset="1" stop-color="${ACCENT.c}"/>
  </radialGradient>
  <filter id="${id}-blur" x="-100%" y="-100%" width="300%" height="300%" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="28"/></filter>
</defs>`;
  const halo = glow ? `<g class="lm-glow" filter="url(#${id}-blur)" fill="${ACCENT.b}" opacity="${vars ? 'var(--lm-halo)' : P.halo}">${haloShapes}</g>` : '';
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${defs}${halo}<g class="lm-k">${stemBodies}${arms}${stemEnds}</g></svg>`;
}
