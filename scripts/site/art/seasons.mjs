// Seasonal art: Kas in costume, four icons and a stage accent for each of the
// seven special dates, in light and dark. Written to assets/seasons/<id>/ by
// scripts/site/assets.mjs and served by the site from docs/assets/seasons/.
import { C, arms, body, hat, head, pencil, roll, stickerFilter, tail } from './mascot.mjs';

const INK = C.ink;
const sw = 7;

export const SEASONS = [
  { id: 'newyear', name: 'New Year' },
  { id: 'carnival', name: 'Carnival' },
  { id: 'easter', name: 'Easter' },
  { id: 'valentine', name: "Valentine's" },
  { id: 'junina', name: 'Festa Junina' },
  { id: 'halloween', name: 'Halloween' },
  { id: 'christmas', name: 'Christmas' },
];

// ---------- Costume pieces (512 by 512, the mascot's own grid) ----------

const witchHat = () => `<g id="kas-witch">
  <ellipse cx="256" cy="150" rx="132" ry="22" fill="#3d2d55" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M182 148 L 232 46 C 240 28 258 14 290 12 C 274 24 270 36 276 52 L 330 148 Z" fill="#4b3768" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M292 72 C 304 98 316 124 324 146 L 308 146 C 300 122 294 98 292 72 Z" fill="#3d2d55" opacity=".8"/>
  <path d="M190 126 C 232 138 282 138 322 126 L 330 146 C 284 158 228 158 182 146 Z" fill="#e0823a" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <rect x="242" y="124" width="28" height="24" rx="4" fill="#f6d27a" stroke="${INK}" stroke-width="4.5"/>
  <rect x="251" y="132" width="10" height="8" rx="2" fill="#4b3768"/>
  <path d="M214 92 C 220 78 228 66 236 58" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".35" fill="none"/>
</g>`;

const pumpkin = () => `<g id="kas-pumpkin">
  <path d="M196 312 C 196 300 202 292 212 288" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
  <path d="M196 312 C 196 300 202 292 212 288" fill="none" stroke="#5f7a3a" stroke-width="6" stroke-linecap="round"/>
  <ellipse cx="196" cy="368" rx="78" ry="58" fill="#e07b2a" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M196 312 C 168 330 164 404 196 424 M196 312 C 224 330 228 404 196 424 M150 324 C 132 346 134 396 154 414 M242 324 C 260 346 258 396 238 414" fill="none" stroke="#b85d1c" stroke-width="5" stroke-linecap="round"/>
  <path d="M160 352 L 178 336 L 186 358 Z M206 358 L 214 336 L 232 352 Z" fill="#ffd27a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M158 384 L 172 394 L 182 384 L 196 396 L 210 384 L 220 394 L 234 384 C 226 404 166 404 158 384 Z" fill="#ffd27a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
</g>`;

const santaHat = () => `<g id="kas-santa">
  <path d="M166 142 C 168 92 206 60 256 58 C 312 56 360 84 384 130 C 392 148 398 166 400 182 L 380 188 C 372 162 356 136 338 118 C 344 128 348 136 350 142 Z" fill="#c4473d" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M300 70 C 330 84 356 108 372 136 L 356 146 C 344 120 326 98 300 70 Z" fill="#a33a31" opacity=".7"/>
  <rect x="146" y="128" width="220" height="34" rx="17" fill="#f6f1ea" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M170 140 h8 M196 146 h8 M226 138 h8 M258 146 h8 M290 140 h8 M322 146 h8" stroke="#d9d2c6" stroke-width="5" stroke-linecap="round"/>
  <circle cx="400" cy="196" r="20" fill="#f6f1ea" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M206 92 C 214 80 226 72 238 68" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".5"/>
</g>`;

const scarf = () => `<g id="kas-scarf">
  <path d="M176 284 C 220 304 292 304 336 284 L 342 312 C 298 334 214 334 170 312 Z" fill="#2f6b4f" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M204 302 L 210 320 M236 306 L 238 326 M276 306 L 274 326 M308 302 L 302 320" stroke="#e7d9b8" stroke-width="5" stroke-linecap="round"/>
  <path d="M286 312 L 322 312 L 330 392 L 292 394 Z" fill="#2f6b4f" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M290 338 L 324 336 M292 364 L 327 362" stroke="#e7d9b8" stroke-width="5" stroke-linecap="round"/>
  <path d="M296 394 v 14 M306 394 v 16 M316 393 v 14 M326 392 v 12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
</g>`;

const gift = () => `<g id="kas-gift" transform="rotate(-6 186 366)">
  <rect x="122" y="322" width="128" height="96" rx="8" fill="#c4473d" stroke="${INK}" stroke-width="${sw}"/>
  <rect x="174" y="322" width="24" height="96" fill="#f2c45a" stroke="${INK}" stroke-width="4.5"/>
  <path d="M186 320 C 166 296 140 300 148 316 C 154 326 174 324 186 320 Z M186 320 C 206 296 232 300 224 316 C 218 326 198 324 186 320 Z" fill="#f2c45a" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</g>`;

const flake = (x, y, r, color) => `<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="4" stroke-linecap="round"><path d="M0 -${r} V ${r} M-${r * 0.87} -${r / 2} L ${r * 0.87} ${r / 2} M-${r * 0.87} ${r / 2} L ${r * 0.87} -${r / 2}"/></g>`;

