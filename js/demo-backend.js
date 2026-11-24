// demo-backend.js — Modo demo: ejecuta el apps-script/Code.gs real DENTRO del navegador.
// Se activa cuando config.js todavía no tiene la URL del Web App (o con ?demo=1).
// La "planilla" se guarda en localStorage: los datos quedan solo en este navegador.
// Contraseña del modo demo: "demo".

const KEY = 'wasabi.demo.planilla';
export const DEMO_PASSWORD = 'demo';

class Sheet {
  constructor(name, rows = [], maxRows = 1000) { this.name = name; this.rows = rows; this.maxRows = maxRows; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => v !== '' && v != null)) return i + 1;
    return 0;
  }
  insertRowsAfter(after, n) { this.maxRows += n; }
  setFrozenRows() {}
  appendRow(arr) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; this.rows[r - 1] = arr.map(String); }
  deleteRow(r) { this.rows.splice(r - 1, 1); this.maxRows--; }
  getRange(row, col, nr = 1, nc = 1) {
    if (row < 1 || row + nr - 1 > this.maxRows) throw new Error(`Rango fuera de la hoja ${this.name}`);
    const sh = this;
    const range = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const src = sh.rows[row - 1 + i] || []; const r = []; for (let j = 0; j < nc; j++) r.push(src[col - 1 + j] ?? ''); out.push(r); }
        return out;
      },
      setValues(vals) {
        for (let i = 0; i < nr; i++) { const r = sh.rows[row - 1 + i] || (sh.rows[row - 1 + i] = []); for (let j = 0; j < nc; j++) r[col - 1 + j] = vals[i][j] == null ? '' : String(vals[i][j]); }
        return range;
      },
      setValue(v) { return range.setValues([[v]]); },
      clearContent() { for (let i = 0; i < nr; i++) { const r = sh.rows[row - 1 + i]; if (r) for (let j = 0; j < nc; j++) r[col - 1 + j] = ''; } return range; },
      setNumberFormat() { return range; },
      setFontWeight() { return range; },
    };
    return range;
  }
}

const sheets = new Map();
let memoria = null; // si localStorage no está disponible, los datos viven solo mientras la pestaña está abierta
function cargar() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = memoria; }
  for (const [n, s] of Object.entries(d || {})) sheets.set(n, new Sheet(n, s.rows, s.maxRows));
}
function guardar() {
  const o = {};
  for (const [n, s] of sheets) o[n] = { rows: s.rows.slice(0, s.getLastRow()), maxRows: s.maxRows };
  memoria = o;
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* queda en memoria */ }
}

// Firma de 32 bytes, sincrónica (solo para la demo: todo queda en este navegador)
function firmaDemo(valor, clave) {
  const out = [];
  let h = 2166136261;
  const s = clave + '|' + valor;
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < s.length; j++) { h ^= s.charCodeAt(j) + i; h = Math.imul(h, 16777619) >>> 0; }
    out.push((h & 255) > 127 ? (h & 255) - 256 : h & 255);
  }
  return out;
}

function formatDate(date, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => lit !== undefined ? lit :
    ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second })[m]);
}

let backend = null;

async function iniciar() {
  cargar();
  const code = await (await fetch(new URL('../apps-script/Code.gs', import.meta.url))).text();
  const shims = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      setSpreadsheetTimeZone() {},
      getSheetByName: n => sheets.get(n) || null,
      insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; },
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ APP_PASSWORD: DEMO_PASSWORD, TOKEN_SECRET: 'secreto-demo' })[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Utilities: {
      computeHmacSha256Signature: firmaDemo,
      base64EncodeWebSafe: bytes => btoa(String.fromCharCode(...bytes.map(b => b & 255))).replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate,
      getUuid: () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16)),
      sleep() {},
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
  };
  const fn = new Function(...Object.keys(shims), code + '\nreturn { doPost: doPost, setup: setup };');
  backend = fn(...Object.values(shims));
  backend.setup();
  guardar();
}

let listo = null;

/** Misma interfaz que el Web App: recibe el body JSON y devuelve el objeto de respuesta */
export async function demoPost(body) {
  if (!listo) listo = iniciar();
  await listo;
  const out = JSON.parse(backend.doPost({ postData: { contents: body } }).content);
  guardar();
  return out;
}

export function borrarDatosDemo() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
  memoria = null;
}
