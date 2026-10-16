// Kas, the kastor beaver: shared drawing parts.
export const C = {
  ink: '#3a2416',
  fur: '#a86a3c',
  furShade: '#8b532c',
  furLight: '#c4834f',
  belly: '#f0cf9f',
  bellyShade: '#e2b77f',
  tail: '#5a3a24',
  tailLine: '#7a5236',
  foot: '#5a3a24',
  hat: '#ffc21a',
  hatShade: '#eba300',
  hatLight: '#ffe27a',
  bp: '#2a63e6',
  bpDark: '#1b45b0',
  bpLine: '#c9dafd',
  bpEnd: '#e6eeff',
  pencil: '#e2553b',
  pencilDark: '#b83f29',
  wood: '#f4d4a2',
  cheek: '#f29a86',
  tooth: '#fffaf0',
  white: '#ffffff',
};

const sw = 7;

export function tail() {
  return `<g id="kas-tail">
    <clipPath id="kas-tail-clip"><ellipse cx="402" cy="414" rx="84" ry="44" transform="rotate(-24 402 414)"/></clipPath>
    <ellipse cx="402" cy="414" rx="84" ry="44" transform="rotate(-24 402 414)" fill="${C.tail}"/>
    <g clip-path="url(#kas-tail-clip)" stroke="${C.tailLine}" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M320 380 L470 500 M340 352 L490 472 M360 324 L510 444 M300 408 L450 528"/>
      <path d="M470 330 L330 470 M495 352 L355 492 M445 308 L305 448 M520 375 L380 515"/>
    </g>
    <ellipse cx="402" cy="414" rx="84" ry="44" transform="rotate(-24 402 414)" fill="none" stroke="${C.ink}" stroke-width="${sw}"/>
  </g>`;
}

export function pencil() {
  // Carpenter pencil tucked behind the right ear, drawn before the head.
  return `<g id="kas-pencil" transform="rotate(-38 352 132)">
    <rect x="300" y="120" width="104" height="22" rx="4" fill="${C.pencil}" stroke="${C.ink}" stroke-width="6"/>
    <rect x="300" y="131" width="104" height="5" fill="${C.pencilDark}" opacity=".55"/>
    <path d="M404 120 L434 131 L404 142 Z" fill="${C.wood}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M424 127.4 L434 131 L424 134.6 Z" fill="${C.ink}"/>
  </g>`;
}

