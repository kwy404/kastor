// The README banner (1280 by 400): the lit K on a dark or light stage, the
// wordmark, the tagline and the databases. Fonts fall back to system faces
// because the banner is shown as an image on GitHub and npm.
import { ACCENT, litMark } from './brand.mjs';
import { DATABASES, dbSymbol } from './icons.mjs';
import { headParts, HEAD_VIEWBOX } from './mascot.mjs';

const SANS = 'Geist, Inter, Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif';
const MONO = 'Geist Mono, SFMono-Regular, Consolas, Menlo, monospace';

export const STAGE = {
  dark: { bg: '#0a0a0a', bg2: '#111111', line: '#ffffff', lineOp: 0.06, ink: '#ededed', ink2: '#a1a1a1', ink3: '#737373', border: '#262626', chip: '#141414' },
  light: { bg: '#ffffff', bg2: '#fafafa', line: '#000000', lineOp: 0.06, ink: '#171717', ink2: '#525252', ink3: '#8f8f8f', border: '#e5e5e5', chip: '#fafafa' },
};

export function banner(mode = 'light') {
  const s = STAGE[mode];
  const W = 1280;
  const H = 400;
  const mark = litMark({ mode, id: `bn-${mode}`, cls: 'm' }).replace(/<svg class="m" viewBox="0 0 600 480" width="600" height="480" aria-hidden="true">/, '<svg x="56" y="34" width="420" height="336" viewBox="0 0 600 480">');
  const dbs = DATABASES.filter((d) => ['postgres', 'mysql', 'sqlite', 'mssql', 'mongodb'].includes(d.id));
  let x = 520;
  const chips = dbs
    .map((d) => {
      const w = 46 + d.name.length * 9.2;
      const el = `<g transform="translate(${x.toFixed(1)} 290)"><rect width="${w.toFixed(1)}" height="34" rx="17" fill="${s.chip}" stroke="${s.border}"/><g transform="translate(10 7) scale(.83)">${dbSymbol(d, s.ink2)}</g><text x="34" y="22" font-family="${SANS}" font-size="14" font-weight="500" fill="${s.ink2}">${d.name}</text></g>`;
      x += w + 8;
      return el;
    })
    .join('');
  const more = `<g transform="translate(${x.toFixed(1)} 290)"><rect width="84" height="34" rx="17" fill="${s.chip}" stroke="${s.border}"/><text x="42" y="22" text-anchor="middle" font-family="${SANS}" font-size="14" font-weight="500" fill="${s.ink3}">+5 more</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="kastor: the TypeScript ORM for almost every database">
<defs>
  <pattern id="bn-grid-${mode}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${s.line}" stroke-opacity="${s.lineOp}" stroke-width="1"/></pattern>
  <radialGradient id="bn-fade-${mode}" cx=".22" cy=".5" r=".75"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <mask id="bn-mask-${mode}"><rect width="${W}" height="${H}" fill="url(#bn-fade-${mode})"/></mask>
  <radialGradient id="bn-glow-${mode}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${ACCENT.b}" stop-opacity="${mode === 'dark' ? 0.32 : 0.2}"/><stop offset="1" stop-color="${ACCENT.b}" stop-opacity="0"/></radialGradient>
  <linearGradient id="bn-acc-${mode}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ACCENT.a}"/><stop offset="1" stop-color="${ACCENT.c}"/></linearGradient>
  <clipPath id="bn-clip-${mode}"><rect width="${W}" height="${H}" rx="24"/></clipPath>
</defs>
<g clip-path="url(#bn-clip-${mode})">
  <rect width="${W}" height="${H}" fill="${s.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#bn-grid-${mode})" mask="url(#bn-mask-${mode})"/>
  <ellipse cx="270" cy="200" rx="300" ry="230" fill="url(#bn-glow-${mode})"/>
  ${mark}
  <text x="520" y="132" font-family="${MONO}" font-size="15" letter-spacing="2" fill="${s.ink3}">TYPESCRIPT ORM</text>
  <text x="516" y="206" font-family="${SANS}" font-size="84" font-weight="700" letter-spacing="-4" fill="${s.ink}">kastor</text>
  <rect x="520" y="226" width="56" height="3" rx="1.5" fill="url(#bn-acc-${mode})"/>
  <text x="520" y="266" font-family="${SANS}" font-size="24" font-weight="500" letter-spacing="-.4" fill="${s.ink2}">The TypeScript ORM for almost every database. No codegen.</text>
  ${chips}${more}
  <svg x="1176" y="322" width="84" height="84" viewBox="${HEAD_VIEWBOX}" opacity=".95">${headParts()}</svg>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="${s.border}"/>
</svg>`;
}
