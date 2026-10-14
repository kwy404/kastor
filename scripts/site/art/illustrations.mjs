// Spot illustrations for docs, guides and hubs, in the same line language as
// the icon set: hairline cards, 1.5 strokes, one amber to copper accent.
// Inline SVG: colors come from CSS variables so they follow the theme
// (--il-card, --il-line, --il-dim, --il-ink, with fallbacks for files).

const V = {
  card: 'var(--il-card, #ffffff)',
  line: 'var(--il-line, #d4d4d4)',
  dim: 'var(--il-dim, #a3a3a3)',
  ink: 'var(--il-ink, #171717)',
  bg: 'var(--il-bg, #fafafa)',
};

function defs(id) {
  return `<defs><linearGradient id="${id}-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb547"/><stop offset="1" stop-color="#d4622b"/></linearGradient><radialGradient id="${id}-g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f08a3c" stop-opacity=".28"/><stop offset="1" stop-color="#f08a3c" stop-opacity="0"/></radialGradient><pattern id="${id}-p" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="${V.line}" stroke-opacity=".55" stroke-width=".75"/></pattern></defs>`;
}

const ACC = '#f08a3c';
const card = (x, y, w, h, stroke = V.line, sw = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${V.card}" stroke="${stroke}" stroke-width="${sw}"/>`;
const bar = (x, y, w, c = V.dim, o = 1) => `<path d="M${x} ${y}h${w}" stroke="${c}" stroke-opacity="${o}" stroke-width="2.5" stroke-linecap="round"/>`;
const dots = (x, y) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${V.dim}"/><circle cx="${x + 6}" cy="${y}" r="1.6" fill="${V.dim}"/><circle cx="${x + 12}" cy="${y}" r="1.6" fill="${V.dim}"/>`;

/** A tiny lit K: three log ends and two arms, accent caps. */
function kMini(x, y, s, id) {
  const r = 3.3 * s;
  const ys = [4.7, 12.25, 19.75, 27.3].map((v) => y + v * s);
  const cx = x + 8.6 * s;
  const jx = x + 13.4 * s;
  const jy = y + 16 * s;
  return `<g><path d="M${jx} ${jy}L${x + 27.2 * s} ${y + 4.7 * s}M${jx} ${jy}L${x + 27.2 * s} ${y + 27.3 * s}" stroke="${V.ink}" stroke-width="${6.6 * s}" stroke-linecap="round"/>${ys.map((cy) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-a)"/>`).join('')}</g>`;
}

/** Field notes: an editor with a schema, a typed result and a table. */
function guide(id) {
  return `${defs(id)}<rect x="0" y="0" width="320" height="200" fill="url(#${id}-p)"/><circle cx="210" cy="96" r="96" fill="url(#${id}-g)"/>
${card(26, 30, 168, 118)}${dots(38, 42)}<path d="M26 52.5h168" stroke="${V.line}"/>
${bar(40, 68, 34, ACC)}${bar(80, 68, 52)}${bar(52, 82, 64)}${bar(52, 96, 80)}${bar(52, 110, 46)}${bar(40, 124, 18)}
${card(148, 88, 146, 86)}<path d="M148 110h146M196 110v64M148 132h146M148 153h146" stroke="${V.line}"/>
${bar(160, 99, 24, V.ink, 0.6)}${bar(208, 99, 40, V.ink, 0.6)}${bar(160, 121, 18)}${bar(208, 121, 58)}${bar(160, 143, 18)}${bar(208, 143, 44)}${bar(160, 164, 18)}${bar(208, 164, 66)}
<rect x="210" y="34" width="90" height="36" rx="8" fill="${V.card}" stroke="url(#${id}-a)" stroke-width="1.25"/>${bar(222, 47, 30, ACC)}${bar(222, 58, 64)}
${kMini(40, 158, 0.75, id)}`;
}

/** Migrate: rows travel from an old store into a kastor store. */
function migrate(id) {
  const cyl = (x, y, w, h, stroke) => `<path d="M${x} ${y}v${h}c0 6 ${w / 2} 9 ${w / 2} 9s${w / 2}-3 ${w / 2}-9v-${h}" fill="${V.card}" stroke="${stroke}" stroke-width="1.25"/><ellipse cx="${x + w / 2}" cy="${y}" rx="${w / 2}" ry="9" fill="${V.card}" stroke="${stroke}" stroke-width="1.25"/><path d="M${x} ${y + h / 2}c0 6 ${w / 2} 9 ${w / 2} 9s${w / 2}-3 ${w / 2}-9" fill="none" stroke="${stroke}" stroke-width="1.25"/>`;
  return `${defs(id)}<rect x="0" y="0" width="320" height="200" fill="url(#${id}-p)"/><circle cx="236" cy="100" r="92" fill="url(#${id}-g)"/>