const featherBand = () => `<g id="kas-feathers">
  <path d="M232 70 C 212 40 222 8 244 0 C 252 26 250 52 240 76 Z" fill="#e76f51" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M256 66 C 246 30 258 4 276 -2 C 282 26 276 50 264 72 Z" fill="#e9c46a" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M276 74 C 280 42 300 24 322 24 C 318 50 304 70 284 82 Z" fill="#2a9d8f" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M164 140 C 176 100 214 80 256 80 C 298 80 336 100 348 140" fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round"/>
  <path d="M164 140 C 176 100 214 80 256 80 C 298 80 336 100 348 140" fill="none" stroke="#7b5ab8" stroke-width="12" stroke-linecap="round"/>
  <circle cx="256" cy="80" r="13" fill="#e9c46a" stroke="${INK}" stroke-width="4.5"/>
  <path d="M190 112 l4 4 M214 96 l4 4 M300 96 l4 4 M324 112 l4 4" stroke="#e9c46a" stroke-width="5" stroke-linecap="round"/>
</g>`;

const mask = () => `<g id="kas-mask">
  <path d="M182 194 C 184 170 226 164 256 182 C 286 164 328 170 330 194 C 334 220 298 228 278 218 C 266 212 262 204 256 204 C 250 204 246 212 234 218 C 214 228 178 220 182 194 Z" fill="#2a9d8f" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M196 182 C 214 174 236 176 252 186 M260 186 C 276 176 298 174 316 182" fill="none" stroke="#e9c46a" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="216" cy="198" rx="17" ry="14" fill="#f6efe2" stroke="${INK}" stroke-width="4"/>
  <ellipse cx="296" cy="198" rx="17" ry="14" fill="#f6efe2" stroke="${INK}" stroke-width="4"/>
  <ellipse cx="216" cy="198" rx="10" ry="11" fill="${INK}"/>
  <ellipse cx="296" cy="198" rx="10" ry="11" fill="${INK}"/>
  <circle cx="220" cy="194" r="3.5" fill="#ffffff"/>
  <circle cx="300" cy="194" r="3.5" fill="#ffffff"/>
  <circle cx="186" cy="208" r="4" fill="#e76f51"/><circle cx="326" cy="208" r="4" fill="#e76f51"/>
</g>`;

const tambourine = () => `<g id="kas-tambourine" transform="rotate(-10 188 356)">
  <circle cx="188" cy="356" r="60" fill="#f3dcae" stroke="${INK}" stroke-width="${sw}"/>
  <circle cx="188" cy="356" r="46" fill="none" stroke="#c99a5b" stroke-width="4" stroke-dasharray="2 8"/>
  ${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="-9" y="-6" width="18" height="12" rx="3" fill="#e9c46a" stroke="${INK}" stroke-width="3.5" transform="translate(188 356) rotate(${a}) translate(0 -60)"/>`).join('')}
  <path d="M232 400 C 252 420 240 442 262 458 M222 410 C 234 436 214 452 232 474" fill="none" stroke="#e76f51" stroke-width="6" stroke-linecap="round"/>
</g>`;

const confetti = (items) => items.map(([x, y, c, r]) => (r ? `<rect x="${x}" y="${y}" width="12" height="7" rx="1.5" fill="${c}" transform="rotate(${r} ${x + 6} ${y + 3.5})"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/>`)).join('');

const strawHat = () => `<g id="kas-straw">
  <ellipse cx="256" cy="146" rx="150" ry="28" fill="#e2b85c" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M120 152 l-8 8 M150 166 l-4 10 M190 172 l-2 10 M232 175 v10 M280 175 v10 M322 172 l2 10 M362 166 l4 10 M392 152 l8 8" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
  <path d="M186 146 C 186 94 218 70 256 70 C 294 70 326 94 326 146 Z" fill="#ecc66e" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M200 102 C 236 94 276 94 312 102 M194 120 C 236 112 276 112 318 120" fill="none" stroke="#c99a3d" stroke-width="4" stroke-linecap="round"/>
  <path d="M188 128 C 230 138 282 138 324 128 L 326 146 C 280 154 232 154 186 146 Z" fill="#c4473d" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
  <rect x="284" y="84" width="24" height="22" rx="2" fill="#5f8fc0" stroke="${INK}" stroke-width="4" transform="rotate(8 296 95)"/>
  <path d="M288 88 l16 14 M304 88 l-16 14" stroke="#e7eef8" stroke-width="2.5" stroke-dasharray="3 3" transform="rotate(8 296 95)"/>
</g>`;

const bandana = () => `<g id="kas-bandana">
  <path d="M188 288 C 228 304 284 304 324 288 L 256 352 Z" fill="#c4473d" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="232" cy="306" r="4" fill="#f6efe2"/><circle cx="280" cy="306" r="4" fill="#f6efe2"/><circle cx="256" cy="326" r="4" fill="#f6efe2"/>
