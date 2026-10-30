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
// API locale de la télé (port 8001) : état des applis et télécommande virtuelle.
function rest(method, path, cb) {
  try {
    var r = http.request({ host: '127.0.0.1', port: 8001, path: '/api/v2/' + path, method: method, headers: { 'Content-Length': 0 } }, function (res) {
      var d = ''; res.on('data', function (x) { d += x; });
      res.on('end', function () { var j = null; try { j = JSON.parse(d); } catch (e) {} cb(null, j, res.statusCode); });
    });
    r.on('error', function (e) { cb(e); });
    r.setTimeout(3000, function () { try { r.abort(); } catch (e) {} });
    r.end();
  } catch (e) { cb(e); }
}
// Retour automatique : quand l'appli lancée est réellement fermée (Retour jusqu'à la sortie, Retour long), on relance Cosmos.
// Si elle est seulement cachée (touche Maison), on ne force rien : l'accueil Samsung reste accessible.
function watch(id) {
  stopWatch(); watched = id; since = Date.now();
  var seen = false, ticks = 0, lastState = '';
  log('surveillance ' + id);
  watchT = setInterval(function () {
    ticks++;
    rest('GET', 'applications/' + id, function (err, j) {
      if (watched !== id) return;
      if (err || !j) { if (ticks % 30 === 1) log('état appli KO ' + (err ? err.message : 'vide')); return; }
      var st = (j.running ? 'R' : '-') + (j.visible ? 'V' : '-');
      if (st !== lastState) { log('état ' + id + ' ' + st); lastState = st; }
      if (j.running && j.visible) { seen = true; return; }
      if (seen && !j.running) back('fermée');
    });
    if (ticks > 21600) stopWatch();
  }, 1000);
}
// Télécommande virtuelle (même canal que l'appli SmartThings) : la 1re fois, la télé demande d'autoriser « Cosmos ».
var TOKEN = null, TOKF = '/home/owner/share/cosmos-token.txt';
try { TOKEN = fs.readFileSync(TOKF, 'utf8').trim() || null; } catch (e) {}
function wsLib() { var n = ['ws-old', 'ws-new', 'ws']; for (var i = 0; i < n.length; i++) { try { return require(n[i]); } catch (e) {} } return null; }
function sendKey(key, cb) {
  var WS = wsLib(); if (!WS) { cb('module ws absent'); return; }
  var name = new Buffer('Cosmos').toString('base64');
  var urls = ['wss://127.0.0.1:8002/api/v2/channels/samsung.remote.control?name=' + name + (TOKEN ? '&token=' + TOKEN : ''),
              'ws://127.0.0.1:8001/api/v2/channels/samsung.remote.control?name=' + name];
  var lastErr = '';
  (function next(i) {
    if (i >= urls.length) { cb(lastErr || 'télécommande indisponible'); return; }
    var done = false, w;
    var fin = function (ok, why) { if (done) return; done = true; clearTimeout(t); try { w.close(); } catch (e) {} if (ok) cb(null); else { lastErr = why; if (why === 'refusé') cb('autorisation refusée sur la télé'); else next(i + 1); } };
    var t = setTimeout(function () { fin(false, 'délai dépassé'); }, TOKEN ? 6000 : 30000);
    try { w = new WS(urls[i], { rejectUnauthorized: false }); } catch (e) { fin(false, e.message); return; }
    w.on('message', function (m) {
      var j = {}; try { j = JSON.parse(m); } catch (e) {}
      if (j.event === 'ms.channel.connect') {
        if (j.data && j.data.token) { TOKEN = j.data.token; try { fs.writeFileSync(TOKF, TOKEN); } catch (e) {} }
        try { w.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } })); } catch (e) { fin(false, e.message); return; }
        log('touche ' + key + ' envoyée (' + (i === 0 ? '8002' : '8001') + ')');
        setTimeout(function () { fin(true); }, 500);
      } else if (j.event === 'ms.channel.unauthorized') fin(false, 'refusé');
    });
    w.on('error', function (e) { fin(false, e && e.message); });
  })(0);
}
function launchId(id, res) {
  try {
    log('lancement ' + id);
    tizen.application.launch(id, function () { watch(id); send(res, 200, { ok: true, id: id }); },
      function (e) { send(res, 500, { ok: false, error: e.message }); });
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
}
function openSettings(res) {
  sendKey('KEY_MENU', function (err) { if (!err) { send(res, 200, { ok: true }); return; } log('menu par touche KO : ' + err); openSettingsApp(res); });
}
function openSettingsApp(res) {
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
    var num = parseInt(p[3] || '1', 10), key = b === 'tv' ? 'KEY_TV' : 'KEY_HDMI' + num;
    stopWatch();
    sendKey(key, function (err) { if (err) send(res, 500, { ok: false, error: err }); else send(res, 200, { ok: true }); });
    return;
  }
  if (a === 'key' && b) { sendKey(p[2], function (err) { send(res, err ? 500 : 200, { ok: !err, error: err }); }); return; }
  send(res, 404, { error: 'inconnu' });
}).on('error', function (e) { log('serveur : ' + e.message); }).listen(8097, '127.0.0.1');
listApps(function () {});
