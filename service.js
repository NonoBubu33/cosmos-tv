// Service Cosmos (TizenBrew) : lance les applis de la télé à la demande de la page.
var http = require('http');
var fs = require('fs');
var CAND = { netflix: ['3201907018807', '11101200001'], prime: ['3201512006785', '3201910019365', 'org.tizen.primevideo'], youtube: ['111299001912'] };
var KNOWN = {};
function known(w) {
  if (KNOWN[w]) return KNOWN[w];
  var c = CAND[w] || [];
  for (var i = 0; i < c.length; i++) { try { tizen.application.getAppInfo(c[i]); KNOWN[w] = c[i]; return c[i]; } catch (e) {} }
  return null;
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function listApps(ok, ko) {
  try { tizen.application.getAppsInfo(function (l) { ok(l.map(function (a) { return { id: a.id, name: a.name }; })); }, function (e) { ko(e.message); }); }
  catch (e) { ko(e.message); }
}
// Retour automatique sur Cosmos quand l'appli lancée se ferme (Retour dans Netflix, etc.).
// Si l'utilisateur appuie sur Home, l'appli reste ouverte en arrière-plan : pas de retour forcé.
var watchT = null;
function tbApp() { try { return tizen.application.getAppInfo().packageId + '.TizenBrewStandalone'; } catch (e) { return null; } }
function watch(id) {
  if (watchT) clearInterval(watchT);
  var seen = false, n = 0;
  watchT = setInterval(function () {
    n++;
    if (n > 7200) { clearInterval(watchT); watchT = null; return; }
    try {
      tizen.application.getAppsContext(function (ctx) {
        var running = ctx.some(function (c) { return c.appId === id; });
        if (running) { seen = true; return; }
        if (seen) {
          clearInterval(watchT); watchT = null;
          var tb = tbApp();
          if (tb) { try { tizen.application.launch(tb); } catch (e) {} }
        }
      });
    } catch (e) {}
  }, 1500);
}
function launchId(id, res) {
  try { tizen.application.launch(id, function () { watch(id); send(res, 200, { ok: true, id: id }); }, function (e) { send(res, 500, { ok: false, id: id, error: e.message }); }); }
  catch (e) { send(res, 500, { ok: false, id: id, error: e.message }); }
}
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('#')[0]).split('/');
  if (p[1] === 'apps') { listApps(function (l) { send(res, 200, l); }, function (m) { send(res, 500, { error: m }); }); return; }
  if (p[1] === 'launch' && p[2]) {
    var want = p[2].toLowerCase();
    listApps(function (l) {
      var hit = null;
      l.forEach(function (a) { var n = (a.name || '').toLowerCase(); if (!hit && (n.indexOf(want) > -1 || (want === 'prime' && n.indexOf('amazon') > -1))) hit = a; });
      if (hit) launchId(hit.id, res); else if (known(want)) launchId(known(want), res); else send(res, 404, { ok: false, error: want + ' introuvable' });
    }, function () { if (known(want)) launchId(known(want), res); else send(res, 404, { ok: false, error: want + ' : liste des applis indisponible' }); });
    return;
  }
  if (p[1] === 'icon' && p[2]) {
    var w = p[2].toLowerCase();
    var sendIcon = function (id) {
      try {
        var info = tizen.application.getAppInfo(id);
        var f = String(info.iconPath || '').replace(/^file:\/\//, '');
        fs.readFile(f, function (err, data) {
          if (err) { send(res, 404, { error: err.message }); return; }
          res.writeHead(200, { 'Content-Type': /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' });
          res.end(data);
        });
      } catch (e) { send(res, 500, { error: e.message }); }
    };
    listApps(function (l) {
      var hit = null;
      l.forEach(function (a) { var n = (a.name || '').toLowerCase(); if (!hit && (n.indexOf(w) > -1 || (w === 'prime' && n.indexOf('amazon') > -1))) hit = a; });
      if (hit) sendIcon(hit.id); else if (known(w)) sendIcon(known(w)); else send(res, 404, { error: 'introuvable' });
    }, function () { if (known(w)) sendIcon(known(w)); else send(res, 404, { error: 'introuvable' }); });
    return;
  }
  if (p[1] === 'source' && p[2]) {
    var typ = p[2].toUpperCase(), num = parseInt(p[3] || '1', 10);
    try {
      tizen.tvwindow.setSource({ type: typ, number: num }, function () { send(res, 200, { ok: true }); },
        function (e) { send(res, 500, { ok: false, error: 'source : ' + e.message }); }, 'MAIN');
    } catch (e) { send(res, 500, { ok: false, error: 'source : ' + e.message }); }
    return;
  }
  if (p[1] === 'ping') { send(res, 200, { ok: true }); return; }
  send(res, 404, { error: 'inconnu' });
}).listen(8097, '127.0.0.1');