</g>`;

const corn = () => `<g id="kas-corn" transform="rotate(-14 196 352)">
  <path d="M110 352 C 110 326 150 318 240 326 C 270 330 290 342 292 352 C 290 362 270 374 240 378 C 150 386 110 378 110 352 Z" fill="#f2c94c" stroke="${INK}" stroke-width="${sw}"/>
  <path d="M140 338 V 368 M166 334 V 372 M192 333 V 374 M218 333 V 374 M244 336 V 370 M128 352 H 286" stroke="#d9a21e" stroke-width="4" stroke-linecap="round"/>
  <path d="M110 352 C 92 330 76 326 60 334 C 74 344 84 352 110 352 Z M110 352 C 90 372 72 380 58 372 C 74 362 88 354 110 352 Z" fill="#7aa35a" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
</g>`;

const bonfire = () => `<g id="kas-bonfire">
  <path d="M44 486 L 134 452 M44 452 L 134 486" stroke="${INK}" stroke-width="22" stroke-linecap="round"/>
  <path d="M44 486 L 134 452 M44 452 L 134 486" stroke="#8b5a35" stroke-width="12" stroke-linecap="round"/>
  <path d="M89 466 C 56 446 62 412 80 392 C 80 410 88 414 94 408 C 88 386 100 366 118 356 C 112 380 128 392 126 418 C 124 444 108 462 89 466 Z" fill="#f08a3c" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M90 460 C 76 448 78 430 88 418 C 90 432 98 432 102 426 C 108 440 106 454 90 460 Z" fill="#ffd27a"/>
</g>`;

const heartPath = (cx, cy, s) => {
  const p = (x, y) => `${cx + x * s} ${cy + y * s}`;
  return `M${p(0, 30)} C ${p(-32, 8)} ${p(-48, -12)} ${p(-42, -30)} C ${p(-36, -48)} ${p(-12, -52)} ${p(0, -34)} C ${p(12, -52)} ${p(36, -48)} ${p(42, -30)} C ${p(48, -12)} ${p(32, 8)} ${p(0, 30)} Z`;
};

const balloon = () => `<g id="kas-balloon">
  <path d="M392 206 C 404 176 428 150 448 118" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="${heartPath(450, 78, 1)}" fill="#df5d70" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M424 60 C 428 50 436 46 444 48" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".6"/>
  <path d="M444 108 l6 10 l6 -10 Z" fill="#df5d70" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
</g>`;

const heartHat = () => hat().replace(/<g transform="translate\(256 112\)">[\s\S]*?<\/g>/, `<g transform="translate(256 112)"><circle r="17" fill="#df5d70" stroke="${INK}" stroke-width="4.5"/><path d="${heartPath(0, 1, 0.24)}" fill="#ffffff"/></g>`);

const bunnyEars = () => `<g id="kas-ears">
  <ellipse cx="208" cy="64" rx="24" ry="56" transform="rotate(-14 208 64)" fill="#f7f2ec" stroke="${INK}" stroke-width="${sw}"/>
  <ellipse cx="208" cy="68" rx="11" ry="40" transform="rotate(-14 208 68)" fill="#f2b8c4"/>
  <ellipse cx="304" cy="60" rx="24" ry="56" transform="rotate(16 304 60)" fill="#f7f2ec" stroke="${INK}" stroke-width="${sw}"/>
  <ellipse cx="304" cy="64" rx="11" ry="40" transform="rotate(16 304 64)" fill="#f2b8c4"/>
  <path d="M166 144 C 176 110 214 96 256 96 C 298 96 336 110 346 144" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>
  <path d="M166 144 C 176 110 214 96 256 96 C 298 96 336 110 346 144" fill="none" stroke="#f2b8c4" stroke-width="10" stroke-linecap="round"/>
</g>`;

const egg = (x, y, rot, fill, band) => `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 -26 C 16 -26 22 -4 22 8 C 22 22 12 30 0 30 C -12 30 -22 22 -22 8 C -22 -4 -16 -26 0 -26 Z" fill="${fill}" stroke="${INK}" stroke-width="5"/><path d="M-21 4 l7 -6 l7 6 l7 -6 l7 6 l7 -6 l7 6" fill="none" stroke="${band}" stroke-width="4" stroke-linejoin="round"/></g>`;

const basket = () => `<g id="kas-basket">
  <path d="M120 344 C 120 280 270 280 270 344" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>
  <path d="M120 344 C 120 280 270 280 270 344" fill="none" stroke="#c08a4f" stroke-width="7" stroke-linecap="round"/>
  ${egg(158, 330, -14, '#f4a3b5', '#ffffff')}${egg(198, 322, 4, '#8fc3e8', '#ffffff')}${egg(236, 332, 16, '#f6d36b', '#e07b2a')}
  <path d="M108 342 H 282 L 266 414 C 264 422 258 426 250 426 H 140 C 132 426 126 422 124 414 Z" fill="#c08a4f" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M116 366 H 274 M122 390 H 268 M146 344 L 152 424 M178 344 L 180 426 M212 344 L 210 426 M244 344 L 238 424" stroke="#9a6a38" stroke-width="4" stroke-linecap="round"/>
</g>`;

const partyHat = () => `<g id="kas-party" transform="rotate(10 258 120)">
  <path d="M206 140 L 258 14 L 310 140 Z" fill="#2b2f45" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>
  <path d="M232 76 L 284 76 M220 106 L 296 106 M245 46 L 271 46" stroke="#e9c46a" stroke-width="8" stroke-linecap="round"/>
  <circle cx="258" cy="14" r="15" fill="#e9c46a" stroke="${INK}" stroke-width="5"/>
  <path d="M206 140 C 236 150 280 150 310 140" fill="none" stroke="#e9c46a" stroke-width="6" stroke-linecap="round"/>
</g>`;

