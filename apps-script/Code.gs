/**
 * Calendario de Contenidos Wasabi — Backend (Google Apps Script)
 *
 * API JSON publicada como Web App. El frontend manda todo por POST con
 * Content-Type text/plain y un body { action, token, payload }.
 *
 * Script Properties necesarias (Configuración del proyecto → Propiedades del script):
 *   APP_PASSWORD  → contraseña compartida del equipo
 *   TOKEN_SECRET  → texto largo al azar para firmar los tokens
 *
 * Antes de publicar, correr setup() una vez desde el editor.
 */

var TZ = 'America/Montevideo';
var TOKEN_DIAS = 30;
var ESTADOS = ['pendiente', 'programado', 'publicado'];
var REDES = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin'];

var EQUIPOS_FIJOS = [
  { id: 'chili', nombre: 'CHILI', orden: 1 },
  { id: 'tabasco', nombre: 'TABASCO', orden: 2 },
  { id: 'putapario', nombre: 'PUTAPARIÓ', orden: 3 },
  { id: 'peppers', nombre: 'PEPPERS', orden: 4 }
];

var HEADERS = {
  Equipos: ['id', 'nombre', 'orden'],
  Marcas: ['id', 'equipo_id', 'nombre', 'color', 'redes_activas', 'activa', 'creado', 'actualizado'],
  Contenidos: ['id', 'marca_id', 'anio', 'mes', 'id_pieza', 'tipo', 'formato', 'cantidad_piezas', 'ubicacion',
    'fecha', 'hora', 'redes', 'objetivo', 'campania', 'circulacion', 'bajada', 'titulo', 'descripcion', 'link',
    'notas', 'estado_instagram', 'estado_facebook', 'estado_tiktok', 'estado_youtube', 'estado_linkedin',
    'origen', 'editado_manual', 'creado', 'actualizado']
};

