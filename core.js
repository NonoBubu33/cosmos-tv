// Cœur du service Cosmos 2 (TizenBrew) : lance les applis / sources de la télé et ramène sur Cosmos quand on quitte une appli.
var http = require('http');
var fs = require('fs');
var CAND = {
  netflix: ['3201907018807', '11101200001'],
  prime: ['3201910019365', '3201910019354', '3201512006785', 'org.tizen.primevideo'],
  youtube: ['111299001912', '3201906018693'],
  settings: ['com.samsung.tv.coba.setting', 'com.samsung.tv.menu', 'org.tizen.setting', 'com.samsung.tv.settings', 'com.samsung.tv.quick-settings']
};
var NAMES = {
  netflix: ['netflix'],
  prime: ['prime video', 'amazon prime', 'prime', 'amazon'],
  youtube: ['youtube'],
  settings: ['paramètres', 'parametres', 'réglages', 'settings']
};
var EXACT = {
  tv: ['tv', 'live tv', 'tv en direct', 'télévision', 'television', 'tv viewer']
};
var APPS = null, KNOWN = {};
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function listApps(cb) {
  if (APPS) { cb(APPS); return; }
  try {
    tizen.application.getAppsInfo(function (l) { APPS = l.map(function (a) { return { id: a.id, name: a.name || '' }; }); cb(APPS); }, function () { cb([]); });
  } catch (e) { cb([]); }
}
// Trouve l'identifiant d'une appli : d'abord par son nom (ordre de préférence), puis par identifiants connus.
function find(w, cb) {
  if (KNOWN[w]) { cb(KNOWN[w]); return; }
  listApps(function (l) {
    var names = NAMES[w] || [w], hit = null, dum = null;
    var ex = EXACT[w];
    if (ex) { for (var x = 0; x < l.length && !hit; x++) if (ex.indexOf(l[x].name.toLowerCase().trim()) > -1) hit = l[x].id; names = []; }
    for (var i = 0; i < names.length && !hit; i++) {
      for (var j = 0; j < l.length; j++) {
        var n = l[j].name.toLowerCase();
        if (n.indexOf(names[i]) > -1 && n.indexOf('tizenbrew') < 0) { if (/dummy/i.test(l[j].id)) { dum = dum || l[j].id; continue; } hit = l[j].id; break; }
      }
    }
    if (!hit) {
      var c = CAND[w] || [];
      for (var k = 0; k < c.length && !hit; k++) { try { tizen.application.getAppInfo(c[k]); hit = c[k]; } catch (e) {} }
    }
    if (hit && !/dummy/i.test(hit)) KNOWN[w] = hit;
    cb(hit || dum);
  });
}
// Retour automatique sur Cosmos : dès que l'appli lancée n'est plus au premier plan ni en cours, on relance TizenBrew (Cosmos).
// Bouton Home : l'appli reste en arrière-plan, donc pas de retour forcé.
var watchT = null, lsn = null, watched = null, since = 0, pend = null;
var LOG = [];
function log(m) { var d = new Date(); LOG.push(d.toTimeString().slice(0, 8) + ' ' + m); if (LOG.length > 40) LOG.shift(); }
// Journal de toutes les activations (sert à régler le retour après le premier test sur la télé).
try { tizen.application.addAppStatusChangeListener(function (appId, st) { log(st + ' ' + appId); if (st === 'ACTIVATE' && appId === watched && pend) { clearTimeout(pend); pend = null; log('retour annulé (appli revenue)'); } }); } catch (e) { log('listener global KO ' + e.message); }
function tbApp() { try { return tizen.application.getAppInfo().packageId + '.TizenBrewStandalone'; } catch (e) { return null; } }
function back(why) {
  stopWatch();
  var tb = tbApp();
  log('retour Cosmos (' + why + ')');
  if (tb) { try { tizen.application.launch(tb); } catch (e) { log('relance KO ' + e.message); } }
}
function stopWatch() {
  if (watchT) { clearInterval(watchT); watchT = null; }
  if (lsn !== null) { try { tizen.application.removeAppStatusChangeListener(lsn); } catch (e) {} lsn = null; }
  if (pend) { clearTimeout(pend); pend = null; }
  watched = null;
}
// Retour automatique : l'appli lancée passe en arrière-plan (Retour, sortie) ou se ferme → on relance Cosmos.
// Rien pendant les 5 premières secondes, et on attend 1,5 s pour ignorer les désactivations brèves (profils, pubs).
function watch(id) {
  stopWatch(); watched = id; since = Date.now();
  try {
    lsn = tizen.application.addAppStatusChangeListener(function (appId, status) {
      if (appId !== watched || status !== 'DEACTIVATE' || Date.now() - since < 5000) return;
      if (pend) clearTimeout(pend);
      pend = setTimeout(function () { pend = null; back('désactivée'); }, 1500);
    }, id);
    log('surveillance ' + id + ' (écoute OK)');
  } catch (e) { lsn = null; log('surveillance ' + id + ' : écoute KO ' + e.message); }
  var seen = false, ticks = 0;
  watchT = setInterval(function () {
    try {
      tizen.application.getAppsContext(function (ctx) {
        var running = false;
        for (var i = 0; i < ctx.length; i++) if (ctx[i].appId === id) running = true;
        ticks++;
        if (running) { if (!seen) log('en cours : ' + id + ' (' + ctx.length + ' applis)'); seen = true; return; }
        if (seen) back('fermée'); else if (ticks === 20) log('jamais vue en cours : ' + id);
      }, function (e) { if (ticks++ % 40 === 0) log('contexte KO ' + e.message); });
    } catch (e) { if (ticks++ % 40 === 0) log('contexte KO ' + e.message); }
  }, 500);
}
function launchId(id, res) {
  try {
    log('lancement ' + id);
    tizen.application.launch(id, function () { watch(id); send(res, 200, { ok: true, id: id }); },
      function (e) { send(res, 500, { ok: false, error: e.message }); });
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
}
function openSettings(res) {
  var pre = null; try { tizen.application.getAppInfo('com.samsung.tv.coba.setting'); pre = 'com.samsung.tv.coba.setting'; } catch (e) {}
  if (pre) { launchId(pre, res); return; }
  find('settings', function (id) {
    if (id) { launchId(id, res); return; }
    try {
      var ac = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/setting');
      tizen.application.launchAppControl(ac, null, function () { send(res, 200, { ok: true }); },
        function (e) { send(res, 500, { ok: false, error: 'réglages indisponibles — bouton Maison' }); });
    } catch (e) { send(res, 500, { ok: false, error: 'réglages indisponibles — bouton Maison' }); }
  });
}
function srcFail(res, m) {
  listApps(function (l) {
    var c = l.filter(function (x) { return /tv|source|hdmi|live|channel|cha[iî]ne/i.test(x.name + ' ' + x.id); }).slice(0, 6).map(function (x) { return x.name; });
    send(res, 500, { ok: false, error: 'bascule impossible (' + m + ')' + (c.length ? ' — touche rouge : diagnostic' : '') });
  });
}
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]).split('/');
  var a = p[1], b = (p[2] || '').toLowerCase();
  if (a === 'ping') { send(res, 200, { ok: true }); return; }
  if (a === 'apps') { APPS = null; listApps(function (l) { var f = b === 'all' ? l : l.filter(function (x) { return /tv|channel|epg|hdmi|source|setting|netflix|prime|youtube|disney|canal|plus|live|vod|player|viewer/i.test(x.name + ' ' + x.id); }); send(res, 200, [{ name: '» Cosmos (retour) = ' + tbApp(), id: 'self' }].concat(LOG.map(function (m) { return { name: '» ' + m, id: 'log' }; }), [{ name: '— applis utiles (' + f.length + '/' + l.length + ') —', id: '' }], f)); }); return; }
  if (a === 'settings') { openSettings(res); return; }
  if (a === 'launch' && b) {
    APPS = null; if (KNOWN[b] && /dummy/i.test(KNOWN[b])) delete KNOWN[b];
    find(b, function (id) {
      if (id && /dummy/i.test(id)) { send(res, 404, { ok: false, error: 'pas installée sur la télé — installe-la depuis Applis' }); return; }
      if (id) launchId(id, res); else send(res, 404, { ok: false, error: 'appli non installée' });
    });
    return;
  }
  if (a === 'icon' && b) {
    find(b, function (id) {
      if (!id) { send(res, 404, { error: 'introuvable' }); return; }
      try {
        var f = String(tizen.application.getAppInfo(id).iconPath || '').replace(/^file:\/\//, '');
        fs.readFile(f, function (err, data) {
          if (err) { send(res, 404, { error: err.message }); return; }
          res.writeHead(200, { 'Content-Type': /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=604800' });
          res.end(data);
        });
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }
  if (a === 'source' && b) {
    var num = parseInt(p[3] || '1', 10), typ = b.toUpperCase();
    var viaWindow = function () {
      try {
        tizen.tvwindow.setSource({ type: typ, number: num }, function () { send(res, 200, { ok: true }); },
          function (e) { srcFail(res, e.message); }, 'MAIN');
      } catch (e) { srcFail(res, e.message); }
    };
    if (typ === 'TV') find('tv', function (id) { if (id) launchId(id, res); else viaWindow(); });
    else viaWindow();
    return;
  }
  send(res, 404, { error: 'inconnu' });
}).on('error', function (e) { log('serveur : ' + e.message); }).listen(8097, '127.0.0.1');
listApps(function () {});