const sparkler = () => `<g id="kas-sparkler">
  <path d="M394 212 L 436 132" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
  <path d="M394 212 L 436 132" stroke="#9a9a9a" stroke-width="3" stroke-linecap="round"/>
  <g transform="translate(440 124)" stroke="#f2b84b" stroke-width="4" stroke-linecap="round">
    <path d="M0 -30 V -14 M0 14 V 30 M-30 0 H -14 M14 0 H 30 M-21 -21 L -11 -11 M11 11 L 21 21 M-21 21 L -11 11 M11 -11 L 21 -21"/>
  </g>
  <circle cx="440" cy="124" r="8" fill="#fff1c7" stroke="#f2b84b" stroke-width="3"/>
</g>`;

const burst = (x, y, r, color, n = 10) => `<g transform="translate(${x} ${y})" stroke="${color}" stroke-width="3.5" stroke-linecap="round">${Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return `<path d="M${(c * r * 0.45).toFixed(1)} ${(s * r * 0.45).toFixed(1)} L ${(c * r).toFixed(1)} ${(s * r).toFixed(1)}"/>`;
}).join('')}</g>`;

// ---------- Mascot and head per season ----------

/** The costume of each season: what replaces the hard hat and the roll, plus extras. */
const COSTUMES = {
  halloween: { back: '', hat: witchHat, prop: pumpkin, neck: '', face: '', front: () => '' },
  christmas: { back: '', hat: santaHat, prop: gift, neck: scarf, face: '', front: () => [flake(64, 96, 14, '#7fa8cf'), flake(456, 70, 10, '#7fa8cf'), flake(470, 300, 12, '#7fa8cf'), flake(40, 260, 9, '#7fa8cf')].join('') },
  carnival: { back: '', hat: featherBand, prop: tambourine, neck: '', face: mask, front: () => confetti([[60, 120, '#e76f51', 20], [440, 90, '#2a9d8f', -30], [470, 210, '#e9c46a'], [40, 220, '#7b5ab8'], [420, 300, '#e76f51', 40], [80, 300, '#2a9d8f'], [460, 160, '#7b5ab8', 10]]) },
  junina: { back: bonfire, hat: strawHat, prop: corn, neck: bandana, face: '', front: () => '' },
  valentine: { back: balloon, hat: heartHat, prop: roll, neck: '', face: '', front: () => `<path d="${heartPath(70, 120, 0.4)}" fill="#df5d70" opacity=".8"/><path d="${heartPath(460, 300, 0.3)}" fill="#df5d70" opacity=".6"/>` },
  easter: { back: '', hat: bunnyEars, prop: basket, neck: '', face: '', front: () => '' },
  newyear: { back: () => [burst(70, 90, 44, '#e9c46a', 12), burst(120, 34, 24, '#f08a3c', 10)].join(''), hat: partyHat, prop: roll, neck: '', face: '', front: sparkler },
};

const call = (f) => (typeof f === 'function' ? f() : f || '');

/** Kas in costume. Decorations around him stay outside the dark sticker rim. */
export function seasonParts(id, rim = '') {
  const c = COSTUMES[id];
  const kas = [tail(), pencil(), body(), call(c.prop), arms(), call(c.neck), head(), call(c.face), call(c.hat)].join('\n');
  return `${call(c.back)}<g${rim}>${kas}</g>${call(c.front)}`;
}

/** The view box of the head with each hat, square. */
const HEAD_BOX = { halloween: '96 -6 340 340', christmas: '110 22 320 320', carnival: '100 -16 340 340', junina: '96 30 320 320', valentine: '110 12 330 330', easter: '100 -6 330 330', newyear: '108 -10 330 330' };

function headOnly(id) {
  const c = COSTUMES[id];
  return [pencil(), head(), call(c.face), call(c.hat)].join('\n');
}

export function seasonMascot(id, { dark = false } = {}) {
  const name = SEASONS.find((s) => s.id === id).name;
  const title = `Kas, the kastor beaver, dressed for ${name}`;
  const shadow = dark ? '' : `<ellipse cx="262" cy="482" rx="170" ry="14" fill="${INK}" opacity=".12"/>`;
  const filter = dark ? stickerFilter('kas-rim', '#fff4df', 9) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-labelledby="t"><title id="t">${title}</title><defs>${filter}</defs>${shadow}${seasonParts(id, dark ? ' filter="url(#kas-rim)"' : '')}</svg>`;
}

export function seasonHead(id, { dark = false } = {}) {
  const name = SEASONS.find((s) => s.id === id).name;
  const filter = dark ? stickerFilter('kas-head-rim', '#fff4df', 8) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HEAD_BOX[id]}" width="320" height="320" role="img" aria-labelledby="t"><title id="t">Kas, dressed for ${name}</title><defs>${filter}</defs><g${dark ? ' filter="url(#kas-head-rim)"' : ''}>${headOnly(id)}</g></svg>`;
}

// ---------- Icons (24 by 24, 1.5 stroke, ink plus one accent) ----------

const A = (accent, d, extra = '') => `<path d="${d}" stroke="${accent}"${extra}/>`;