// Campos que vienen del cronograma (los que compara el importador).
// Los estados por red NO están acá: el importador nunca los toca.
var CAMPOS_CRONOGRAMA = ['tipo', 'formato', 'cantidad_piezas', 'ubicacion', 'fecha', 'hora', 'redes', 'objetivo',
  'campania', 'circulacion', 'bajada', 'titulo', 'descripcion', 'link', 'notas'];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(HEADERS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    var h = HEADERS[nombre];
    // Todo como texto plano, para que la planilla no convierta fechas ni horas
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), h.length).setNumberFormat('@');
    var actuales = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, h.length).getValues()[0] : [];
    if (actuales.join('') === '') {
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  // Equipos fijos
  var eq = ss.getSheetByName('Equipos');
  var existentes = leerTabla_('Equipos').map(function (e) { return e.id; });
  EQUIPOS_FIJOS.forEach(function (e) {
    if (existentes.indexOf(e.id) < 0) eq.appendRow([e.id, e.nombre, String(e.orden)]);
  });
  var props = PropertiesService.getScriptProperties();
  var faltan = [];
  if (!props.getProperty('APP_PASSWORD')) faltan.push('APP_PASSWORD');
  if (!props.getProperty('TOKEN_SECRET')) faltan.push('TOKEN_SECRET');
  var msg = 'Setup listo.' + (faltan.length ? ' Falta cargar en Script Properties: ' + faltan.join(', ') : '');
  Logger.log(msg);
  return msg;
}

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, data: { app: 'Calendario de Contenidos Wasabi', mensaje: 'API activa. Usá POST.' } });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  try {
    var action = String(req.action || '');
    var payload = req.payload || {};
    if (action === 'login') return json_({ ok: true, data: login_(payload) });
    if (!tokenValido_(req.token)) return json_({ ok: false, code: 'AUTH', error: 'Sesión vencida o inválida. Volvé a ingresar.' });
    var fn = ACCIONES[action];
    if (!fn) return json_({ ok: false, error: 'Acción desconocida: ' + action });
    return json_({ ok: true, data: fn(payload) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACCIONES = {
  getEquipos: getEquipos_,
  getMarcas: getMarcas_,
  saveMarca: saveMarca_,
  deleteMarca: deleteMarca_,
  getContenidos: getContenidos_,
  saveContenido: saveContenido_,
  deleteContenido: deleteContenido_,
  setEstado: setEstado_,
  importPreview: importPreview_,
  importCommit: importCommit_
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Acceso: contraseña compartida + token HMAC
// ---------------------------------------------------------------------------

function login_(p) {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('APP_PASSWORD');
  var secret = props.getProperty('TOKEN_SECRET');
  if (!pass || !secret) throw new Error('Falta configurar APP_PASSWORD y TOKEN_SECRET en Script Properties.');
  if (String(p.password || '') !== pass) {
    Utilities.sleep(800); // frena intentos de fuerza bruta
    throw new Error('Contraseña incorrecta');
  }
  var exp = Date.now() + TOKEN_DIAS * 24 * 3600 * 1000;
  return { token: exp + '.' + firmar_(String(exp), secret, pass), exp: exp };
}

// La firma incluye la contraseña: al cambiarla, todos los tokens anteriores dejan de valer.
function firmar_(valor, secret, pass) {
  var bytes = Utilities.computeHmacSha256Signature(valor + '|' + pass, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function tokenValido_(token) {
  if (!token || typeof token !== 'string') return false;
  var partes = token.split('.');
  if (partes.length !== 2) return false;
  var exp = Number(partes[0]);
  if (!exp || exp < Date.now()) return false;
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  var pass = props.getProperty('APP_PASSWORD');
  if (!secret || !pass) return false;
  var esperado = firmar_(partes[0], secret, pass);
  if (esperado.length !== partes[1].length) return false;
  var diff = 0;
  for (var i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ partes[1].charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Utilidades de planilla
// ---------------------------------------------------------------------------

function hoja_(nombre) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la pestaña "' + nombre + '". Corré setup().');
  return sh;
}

function celdaATexto_(v) {
  if (v instanceof Date) {
    // Por si alguien escribió a mano y la planilla lo convirtió en fecha/hora
    if (v.getFullYear() <= 1900) return Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

function leerTabla_(nombre) {
  var sh = hoja_(nombre);
  var lastRow = sh.getLastRow();
  var h = HEADERS[nombre];
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, h.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue;
    var o = { _row: i + 2 };
    for (var j = 0; j < h.length; j++) o[h[j]] = celdaATexto_(values[i][j]);
    out.push(o);
  }
  return out;
}

function aFila_(nombre, obj) {
  return HEADERS[nombre].map(function (k) {
    var v = obj[k];
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join(',');
    return String(v);
  });
}

function escribirFila_(nombre, row, obj) {
  var h = HEADERS[nombre];
  hoja_(nombre).getRange(row, 1, 1, h.length).setNumberFormat('@').setValues([aFila_(nombre, obj)]);
}

// La planilla no deja escribir fuera de sus filas: se agregan si hacen falta
function asegurarFilas_(sh, ultimaFila) {
  var max = sh.getMaxRows();
  if (ultimaFila > max) sh.insertRowsAfter(max, ultimaFila - max + 50);
}

function agregarFilas_(nombre, objs) {
  if (!objs.length) return;
  var sh = hoja_(nombre);
  var h = HEADERS[nombre];
  var start = sh.getLastRow() + 1;
  asegurarFilas_(sh, start + objs.length - 1);
  var rows = objs.map(function (o) { return aFila_(nombre, o); });
  sh.getRange(start, 1, rows.length, h.length).setNumberFormat('@').setValues(rows);
}

function conLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function ahora_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function nuevoId_(prefijo) {
  return prefijo + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function listaRedes_(v) {
  var arr = Array.isArray(v) ? v : String(v || '').split(',');
  var set = {};
  arr.forEach(function (x) { x = normalizar_(x); if (REDES.indexOf(x) >= 0) set[x] = true; });
  return REDES.filter(function (r) { return set[r]; });
}

// ---------------------------------------------------------------------------
// Equipos y marcas
// ---------------------------------------------------------------------------

function getEquipos_() {
  return leerTabla_('Equipos').map(function (e) {
    return { id: e.id, nombre: e.nombre, orden: Number(e.orden) || 0 };
  }).sort(function (a, b) { return a.orden - b.orden; });
}

function marcaOut_(m) {
  return {
    id: m.id, equipo_id: m.equipo_id, nombre: m.nombre, color: m.color || '#92C100',
    redes_activas: listaRedes_(m.redes_activas), activa: m.activa !== 'false',
    creado: m.creado, actualizado: m.actualizado
  };
}

function getMarcas_() {
  return leerTabla_('Marcas').map(marcaOut_).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

function saveMarca_(p) {
  var m = p.marca || p;
  var nombre = String(m.nombre || '').trim();
  if (!nombre) throw new Error('La marca necesita un nombre.');
  var equipos = getEquipos_().map(function (e) { return e.id; });
  if (equipos.indexOf(m.equipo_id) < 0) throw new Error('Equipo inválido.');
  var color = /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? m.color : '#92C100';
  return conLock_(function () {
    var marcas = leerTabla_('Marcas');
    var dup = marcas.filter(function (x) { return x.id !== m.id && normalizar_(x.nombre) === normalizar_(nombre) && x.equipo_id === m.equipo_id; });
    if (dup.length) throw new Error('Ya existe una marca "' + nombre + '" en ese equipo.');
    var t = ahora_();
    var existente = m.id ? marcas.filter(function (x) { return x.id === m.id; })[0] : null;
    var obj = {
      id: existente ? existente.id : nuevoId_('m'),
      equipo_id: m.equipo_id, nombre: nombre, color: color,
      redes_activas: listaRedes_(m.redes_activas).join(','),
      activa: m.activa === false || m.activa === 'false' ? 'false' : 'true',
      creado: existente ? existente.creado : t, actualizado: t
    };
    if (existente) escribirFila_('Marcas', existente._row, obj);
    else agregarFilas_('Marcas', [obj]);
    return marcaOut_(obj);
  });
}

// Borra una marca solo si no tiene contenidos. Para ocultarla sin perder
// historial, usar saveMarca con activa = false (archivar).
function deleteMarca_(p) {
  return conLock_(function () {
    var m = leerTabla_('Marcas').filter(function (x) { return x.id === p.id; })[0];
    if (!m) throw new Error('La marca no existe.');
    var tiene = leerTabla_('Contenidos').some(function (c) { return c.marca_id === p.id; });
    if (tiene) throw new Error('La marca tiene contenidos cargados. Archivala en lugar de borrarla.');
    hoja_('Marcas').deleteRow(m._row);
    return { id: p.id };
  });
}

// ---------------------------------------------------------------------------
// Contenidos
// ---------------------------------------------------------------------------

function contenidoOut_(c) {
  var o = {};
  HEADERS.Contenidos.forEach(function (k) { o[k] = c[k]; });
  o.anio = Number(c.anio) || 0;
  o.mes = Number(c.mes) || 0;
  o.cantidad_piezas = Number(c.cantidad_piezas) || 1;
  o.redes = listaRedes_(c.redes);
  o.editado_manual = c.editado_manual === 'true';
  return o;
}

function getContenidos_(p) {
  var marcaIds = null;
  if (p.marca_id) marcaIds = [p.marca_id];
  else if (p.equipo_id) {
    marcaIds = leerTabla_('Marcas').filter(function (m) { return m.equipo_id === p.equipo_id; }).map(function (m) { return m.id; });
  }
  var desde = p.desde || '0000-00-00', hasta = p.hasta || '9999-99-99';
  return leerTabla_('Contenidos').filter(function (c) {
    if (marcaIds && marcaIds.indexOf(c.marca_id) < 0) return false;
    if (!c.fecha) return p.incluirSinFecha === true;
    return c.fecha >= desde && c.fecha <= hasta;
  }).map(contenidoOut_);
}

// Normaliza los campos editables que llegan del frontend
function limpiarContenido_(c) {
  var o = {};
  o.id_pieza = String(c.id_pieza || '').replace(/\s+/g, ' ').trim();
  o.tipo = c.tipo === 'story' ? 'story' : 'feed';
  o.formato = String(c.formato || '').trim();
  o.cantidad_piezas = String(Math.max(1, parseInt(c.cantidad_piezas, 10) || 1));
  o.ubicacion = String(c.ubicacion || '').trim();
  o.fecha = /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '') ? c.fecha : '';
  o.hora = /^\d{2}:\d{2}$/.test(c.hora || '') ? c.hora : '';
  o.redes = listaRedes_(c.redes).join(',');
  ['objetivo', 'campania', 'circulacion', 'bajada', 'titulo', 'descripcion', 'link', 'notas'].forEach(function (k) {
    o[k] = String(c[k] || '').replace(/\r\n/g, '\n').trim();
  });
  return o;
}

function estadosPara_(redesCsv, actual) {
  var redes = redesCsv ? redesCsv.split(',') : [];
  var o = {};
  REDES.forEach(function (r) {
    var k = 'estado_' + r;
    var v = actual && actual[k];
    if (redes.indexOf(r) >= 0) o[k] = ESTADOS.indexOf(v) >= 0 ? v : 'pendiente';
    else o[k] = ESTADOS.indexOf(v) >= 0 ? v : ''; // se conserva por si se vuelve a activar la red
  });
  return o;
}

function saveContenido_(p) {
  var c = p.contenido || p;
  if (!c.marca_id) throw new Error('Falta la marca.');
  var limpio = limpiarContenido_(c);
  if (!limpio.id_pieza) throw new Error('Falta el Id de la pieza.');
  if (!limpio.fecha) throw new Error('Falta la fecha.');
  return conLock_(function () {
    var marcas = leerTabla_('Marcas').map(function (m) { return m.id; });
    if (marcas.indexOf(c.marca_id) < 0) throw new Error('La marca no existe.');
    var t = ahora_();
    var existente = c.id ? leerTabla_('Contenidos').filter(function (x) { return x.id === c.id; })[0] : null;
    var obj;
    if (existente) {
      obj = Object.assign({}, existente, limpio);
      obj.marca_id = c.marca_id;
      // Estados: si vienen en el pedido, se respetan; si no, se mantienen
      REDES.forEach(function (r) {
        var k = 'estado_' + r;
        if (c[k] !== undefined && (ESTADOS.indexOf(c[k]) >= 0 || c[k] === '')) obj[k] = c[k];
      });
      Object.assign(obj, estadosPara_(obj.redes, obj));
      var cambio = CAMPOS_CRONOGRAMA.some(function (k) { return String(existente[k] || '') !== String(obj[k] || ''); });
      if (existente.origen === 'import' && cambio) obj.editado_manual = 'true';
      obj.anio = obj.fecha.slice(0, 4);
      obj.mes = String(Number(obj.fecha.slice(5, 7)));
      if (existente.origen === 'import') { obj.anio = existente.anio; obj.mes = existente.mes; } // sigue perteneciendo a su cronograma
      obj.actualizado = t;
      escribirFila_('Contenidos', existente._row, obj);
    } else {
      obj = Object.assign({ id: nuevoId_('c'), marca_id: c.marca_id }, limpio);
      obj.anio = obj.fecha.slice(0, 4);
      obj.mes = String(Number(obj.fecha.slice(5, 7)));
      REDES.forEach(function (r) { var k = 'estado_' + r; if (ESTADOS.indexOf(c[k]) >= 0) obj[k] = c[k]; });
      Object.assign(obj, estadosPara_(obj.redes, obj));
      obj.origen = 'manual';
      obj.editado_manual = 'false';
      obj.creado = t; obj.actualizado = t;
      agregarFilas_('Contenidos', [obj]);
    }
    return contenidoOut_(obj);
  });
}

function deleteContenido_(p) {
  return conLock_(function () {
    var c = leerTabla_('Contenidos').filter(function (x) { return x.id === p.id; })[0];
    if (!c) throw new Error('El contenido no existe (¿ya lo borró alguien?).');
    hoja_('Contenidos').deleteRow(c._row);
    return { id: p.id };
  });
}

function setEstado_(p) {
  var red = String(p.red || '');
  var estado = String(p.estado || '');
  if (REDES.indexOf(red) < 0) throw new Error('Red inválida.');
  if (ESTADOS.indexOf(estado) < 0) throw new Error('Estado inválido.');
  return conLock_(function () {
    var c = leerTabla_('Contenidos').filter(function (x) { return x.id === p.id; })[0];
    if (!c) throw new Error('El contenido no existe.');
    if (listaRedes_(c.redes).indexOf(red) < 0) throw new Error('Ese contenido no se publica en ' + red + '.');
    var col = HEADERS.Contenidos.indexOf('estado_' + red) + 1;
    var colAct = HEADERS.Contenidos.indexOf('actualizado') + 1;
    var sh = hoja_('Contenidos');
    var t = ahora_();
    sh.getRange(c._row, col).setValue(estado);
    sh.getRange(c._row, colAct).setValue(t);
    c['estado_' + red] = estado;
    c.actualizado = t;
    return contenidoOut_(c);
  });
}

// ---------------------------------------------------------------------------
// Importador
// ---------------------------------------------------------------------------

// Clave de comparación: marca + año + mes + id_pieza + fecha (+ tipo, porque
// en los cronogramas a veces el feed y la story comparten Id y fecha).
function claveImport_(marcaId, anio, mes, idPieza, fecha, tipo) {
  return [marcaId, Number(anio), Number(mes), normalizar_(idPieza), fecha, tipo === 'story' ? 'story' : 'feed'].join('|');
}

function valorComparable_(k, v) {
  if (k === 'redes') return listaRedes_(v).join(',');
  if (k === 'cantidad_piezas') return String(Math.max(1, parseInt(v, 10) || 1));
  return String(v === null || v === undefined ? '' : v).replace(/\r\n/g, '\n').trim();
}

function importPreview_(p) {
  var marcaId = p.marca_id, anio = Number(p.anio), mes = Number(p.mes);
  if (!marcaId || !anio || !mes) throw new Error('Faltan marca, año o mes.');
  var existentes = leerTabla_('Contenidos').filter(function (c) {
    return c.marca_id === marcaId && Number(c.anio) === anio && Number(c.mes) === mes && c.origen === 'import';
  });
  var mapa = {};
  existentes.forEach(function (c) { mapa[claveImport_(marcaId, anio, mes, c.id_pieza, c.fecha, c.tipo)] = c; });

  var modificados = [], sinCambios = 0, vistos = {}, usados = {}, sueltos = [];
  function comparar(e, n, idx) {
    usados[e.id] = true;
    var cambios = [];
    CAMPOS_CRONOGRAMA.forEach(function (campo) {
      var a = valorComparable_(campo, e[campo]), b = valorComparable_(campo, n[campo]);
      if (a !== b) cambios.push({ campo: campo, antes: a, despues: b });
    });
    if (cambios.length) modificados.push({ idx: idx, id: e.id, contenido: n, cambios: cambios, editado_manual: e.editado_manual === 'true' });
    else sinCambios++;
  }

  // 1) Coincidencia exacta: marca + año + mes + id_pieza + fecha + tipo
  (p.contenidos || []).forEach(function (raw, idx) {
    var n = limpiarContenido_(raw);
    var k = claveImport_(marcaId, anio, mes, n.id_pieza, n.fecha, n.tipo);
    if (vistos[k]) return; // duplicado dentro del mismo archivo
    vistos[k] = true;
    if (mapa[k]) comparar(mapa[k], n, idx);
    else sueltos.push({ idx: idx, n: n });
  });

  // 2) Respaldo: si de una pieza (Id + tipo) queda exactamente una sin pareja de cada
  //    lado, es la misma con la fecha cambiada (por ejemplo, la movieron a mano).
  //    Así no se duplica ni se pierden sus estados.
  var idTipo = function (id, tipo) { return normalizar_(id) + '|' + (tipo === 'story' ? 'story' : 'feed'); };
  var restantes = existentes.filter(function (c) { return !usados[c.id]; });
  var nuevos = [];
  sueltos.forEach(function (s) {
    var k = idTipo(s.n.id_pieza, s.n.tipo);
    var candidatosNuevos = sueltos.filter(function (o) { return idTipo(o.n.id_pieza, o.n.tipo) === k; });
    var candidatosViejos = restantes.filter(function (c) { return !usados[c.id] && idTipo(c.id_pieza, c.tipo) === k; });
    if (candidatosNuevos.length === 1 && candidatosViejos.length === 1) comparar(candidatosViejos[0], s.n, s.idx);
    else nuevos.push({ idx: s.idx, contenido: s.n });
  });

  var eliminados = existentes.filter(function (c) { return !usados[c.id]; }).map(contenidoOut_);
  var manuales = leerTabla_('Contenidos').filter(function (c) {
    return c.marca_id === marcaId && Number(c.anio) === anio && Number(c.mes) === mes && c.origen !== 'import';
  }).length;
  return { nuevos: nuevos, modificados: modificados, eliminados: eliminados, sinCambios: sinCambios, manuales: manuales, existentes: existentes.length };
}

/**
 * payload: { marca_id, anio, mes,
 *   nuevos: [contenido], actualizar: [{ id, contenido, pisarManual }], eliminar: [id] }
 * Hace UNA sola lectura y UNA sola escritura grande de la pestaña Contenidos.
 */
function importCommit_(p) {
  var marcaId = p.marca_id, anio = Number(p.anio), mes = Number(p.mes);
  if (!marcaId || !anio || !mes) throw new Error('Faltan marca, año o mes.');
  return conLock_(function () {
    if (!leerTabla_('Marcas').some(function (m) { return m.id === marcaId; })) throw new Error('La marca no existe.');
    var sh = hoja_('Contenidos');
    var h = HEADERS.Contenidos;
    var todos = leerTabla_('Contenidos');
    var t = ahora_();
    var porId = {};
    todos.forEach(function (c) { porId[c.id] = c; });
    var claves = {};
    todos.forEach(function (c) {
      if (c.marca_id === marcaId && Number(c.anio) === anio && Number(c.mes) === mes && c.origen === 'import') {
        claves[claveImport_(marcaId, anio, mes, c.id_pieza, c.fecha, c.tipo)] = c;
      }
    });
    var res = { agregados: 0, actualizados: 0, conservados: 0, eliminados: 0, omitidosDuplicados: 0 };

    (p.actualizar || []).forEach(function (u) {
      var c = porId[u.id];
      if (!c || c.marca_id !== marcaId) return;
      if (c.editado_manual === 'true' && !u.pisarManual) { res.conservados++; return; }
      var n = limpiarContenido_(u.contenido || {});
      CAMPOS_CRONOGRAMA.forEach(function (k) { c[k] = n[k]; });
      // Nunca se tocan los estados existentes; solo se completa 'pendiente' en redes nuevas
      var est = estadosPara_(c.redes, c);
      REDES.forEach(function (r) { var k = 'estado_' + r; if (!c[k]) c[k] = est[k]; });
      c.editado_manual = 'false';
      c.actualizado = t;
      res.actualizados++;
    });

    var borrar = {};
    (p.eliminar || []).forEach(function (id) {
      var c = porId[id];
      if (c && c.marca_id === marcaId) { borrar[id] = true; res.eliminados++; }
    });

    var nuevos = [];
    (p.nuevos || []).forEach(function (raw) {
      var n = limpiarContenido_(raw);
      if (!n.id_pieza || !n.fecha) return;
      var k = claveImport_(marcaId, anio, mes, n.id_pieza, n.fecha, n.tipo);
      if (claves[k] && !borrar[claves[k].id]) { res.omitidosDuplicados++; return; } // ya existe: no duplicar
      var obj = Object.assign({ id: nuevoId_('c'), marca_id: marcaId, anio: String(anio), mes: String(mes) }, n);
      Object.assign(obj, estadosPara_(obj.redes, null));
      obj.origen = 'import'; obj.editado_manual = 'false'; obj.creado = t; obj.actualizado = t;
      claves[k] = obj;
      nuevos.push(obj);
      res.agregados++;
    });

    // Una sola escritura: se reescribe la tabla completa
    var filas = todos.filter(function (c) { return !borrar[c.id]; }).concat(nuevos).map(function (c) { return aFila_('Contenidos', c); });
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, h.length).clearContent();
    asegurarFilas_(sh, filas.length + 1);
    if (filas.length) sh.getRange(2, 1, filas.length, h.length).setNumberFormat('@').setValues(filas);
    return res;
  });
}