export function body() {
  return `<g id="kas-body">
    <ellipse cx="208" cy="466" rx="40" ry="17" fill="${C.foot}" stroke="${C.ink}" stroke-width="${sw}"/>
    <ellipse cx="306" cy="466" rx="40" ry="17" fill="${C.foot}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M256 250 C 340 250 362 330 360 386 C 358 440 316 468 256 468 C 196 468 154 440 152 386 C 150 330 172 250 256 250 Z" fill="${C.fur}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M256 300 C 304 300 318 350 316 392 C 314 430 292 452 256 452 C 220 452 198 430 196 392 C 194 350 208 300 256 300 Z" fill="${C.belly}"/>
    <path d="M214 420 C 226 440 244 448 256 448 C 268 448 286 440 298 420" fill="none" stroke="${C.bellyShade}" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

export function roll() {
  // Blueprint roll tucked under the left arm (viewer's left), in front of the body.
  return `<g id="kas-roll" transform="rotate(-12 200 352)">
    <rect x="86" y="326" width="214" height="52" rx="10" fill="${C.bp}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M110 340 H 270 M110 352 H 240 M110 364 H 260" stroke="${C.bpLine}" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>
    <path d="M150 334 V 370 M206 334 V 370" stroke="${C.bpLine}" stroke-width="2.5" stroke-dasharray="3 5" opacity=".7"/>
    <ellipse cx="300" cy="352" rx="15" ry="26" fill="${C.bpEnd}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M300 352 m -6 0 a 6 9 0 1 0 12 0 a 9 13 0 1 0 -16 0" fill="none" stroke="${C.bp}" stroke-width="3"/>
    <ellipse cx="86" cy="352" rx="15" ry="26" fill="${C.bpDark}" stroke="${C.ink}" stroke-width="${sw}"/>
  </g>`;
}

export function arms() {
  // Left arm wraps over the roll; right arm waves.
  const limb = (d, w = 40) => `<path d="${d}" fill="none" stroke="${C.ink}" stroke-width="${w + sw * 2 - 2}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${C.fur}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<g id="kas-arms">
    ${limb('M196 296 C 176 318 178 350 206 366')}
    <ellipse cx="216" cy="368" rx="22" ry="18" fill="${C.furShade}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M206 360 v 14 M216 358 v 16 M226 360 v 14" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>
    ${limb('M322 300 C 350 300 372 280 384 246')}
    <ellipse cx="368" cy="246" rx="11" ry="9" transform="rotate(-30 368 246)" fill="${C.furShade}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M366 236 C 364 214 374 204 390 204 C 406 204 414 216 412 236 C 410 254 400 260 388 260 C 374 260 368 252 366 236 Z" fill="${C.furShade}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M381 208 v 14 M392 206 v 15 M403 209 v 13" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>
  </g>`;
}

export function head() {
  return `<g id="kas-head">
    <circle cx="164" cy="166" r="24" fill="${C.fur}" stroke="${C.ink}" stroke-width="${sw}"/>
    <circle cx="164" cy="168" r="11" fill="${C.furShade}"/>
    <circle cx="348" cy="166" r="24" fill="${C.fur}" stroke="${C.ink}" stroke-width="${sw}"/>
    <circle cx="348" cy="168" r="11" fill="${C.furShade}"/>
    <path d="M256 104 C 330 104 360 150 360 204 C 360 262 316 300 256 300 C 196 300 152 262 152 204 C 152 150 182 104 256 104 Z" fill="${C.fur}" stroke="${C.ink}" stroke-width="${sw}"/>
    <path d="M168 232 C 176 270 210 292 256 292 C 302 292 336 270 344 232" fill="none" stroke="${C.furLight}" stroke-width="6" stroke-linecap="round" opacity=".6"/>
    <ellipse cx="190" cy="236" rx="17" ry="11" fill="${C.cheek}" opacity=".55"/>
    <ellipse cx="322" cy="236" rx="17" ry="11" fill="${C.cheek}" opacity=".55"/>
    <ellipse cx="256" cy="244" rx="56" ry="40" fill="${C.belly}" stroke="${C.ink}" stroke-width="5"/>
    <path d="M243 268 h 12 v 22 a 4 4 0 0 1 -4 4 h -4 a 4 4 0 0 1 -4 -4 Z" fill="${C.tooth}" stroke="${C.ink}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M257 268 h 12 v 22 a 4 4 0 0 1 -4 4 h -4 a 4 4 0 0 1 -4 -4 Z" fill="${C.tooth}" stroke="${C.ink}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M228 262 C 238 272 250 270 256 262 C 262 270 274 272 284 262" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M256 240 V 262" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
    <path d="M236 228 C 236 216 276 216 276 228 C 276 240 262 244 256 244 C 250 244 236 240 236 228 Z" fill="${C.ink}"/>
    <ellipse cx="248" cy="225" rx="7" ry="4" fill="${C.white}" opacity=".55"/>
    <ellipse cx="216" cy="196" rx="13" ry="16" fill="${C.ink}"/>
    <ellipse cx="296" cy="196" rx="13" ry="16" fill="${C.ink}"/>
    <circle cx="221" cy="190" r="5" fill="${C.white}"/>
    <circle cx="301" cy="190" r="5" fill="${C.white}"/>
    <circle cx="212" cy="203" r="2.2" fill="${C.white}" opacity=".8"/>
    <circle cx="292" cy="203" r="2.2" fill="${C.white}" opacity=".8"/>
    <path d="M198 170 C 206 164 222 163 230 168" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
    <path d="M282 168 C 290 163 306 164 314 170" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

export function hat() {
  return `<g id="kas-hat">
    <path d="M168 150 C 168 92 206 58 256 58 C 306 58 344 92 344 150 Z" fill="${C.hat}" stroke="${C.ink}" stroke-width="${sw}" stroke-linejoin="round"/>
    <path d="M300 74 C 326 90 338 116 340 146 L 318 146 C 316 116 310 92 300 74 Z" fill="${C.hatShade}" opacity=".7"/>
    <path d="M236 60 C 238 90 238 120 236 150 L 276 150 C 274 120 274 90 276 60 C 262 57 250 57 236 60 Z" fill="${C.hatLight}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M196 96 C 204 84 214 76 224 72" fill="none" stroke="${C.white}" stroke-width="6" stroke-linecap="round" opacity=".75"/>
    <rect x="138" y="140" width="236" height="24" rx="12" fill="${C.hat}" stroke="${C.ink}" stroke-width="${sw}"/>
    <rect x="150" y="153" width="212" height="5" rx="2.5" fill="${C.hatShade}" opacity=".8"/>
    <g transform="translate(256 112)">
      <circle r="17" fill="${C.bp}" stroke="${C.ink}" stroke-width="4.5"/>
      <path d="M-5 -9 V 9 M-5 2 L 6 -9 M-1 -2 L 7 9" fill="none" stroke="${C.white}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>`;
}

export function kasParts() {
  return [tail(), pencil(), body(), roll(), arms(), head(), hat()].join('\n');
}

export function stickerFilter(id, color, radius) {
  return `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="${radius}" result="d"/><feFlood flood-color="${color}"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

export function mascot({ dark = false, title = 'Kas, the kastor beaver' } = {}) {
  const shadow = dark ? '' : `<ellipse cx="262" cy="482" rx="170" ry="14" fill="${C.ink}" opacity=".12"/>`;
  const filter = dark ? stickerFilter('kas-rim', '#fff4df', 9) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-labelledby="kas-title"><title id="kas-title">${title}</title><defs>${filter}</defs>${shadow}<g${dark ? ' filter="url(#kas-rim)"' : ''}>${kasParts()}</g></svg>`;
}

/** Kas's head with the hard hat and the pencil, square. */
export const HEAD_VIEWBOX = '110 12 330 330';
export function headParts() {
  return [pencil(), head(), hat()].join('\n');
}

export function mascotHead({ dark = false, title = 'Kas, the kastor beaver' } = {}) {
  const filter = dark ? stickerFilter('kas-head-rim', '#fff4df', 8) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HEAD_VIEWBOX}" width="320" height="320" role="img" aria-labelledby="kas-head-title"><title id="kas-head-title">${title}</title><defs>${filter}</defs><g${dark ? ' filter="url(#kas-head-rim)"' : ''}>${headParts()}</g></svg>`;
}

/** The favicon: Kas's head on a blueprint tile. */
export function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>kastor</title><rect width="64" height="64" rx="14" fill="${C.bp}"/><path d="M0 16 H64 M0 32 H64 M0 48 H64 M16 0 V64 M32 0 V64 M48 0 V64" stroke="#ffffff" stroke-opacity=".12" stroke-width="1"/><svg x="4" y="5" width="56" height="56" viewBox="128 50 256 256">${head()}${hat()}</svg></svg>`;
}