${cyl(34, 64, 74, 78, V.dim)}${cyl(212, 64, 74, 78, `url(#${id}-a)`)}
<path d="M118 100c30-34 64-34 84 0" fill="none" stroke="${V.dim}" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/>
<path d="M194 92l9 9-12 3" fill="none" stroke="${V.dim}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
${card(126, 118, 68, 22)}${bar(136, 129, 20, ACC)}${bar(162, 129, 22)}
${card(136, 148, 68, 22)}${bar(146, 159, 20, V.ink, 0.5)}${bar(172, 159, 22)}
${kMini(232, 92, 1.05, id)}
${bar(52, 100, 38)}${bar(52, 112, 26)}`;
}

/** Frameworks: the app, the server and the database in a stack. */
function frameworks(id) {
  return `${defs(id)}<rect x="0" y="0" width="320" height="200" fill="url(#${id}-p)"/><circle cx="160" cy="150" r="100" fill="url(#${id}-g)"/>
${card(70, 22, 180, 52)}${dots(82, 34)}${bar(84, 52, 60)}${bar(150, 52, 40, ACC)}${bar(84, 63, 90)}
<path d="M160 74v18" stroke="${V.dim}" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round"/>
${card(56, 92, 208, 44)}<path d="M76 114l7-6-7-6M90 120h22" fill="none" stroke="${ACC}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>${bar(132, 108, 56)}${bar(132, 120, 96)}
<path d="M160 136v18" stroke="${V.dim}" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round"/>
${card(96, 154, 128, 34)}${kMini(108, 157, 0.88, id)}${bar(148, 166, 52)}${bar(148, 177, 30)}`;
}

/** Reference: a type signature card over a terminal. */
function reference(id) {
  return `${defs(id)}<rect x="0" y="0" width="320" height="200" fill="url(#${id}-p)"/><circle cx="110" cy="110" r="96" fill="url(#${id}-g)"/>
${card(30, 50, 170, 120)}${dots(42, 62)}<path d="M30 72.5h170" stroke="${V.line}"/>
<path d="M44 92l8 7-8 7" fill="none" stroke="${ACC}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>${bar(60, 106, 30)}${bar(44, 124, 110)}${bar(44, 138, 84)}${bar(44, 152, 60)}
${card(150, 26, 144, 72, `url(#${id}-a)`, 1.25)}${bar(164, 44, 48, ACC)}${bar(164, 58, 100)}${bar(176, 70, 80)}${bar(164, 82, 40)}
${kMini(240, 132, 1, id)}`;
}

/** Hub: a wall of guide cards. */
function hub(id) {
  const cards = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 28 + c * 92;
      const y = 22 + r * 56;
      const hot = r === 1 && c === 1;
      cards.push(`${card(x, y, 80, 46, hot ? `url(#${id}-a)` : V.line, hot ? 1.5 : 1)}${bar(x + 12, y + 15, 26, hot ? ACC : V.ink, hot ? 1 : 0.45)}${bar(x + 12, y + 27, 54)}${bar(x + 12, y + 36, 36)}`);
    }
  }
  return `${defs(id)}<rect x="0" y="0" width="320" height="200" fill="url(#${id}-p)"/><circle cx="160" cy="100" r="100" fill="url(#${id}-g)"/>${cards.join('')}`;
}

const ART = { guide, migrate, frameworks, reference, hub };

/** An illustration as inline SVG. `kind` is one of guide, migrate, frameworks, reference, hub. */
export function illustration(kind = 'guide', { id = `il-${kind}`, cls = 'il', label = '' } = {}) {
  const draw = ART[kind] || guide;
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 320 200" width="320" height="200" ${a11y}>${draw(id)}</svg>`;
}

/** A standalone file with fixed colors. */
export function illustrationFile(kind, mode = 'light') {
  const vars = mode === 'dark' ? { card: '#111111', line: '#2e2e2e', dim: '#525252', ink: '#ededed', bg: '#0a0a0a' } : { card: '#ffffff', line: '#e5e5e5', dim: '#b5b5b5', ink: '#171717', bg: '#fafafa' };
  const style = `--il-card:${vars.card};--il-line:${vars.line};--il-dim:${vars.dim};--il-ink:${vars.ink}`;
  return illustration(kind, { id: `f-${kind}` }).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" style="${style}" `).replace(' aria-hidden="true"', ` role="img" aria-label="kastor ${kind} illustration"`);
}