export const SEASON_ICONS = {
  newyear: {
    firework: (_i, a) => `<path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9 18 18M6 18l2.1-2.1M15.9 8.1 18 6"/>${A(a, 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z')}`,
    'party-hat': (_i, a) => `<path d="M6 20.25 12 4l6 16.25H6Z"/>${A(a, 'M8.4 14h7.2M10.1 9.5h3.8')}<circle cx="12" cy="3.25" r=".9"/>`,
    clock: (_i, a) => `<circle cx="12" cy="12.75" r="7.75"/><path d="M9 3.25h6"/>${A(a, 'M12 8.5v4.25l2.75 1.75')}`,
    sparkle: (_i, a) => `${A(a, 'M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5Z')}<path d="M18.5 15.5v4M16.5 17.5h4"/>`,
  },
  carnival: {
    mask: (_i, a) => `<path d="M3.5 9.25c2.75-1.75 5.75-1.5 8.5.75 2.75-2.25 5.75-2.5 8.5-.75 0 4-2 6.25-4.75 6.25-1.75 0-2.75-1.5-3.75-2.5-1 1-2 2.5-3.75 2.5C5.5 15.5 3.5 13.25 3.5 9.25Z"/>${A(a, 'M7 11h1.5M15.5 11H17')}`,
    confetti: (_i, a) => `<path d="M4 20 8.5 8.5 15.5 15.5 4 20Z"/>${A(a, 'M13 4.5l.5 2M18.5 6.5l-1.5 1.5M19.5 11.5l-2-.5M15.5 3.5v0M20.5 9v0')}`,
    tambourine: (_i, a) => `<circle cx="12" cy="12" r="7.75"/>${A(a, 'M12 3.25v1.5M12 19.25v1.5M3.25 12h1.5M19.25 12h1.5M5.8 5.8l1 1M17.2 17.2l1 1M5.8 18.2l1-1M17.2 6.8l1-1')}`,
    streamer: (_i, a) => `<path d="M4 4.5c3 0 3 3 6 3s3-3 6-3"/>${A(a, 'M8 11c0 3 3 3 3 6s-3 3-3 3.5M15 9.5c0 2.5 3 2.5 3 5s-3 2.5-3 5')}`,
  },
  easter: {
    egg: (_i, a) => `<path d="M12 3.5c3.5 0 6 5.5 6 9.75a6 6 0 0 1-12 0C6 9 8.5 3.5 12 3.5Z"/>${A(a, 'M6.5 12.5l2-1.5 2 1.5 1.5-1.5 2 1.5 2-1.5 1.5 1.5')}`,
    basket: (_i, a) => `<path d="M4 11h16l-1.75 8.5a1.5 1.5 0 0 1-1.5 1.25H7.25a1.5 1.5 0 0 1-1.5-1.25L4 11Z"/><path d="M7 11a5 5 0 0 1 10 0"/>${A(a, 'M9.5 15v2.5M14.5 15v2.5')}`,
    bunny: (_i, a) => `<circle cx="12" cy="15.5" r="5"/>${A(a, 'M9.75 10.75C8.5 7.5 8.25 4.25 9.5 3.5s2.25 2.75 2.25 6.75M14.25 10.75c1.25-3.25 1.5-6.5.25-7.25s-2.25 2.75-2.25 6.75')}<path d="M10.5 15h0M13.5 15h0"/>`,
    tulip: (_i, a) => `<path d="M12 20.75V13M12 17c-2.5 0-4-1.25-4.5-3M12 18.5c2.25 0 3.75-1 4.25-2.75"/>${A(a, 'M7.5 5.5l2.25 2L12 4.25l2.25 3.25 2.25-2V10a4.5 4.5 0 0 1-9 0V5.5Z')}`,
  },
  valentine: {
    heart: (_i, a) => `${A(a, 'M12 19.5s-7.5-4.5-7.5-10A4 4 0 0 1 12 7.25a4 4 0 0 1 7.5 2.25c0 5.5-7.5 10-7.5 10Z')}`,
    balloon: (_i, a) => `${A(a, 'M12 14.75s-5.5-3.25-5.5-7.25a3 3 0 0 1 5.5-1.75 3 3 0 0 1 5.5 1.75c0 4-5.5 7.25-5.5 7.25Z')}<path d="M12 14.75c-1.25 2-1.25 3.5 0 6"/>`,
    letter: (_i, a) => `<rect x="3.25" y="5.75" width="17.5" height="12.5" rx="2"/><path d="M3.75 7l8.25 6 8.25-6"/>${A(a, 'M12 18.25s-2.5-1.5-2.5-3.25a1.25 1.25 0 0 1 2.5-.5 1.25 1.25 0 0 1 2.5.5c0 1.75-2.5 3.25-2.5 3.25Z')}`,
    rose: (_i, a) => `<path d="M12 12.75v8M12 17c1.75 0 3.25-1 3.5-2.75"/>${A(a, 'M12 3.75c-3 0-4.75 2.25-4.75 4.5S9.25 12.75 12 12.75s4.75-2.25 4.75-4.5S15 3.75 12 3.75ZM12 6.5c-1 .75-1.25 2-.5 3')}`,
  },
  junina: {
    bonfire: (_i, a) => `<path d="M4.5 20.5 19.5 16.5M4.5 16.5l15 4"/>${A(a, 'M12 14.75c-2.5 0-3.75-1.75-3.75-3.75 0-2.5 2.25-3.5 2.5-7 1.75 1.25 2.75 2.5 2.75 4.25.75-.5 1-1.25 1-2 1.25 1.25 1.25 3 1.25 4.75 0 2-1.25 3.75-3.75 3.75Z')}`,
    'straw-hat': (_i, a) => `<path d="M3 16.5c0-1.5 4-2.75 9-2.75s9 1.25 9 2.75-4 2.5-9 2.5-9-1-9-2.5Z"/><path d="M7.75 14.25c0-4 1.75-7.25 4.25-7.25s4.25 3.25 4.25 7.25"/>${A(a, 'M8 12.5c2.75.75 5.25.75 8 0')}`,
    flags: (_i, a) => `<path d="M2.75 5.5c6 3 12.5 3 18.5 0"/>${A(a, 'M5.5 7v6l2.25-2 2.25 2V7.75M14 7.75V13l2.25-2 2.25 2V7')}`,
    corn: (_i, a) => `<path d="M12 4c2.25 0 3.5 2.75 3.5 6.5S14 17 12 17s-3.5-2.75-3.5-6.5S9.75 4 12 4Z"/><path d="M10 8h4M9.5 11h5M10 14h4"/>${A(a, 'M12 17c-3.5 0-5.5-2-6-5.5 2.5.5 4.5 2 6 5.5Zm0 0c3.5 0 5.5-2 6-5.5-2.5.5-4.5 2-6 5.5Zm0 0v3.5')}`,
  },
  halloween: {
    pumpkin: (_i, a) => `<path d="M12 6.75c-4.5 0-8 2.75-8 6.75s3.5 6.75 8 6.75 8-2.75 8-6.75-3.5-6.75-8-6.75Z"/><path d="M12 6.75c-2 1.5-2.5 4.25-2.5 6.75s.5 5.25 2.5 6.75c2-1.5 2.5-4.25 2.5-6.75S14 8.25 12 6.75Z"/>${A(a, 'M12 6.75c0-1.5.5-2.75 2-3.25')}`,
    bat: (_i, a) => `${A(a, 'M12 9.5c-.5-.75-.75-1.5-.5-2.5l.5.75.5-.75c.25 1 0 1.75-.5 2.5Z')}<path d="M12 9.5c-1.75 0-2.5 1.5-2.5 3 0-1.25-1.5-2.5-3-2-.25-1.5-1.5-2.75-3.25-2.75.5 2.75 2.25 5.75 5.25 7.25.75-1 2-1 3.5 0 1.5-1 2.75-1 3.5 0 3-1.5 4.75-4.5 5.25-7.25-1.75 0-3 1.25-3.25 2.75-1.5-.5-3 .75-3 2 0-1.5-.75-3-2.5-3Z"/>`,
    'witch-hat': (_i, a) => `<path d="M3.5 18c0-1.25 3.75-2.25 8.5-2.25s8.5 1 8.5 2.25-3.75 2.25-8.5 2.25-8.5-1-8.5-2.25Z"/><path d="M7.5 16.25 11 7c.75-2 2.5-3.5 5-3.5-1.25 1-1.5 2.25-1 3.5l1.75 9.25"/>${A(a, 'M8.25 13.75c2.5.75 5 .75 7.75 0')}`,
    moon: (_i, a) => `${A(a, 'M17.5 15.5A7.25 7.25 0 0 1 9 5a7.25 7.25 0 1 0 8.5 10.5Z')}<path d="M17 4.5v2.5M15.75 5.75h2.5M20 9.5v0"/>`,
  },
  christmas: {
    snowflake: (_i, a) => `<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>${A(a, 'M9.75 4.75 12 6.5l2.25-1.75M9.75 19.25 12 17.5l2.25 1.75')}`,
    gift: (_i, a) => `<rect x="4" y="9.5" width="16" height="11" rx="1.5"/><path d="M3.25 9.5h17.5"/>${A(a, 'M12 9.5v11M12 9.5c-1-3-4.5-4-5-2.25-.4 1.5 2.5 2.25 5 2.25Zm0 0c1-3 4.5-4 5-2.25.4 1.5-2.5 2.25-5 2.25Z')}`,
    tree: (_i, a) => `<path d="M12 3.5 6.5 10.5h3L5.5 16h13l-4-5.5h3L12 3.5Z"/><path d="M12 16v4.5"/>${A(a, 'M10.25 13h0M13.5 9.5h0M14 13.5h0')}`,
    bell: (_i, a) => `<path d="M6.25 16.5V11a5.75 5.75 0 0 1 11.5 0v5.5l1.5 1.75H4.75l1.5-1.75Z"/>${A(a, 'M10 20.25a2 2 0 0 0 4 0M12 3.5v1.75')}`,
  },
};

