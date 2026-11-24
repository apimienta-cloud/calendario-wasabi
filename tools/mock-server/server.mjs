// server.mjs — Servidor local para probar la web SIN publicar el Apps Script.
//
// Ejecuta el apps-script/Code.gs real dentro de Node, con versiones simuladas de
// SpreadsheetApp, PropertiesService, LockService, Utilities y ContentService.
// La "planilla" se guarda en tools/mock-server/data.json.
//
// Uso:  node tools/mock-server/server.mjs        → http://localhost:8787
// Contraseña de prueba: la variable APP_PASSWORD o, si no está, "wasabi-demo".
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data.json');
const PORT = Number(process.env.PORT || 8787);
const PROPS = {
  APP_PASSWORD: process.env.APP_PASSWORD || 'wasabi-demo',
  TOKEN_SECRET: process.env.TOKEN_SECRET || 'secreto-local-de-prueba', // solo para el mock local
};

// ---------------- Planilla simulada ----------------
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
    if (row < 1 || row + nr - 1 > this.maxRows) throw new Error(`Rango fuera de la hoja ${this.name} (fila ${row + nr - 1} > ${this.maxRows})`);
    const sh = this;
    const range = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const src = sh.rows[row - 1 + i] || []; const r = []; for (let j = 0; j < nc; j++) r.push(src[col - 1 + j] ?? ''); out.push(r); }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues: tamaño no coincide con el rango');
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
if (existsSync(DATA)) {
  const d = JSON.parse(readFileSync(DATA, 'utf8'));
  for (const [n, s] of Object.entries(d)) sheets.set(n, new Sheet(n, s.rows, s.maxRows));
}
async function guardar() {
  const o = {};
  for (const [n, s] of sheets) o[n] = { rows: s.rows.slice(0, s.getLastRow()), maxRows: s.maxRows };
  await writeFile(DATA, JSON.stringify(o));
}

const spreadsheet = {
  setSpreadsheetTimeZone() {},
  getSheetByName: n => sheets.get(n) || null,
  insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; },
};

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => lit !== undefined ? lit :
    ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second })[m]);
}

const context = vm.createContext({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] ?? null }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Logger: { log: (...a) => console.log('[Logger]', ...a) },
  Utilities: {
    computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    formatDate,
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: s => ({ content: s, setMimeType() { return this; } }),
  },
});
vm.runInContext(readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
console.log(vm.runInContext('setup()', context));
await guardar();

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

let cola = Promise.resolve(); // las escrituras se procesan de a una, como con LockService

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const out = await (cola = cola.then(async () => {
        const r = context.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
        await guardar();
        return r.content;
      }).catch(e => JSON.stringify({ ok: false, error: String(e.message || e) })));
      try { const j = JSON.parse(body); console.log(new Date().toLocaleTimeString('es-UY'), j.action, JSON.parse(out).ok ? 'ok' : JSON.parse(out).error); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(out);
    }
    // Solo para pruebas automáticas: sirve un .pptx local para simular que se arrastró al importador
    if (url.pathname === '/__archivo-prueba') {
      const ruta = url.searchParams.get('ruta') || '';
      const st = /\.pptx$/i.test(ruta) ? await stat(ruta).catch(() => null) : null;
      if (!st) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
      return createReadStream(ruta).pipe(res);
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      return res.end("// config.js servido por el mock-server local\nexport const CONFIG = { API_URL: '/api', TIMEZONE: 'America/Montevideo' };\n");
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || /[\\/](tools|apps-script)[\\/]mock|data\.json$/.test(file)) { res.writeHead(403); return res.end(); }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Calendario Wasabi (mock) en http://localhost:${PORT}  ·  contraseña: ${PROPS.APP_PASSWORD}`));
