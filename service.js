// Service Cosmos (TizenBrew) : lance les applis de la télé à la demande de la page.
var http = require('http');
var KNOWN = { netflix: '3201907018807', prime: '3201910019365', youtube: '111299001912' };
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function listApps(ok, ko) {
  try { tizen.application.getAppsInfo(function (l) { ok(l.map(function (a) { return { id: a.id, name: a.name }; })); }, function (e) { ko(e.message); }); }
  catch (e) { ko(e.message); }
}
function launchId(id, res) {
  try { tizen.application.launch(id, function () { send(res, 200, { ok: true, id: id }); }, function (e) { send(res, 500, { ok: false, id: id, error: e.message }); }); }
  catch (e) { send(res, 500, { ok: false, id: id, error: e.message }); }
}
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]).split('/');
  if (p[1] === 'apps') { listApps(function (l) { send(res, 200, l); }, function (m) { send(res, 500, { error: m }); }); return; }
  if (p[1] === 'launch' && p[2]) {
    var want = p[2].toLowerCase();
    listApps(function (l) {
      var hit = null;
      l.forEach(function (a) { var n = (a.name || '').toLowerCase(); if (!hit && n.indexOf(want) > -1) hit = a; });
      if (hit) launchId(hit.id, res); else if (KNOWN[want]) launchId(KNOWN[want], res); else send(res, 404, { ok: false, error: want + ' introuvable' });
    }, function () { if (KNOWN[want]) launchId(KNOWN[want], res); else send(res, 404, { ok: false, error: want + ' : liste des applis indisponible' }); });
    return;
  }
  if (p[1] === 'ping') { send(res, 200, { ok: true }); return; }
  send(res, 404, { error: 'inconnu' });
}).listen(8097, '127.0.0.1');