export function seasonIconSvg(id, name, { ink, accent }) {
  const draw = SEASON_ICONS[id][name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" role="img" aria-label="${name.replace(/-/g, ' ')}"><g fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${draw(ink, accent)}</g></svg>`;
}

// ---------- Stage accents (600 by 480, the lit K's stage) ----------

const STAGE = {
  light: { ink: '#3a2a1e', soft: '#8a7a6a', snow: '#e8eef5', snowLine: '#b9c9da', glow: .5 },
  dark: { ink: '#ede4d6', soft: '#8f8577', snow: '#dfe7f0', snowLine: '#7f93a8', glow: .8 },
};

const bat = (x, y, s, fill) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -6 C -2 -9 -2 -12 -1 -14 L 0 -11 L 1 -14 C 2 -12 2 -9 0 -6 Z M0 -6 C -8 -6 -11 0 -11 6 C -11 1 -17 -4 -23 -2 C -24 -8 -29 -13 -36 -13 C -34 -2 -26 10 -14 16 C -11 12 -6 12 0 16 C 6 12 11 12 14 16 C 26 10 34 -2 36 -13 C 29 -13 24 -8 23 -2 C 17 -4 11 1 11 6 C 11 0 8 -6 0 -6 Z" fill="${fill}"/>`;

const miniPumpkin = (x, y, s, ink) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -26 C 0 -32 4 -36 9 -38" fill="none" stroke="#5f7a3a" stroke-width="5" stroke-linecap="round"/><ellipse cx="0" cy="0" rx="36" ry="27" fill="#d9772b" stroke="${ink}" stroke-width="3"/><path d="M0 -26 C -14 -16 -14 16 0 26 M0 -26 C 14 -16 14 16 0 26" fill="none" stroke="#b05e1c" stroke-width="3"/></g>`;

const flag = (x, y, rot, fill) => `<path d="M${x - 11} ${y} L ${x + 11} ${y} L ${x} ${y + 26} Z" fill="${fill}" transform="rotate(${rot} ${x} ${y})"/>`;

function garland(y0, sag, n, x0, x1, draw) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + sag * 4 * t * (1 - t);
    pts.push([x, y, (t - 0.5) * 30]);
  }
  return { path: `M${x0} ${y0} Q ${(x0 + x1) / 2} ${y0 + sag * 2} ${x1} ${y0}`, items: pts.map(([x, y, r], i) => draw(x, y, r, i)).join('') };
}

