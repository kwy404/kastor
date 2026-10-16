/* kastor seasons: picks the seasonal theme for the visitor's local date and
   sets data-season on <html>. Shared by the site and the studio. No
   dependencies. ?season=<id> forces a theme, ?season=off turns it off, and
   KastorSeasons.off(id) remembers a visitor's choice per season. */
(function (g) {
  var IDS = ['newyear', 'carnival', 'easter', 'valentine', 'junina', 'halloween', 'christmas'];
  var KEY = 'kastor:season-off:';

  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), h = (19 * a + b - d - Math.floor((b - f + 1) / 3) + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
    return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
  }

  function pt(lang) {
    return /^pt-br$/i.test(String(lang || ''));
  }

  // Overlaps resolve in this order: a fixed date first, then the movable feasts.
  function detect(date, lang) {
    var y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
    var day = new Date(y, mo - 1, d).getTime();
    var md = mo * 100 + d;
    if (md >= 1230 || md <= 102) return 'newyear';
    if (md >= 1218 && md <= 1226) return 'christmas';
    if (md >= 1024 && md <= 1031) return 'halloween';
    var e = easter(y).getTime(), D = 864e5;
    if (day >= e - 2 * D && day <= e) return 'easter';
    var ash = e - 46 * D;
    if (day >= ash - 4 * D && day <= ash) return 'carnival';
    if (md === 214 || (md === 612 && pt(lang))) return 'valentine';
    if (md >= 613 && md <= 629) return 'junina';
    return null;
  }

  var EN = { newyear: 'New Year', carnival: 'Carnival', easter: 'Easter', valentine: "Valentine's", junina: 'Midsummer', halloween: 'Halloween', christmas: 'Christmas' };
  var PT = { newyear: 'Ano Novo', carnival: 'Carnaval', easter: 'P\u00e1scoa', valentine: 'Dia dos Namorados', junina: 'Festa Junina', halloween: 'Halloween', christmas: 'Natal' };
  // The name in the page language; Festa Junina keeps its name for pt-BR visitors.
  function label(id, lang, pageInPortuguese) {
    if (pageInPortuguese) return PT[id] || '';
    return id === 'junina' && pt(lang) ? PT.junina : EN[id] || '';
  }

  function store(fn) {
    try {
      return fn(g.localStorage);
    } catch {
      return null;
    }
  }

  function visitorLang() {
    var n = g.navigator || {};
    return (n.languages && n.languages[0]) || n.language || '';
  }

  // The season for this visit: a ?season= override, else the date. A forced
  // season ignores the visitor's off switch; off turns everything off.
  function resolve(search, now, lang) {
    var m = /[?&]season=([a-z]+)/.exec(search || '');
    if (m) return { id: IDS.indexOf(m[1]) >= 0 ? m[1] : null, forced: true };
    return { id: detect(now, lang), forced: false };
  }

  function isOff(id) {
    return store(function (s) { return s.getItem(KEY + id) === '1'; }) === true;
  }

  var api = {
    ids: IDS,
    easter: easter,
    detect: detect,
    label: label,
    resolve: resolve,
    season: null,
    active: null,
    lang: visitorLang(),
    off: function (id) {
      store(function (s) { s.setItem(KEY + id, '1'); });
      apply(null);
    },
    on: function (id) {
      store(function (s) { s.removeItem(KEY + id); });
      apply(id);
    },
  };

  function apply(id) {
    api.active = id;
    var root = g.document && g.document.documentElement;
    if (!root) return;
    if (id) root.setAttribute('data-season', id);
    else root.removeAttribute('data-season');
    if (g.dispatchEvent && g.CustomEvent) g.dispatchEvent(new g.CustomEvent('kastor:season', { detail: id }));
  }

  if (g.document) {
    var r = resolve(g.location && g.location.search, new Date(), api.lang);
    api.season = r.id;
    apply(r.id && (r.forced || !isOff(r.id)) ? r.id : null);
  }
  g.KastorSeasons = api;
})(typeof window !== 'undefined' ? window : globalThis);