const ACCENTS = {
  halloween: (m) => {
    const c = STAGE[m];
    return `<path d="M96 0 V 96" stroke="${c.soft}" stroke-width="1.5"/><g transform="translate(96 106)"><ellipse rx="9" ry="11" fill="${c.ink}"/><path d="M-9 -4 L -20 -12 M-9 2 L -21 2 M-8 7 L -18 16 M9 -4 L 20 -12 M9 2 L 21 2 M8 7 L 18 16" stroke="${c.ink}" stroke-width="2" stroke-linecap="round"/></g>
${bat(470, 70, 1.1, c.ink)}${bat(530, 130, 0.7, c.ink)}${bat(420, 150, 0.55, c.ink)}
${miniPumpkin(104, 440, 1, c.ink)}${miniPumpkin(164, 452, 0.7, c.ink)}${miniPumpkin(500, 446, 0.85, c.ink)}`;
  },
  christmas: (m) => {
    const c = STAGE[m];
    const colors = ['#c4473d', '#e9c46a', '#2f8f63', '#5f8fc0'];
    const g = garland(20, 70, 11, 30, 570, (x, y, r, i) => `<g transform="rotate(${r} ${x} ${y})"><rect x="${x - 4}" y="${y}" width="8" height="6" fill="${c.soft}"/><ellipse cx="${x}" cy="${y + 15}" rx="7" ry="10" fill="${colors[i % 4]}"/><ellipse cx="${x}" cy="${y + 15}" rx="14" ry="16" fill="${colors[i % 4]}" opacity="${0.18 * c.glow}"/></g>`);
    return `<path d="${g.path}" fill="none" stroke="${c.soft}" stroke-width="2"/>${g.items}
<path d="M40 480 C 80 446 140 446 190 470 C 210 450 250 452 270 480 Z" fill="${c.snow}" stroke="${c.snowLine}" stroke-width="2"/>
<path d="M400 480 C 430 456 480 450 520 466 C 540 452 570 456 590 480 Z" fill="${c.snow}" stroke="${c.snowLine}" stroke-width="2"/>
<g transform="translate(540 380)"><path d="M0 -70 L 34 -14 H 16 L 44 34 H -44 L -16 -14 H -34 Z" fill="#2f6b4f"/><rect x="-6" y="34" width="12" height="16" fill="#7a5236"/><circle cx="0" cy="-74" r="6" fill="#e9c46a"/><circle cx="-12" cy="10" r="4" fill="#c4473d"/><circle cx="14" cy="-20" r="4" fill="#e9c46a"/><circle cx="18" cy="22" r="4" fill="#5f8fc0"/></g>`;
  },
  carnival: () => {
    const cs = ['#e76f51', '#2a9d8f', '#e9c46a', '#7b5ab8'];
    let dots = '';
    for (let i = 0; i < 26; i++) {
      const x = 30 + ((i * 97) % 540);
      const y = 20 + ((i * 53) % 230);
      dots += i % 3 ? `<rect x="${x}" y="${y}" width="10" height="5" rx="1" fill="${cs[i % 4]}" transform="rotate(${(i * 37) % 180} ${x + 5} ${y + 2})"/>` : `<circle cx="${x}" cy="${y}" r="4" fill="${cs[i % 4]}"/>`;
    }
    return `<path d="M0 10 C 60 40 40 90 100 110 C 150 126 140 170 190 190" fill="none" stroke="#e76f51" stroke-width="5" stroke-linecap="round" opacity=".85"/>
<path d="M600 16 C 540 50 560 96 500 116 C 450 132 466 180 416 196" fill="none" stroke="#2a9d8f" stroke-width="5" stroke-linecap="round" opacity=".85"/>
<path d="M0 60 C 40 76 30 120 70 140" fill="none" stroke="#e9c46a" stroke-width="4" stroke-linecap="round" opacity=".8"/>
<path d="M600 70 C 560 86 570 126 530 146" fill="none" stroke="#7b5ab8" stroke-width="4" stroke-linecap="round" opacity=".8"/>${dots}`;
  },
  junina: (m) => {
    const c = STAGE[m];
    const cs = ['#c4473d', '#e9c46a', '#2a9d8f', '#5f8fc0', '#e07b2a'];
    const a = garland(14, 60, 12, 0, 600, (x, y, r, i) => flag(x, y, r, cs[i % 5]));
    const b = garland(60, 50, 10, 60, 540, (x, y, r, i) => flag(x, y, r, cs[(i + 2) % 5]));
    return `<path d="${a.path}" fill="none" stroke="${c.soft}" stroke-width="1.5"/>${a.items}<path d="${b.path}" fill="none" stroke="${c.soft}" stroke-width="1.5"/>${b.items}
<g transform="translate(520 470)"><path d="M-40 0 L 40 -24 M-40 -24 L 40 0" stroke="#7a5236" stroke-width="10" stroke-linecap="round"/><path d="M0 -14 C -26 -28 -20 -56 -6 -72 C -6 -58 0 -54 4 -58 C 0 -76 10 -92 24 -100 C 20 -80 32 -70 30 -48 C 28 -26 16 -14 0 -14 Z" fill="#f08a3c" opacity=".95"/><path d="M0 -18 C -10 -28 -8 -42 0 -52 C 2 -42 8 -42 12 -46 C 16 -34 14 -24 0 -18 Z" fill="#ffd27a"/></g>`;
  },
  valentine: () => {
    const hs = [[70, 140, 0.55, 0.9], [130, 70, 0.35, 0.7], [40, 260, 0.3, 0.6], [520, 110, 0.6, 0.9], [470, 40, 0.3, 0.7], [560, 250, 0.35, 0.6], [300, 30, 0.25, 0.5]];
    return hs.map(([x, y, s, o]) => `<path d="${heartPath(x, y, s * 1.6)}" fill="#df5d70" opacity="${o}"/>`).join('');
  },
  easter: (m) => {
    const c = STAGE[m];
    const grass = (x0, x1) => {
      let d = `M${x0} 480`;
      for (let x = x0; x < x1; x += 14) d += ` L ${x + 7} ${452 - ((x * 7) % 16)} L ${x + 14} 480`;
      return `<path d="${d} Z" fill="#7aa35a" opacity="${m === 'dark' ? 0.85 : 1}"/>`;
    };
    const flower = (x, y, col) => `<g transform="translate(${x} ${y})"><path d="M0 0 V 26" stroke="#5f8a45" stroke-width="3"/>${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="5" ry="9" fill="${col}" transform="rotate(${a}) translate(0 -9)"/>`).join('')}<circle r="4" fill="#e9c46a"/></g>`;
    const fills = ['#f4a3b5', '#8fc3e8', '#f6d36b', '#b9a3e3'];
    const hung = garland(14, 56, 9, 30, 570, (x, y, r, i) => `<path d="M${x} ${y} V ${y + 12}" stroke="${c.soft}" stroke-width="1.5"/>${egg(x, y + 34, r, fills[i % 4], '#ffffff').replace(/translate\(([\d.]+) ([\d.]+)\)/, (_, a, b) => `translate(${a} ${b}) scale(.62)`)}`);
    return `<path d="${hung.path}" fill="none" stroke="${c.soft}" stroke-width="1.5"/>${hung.items}${grass(30, 230)}${grass(380, 580)}${egg(90, 446, -12, '#f4a3b5', '#ffffff')}${egg(150, 456, 10, '#8fc3e8', '#ffffff')}${egg(470, 450, -6, '#f6d36b', '#e07b2a')}${egg(530, 458, 14, '#b9a3e3', '#ffffff')}${flower(200, 440, '#f4a3b5')}${flower(420, 444, '#f6efe2')}`.replace(new RegExp(INK, 'g'), c.ink);
  },
  newyear: (m) => {
    const c = STAGE[m];
    const spark = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -12 C 1 -4 4 -1 12 0 C 4 1 1 4 0 12 C -1 4 -4 1 -12 0 C -4 -1 -1 -4 0 -12 Z" fill="#e9c46a"/>`;
    return `${burst(110, 90, 62, '#e9c46a', 14)}${burst(110, 90, 30, '#f08a3c', 10)}${burst(500, 70, 50, '#f08a3c', 12)}${burst(500, 70, 22, '#e9c46a', 8)}${burst(320, 40, 32, c.soft, 10)}${spark(60, 220, 0.8)}${spark(560, 200, 1)}${spark(230, 120, 0.6)}${spark(420, 160, 0.7)}`;
  },
};

export function seasonAccent(id, mode = 'light') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 480" width="600" height="480" aria-hidden="true">${ACCENTS[id](mode)}</svg>`;
}
