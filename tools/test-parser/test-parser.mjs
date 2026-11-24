// test-parser.mjs — Prueba el parser de cronogramas con archivos .pptx reales.
// Uso:  node tools/test-parser/test-parser.mjs [archivo1.pptx archivo2.pptx ...]
// Sin argumentos usa los dos cronogramas de noviembre 2026 (Grido y Tiendas Montevideo)
// y verifica los resultados esperados. Escribe el resumen en tools/test-parser/resultado.md
import { openZip } from './zip-lite.mjs';
import { extractSlideLines, isSlidePath, slideNumberFromPath, parsearCronograma, resumir, nombreMes, claveId } from '../../js/pptx-parser.js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOME = 'C:\\Users\\PC - 286\\WASABI\\Wasabi Marketing Digital - EQUIPO CHILI';
const DEFAULTS = [
  HOME + '\\GRIDO\\2026\\11 Noviembre\\01 Cronograma\\Cronograma-Grido-Noviembre-2026.pptx',
  HOME + '\\TIENDAS MONTEVIDEO\\2026\\11 Noviembre\\01 Cronograma\\Cronograma-Tiendas-Montevideo-Noviembre-2026.pptx',
];

async function leerCronograma(file) {
  const t0 = Date.now();
  const zip = await openZip(file);
  const slideEntries = zip.entries.filter(e => isSlidePath(e.name))
    .sort((a, b) => slideNumberFromPath(a.name) - slideNumberFromPath(b.name));
  const slides = [];
  let bytesLeidos = 0;
  for (const e of slideEntries) {
    const xml = await zip.readText(e);
    bytesLeidos += e.compSize;
    slides.push({ num: slideNumberFromPath(e.name), lines: extractSlideLines(xml) });
  }
  await zip.close();
  const res = parsearCronograma(slides, path.basename(file));
  return { res, ms: Date.now() - t0, tamanio: zip.size, bytesLeidos };
}

// ---------------- verificaciones esperadas ----------------
function buscar(res, id, fecha) {
  return res.contenidos.filter(c => claveId(c.id_pieza) === claveId(id) && (!fecha || c.fecha === fecha));
}
const checks = [];
function check(nombre, ok, detalle = '') { checks.push({ nombre, ok: !!ok, detalle }); }

function verificarGrido(res) {
  check('Grido: portada → Grido, noviembre 2026', res.marca === 'Grido' && res.mes === 11 && res.anio === 2026, `${res.marca} ${res.mes}/${res.anio}`);
  const b = buscar(res, 'Bocaditos');
  check('Grido: Bocaditos → feed, Estática, 02/11, 15:00, IG+FB',
    b.length === 1 && b[0].tipo === 'feed' && b[0].formato === 'Estática' && b[0].fecha === '2026-11-02' && b[0].hora === '15:00' && b[0].redes.join() === 'instagram,facebook',
    JSON.stringify(b.map(x => [x.tipo, x.formato, x.fecha, x.hora, x.redes.join('+')])));
  const bo = buscar(res, 'Bombón');
  check('Grido: Bombón → un solo contenido, Carrusel de 3, 06/11',
    bo.length === 1 && bo[0].formato === 'Carrusel' && bo[0].cantidad_piezas === 3 && bo[0].fecha === '2026-11-06',
    JSON.stringify(bo.map(x => [x.formato, x.cantidad_piezas, x.fecha, 'diap ' + x.diapositivas.join(',')])));
  const e = buscar(res, 'Espacio');
  check('Grido: Espacio → 04/11, IG+FB+TikTok+YouTube, objetivo "Alcance, Tráfico"',
    e.length === 1 && e[0].fecha === '2026-11-04' && e[0].redes.join() === 'instagram,facebook,tiktok,youtube' && e[0].objetivo === 'Alcance, Tráfico',
    JSON.stringify(e.map(x => [x.fecha, x.redes.join('+'), x.objetivo])));
  const omit = res.omitidos.map(o => claveId(o.id_pieza)).join(' | ');
  for (const n of ['Qué sos', 'Punto Medio', 'Algoritmo', 'Menta', 'Amo Helado', 'SoNa Morfi']) {
    check(`Grido: "${n}" (Anuncio 0 Octubre) → omitido`, res.omitidos.some(o => claveId(o.id_pieza).startsWith(claveId(n))), omit);
  }
  check('Grido: ningún contenido importado viene de "Anuncio"', !res.contenidos.some(c => /anuncio/i.test(c.notas)));
  check('Grido: los Shorts de YouTube → omitidos', !res.contenidos.some(c => /shorts/i.test(c.formato)));
}

function verificarTiendas(res) {
  check('Tiendas: portada → Tiendas Montevideo, noviembre 2026', res.marca === 'Tiendas Montevideo' && res.mes === 11 && res.anio === 2026, `${res.marca} ${res.mes}/${res.anio}`);
  const p = buscar(res, 'Primera Quincena');
  check('Tiendas: Primera Quincena → un solo feed, Carrusel de 15, 02/11, 11:00, Ventas, link web',
    p.length === 1 && p[0].tipo === 'feed' && p[0].formato === 'Carrusel' && p[0].cantidad_piezas === 15 && p[0].fecha === '2026-11-02' && p[0].hora === '11:00' && p[0].objetivo === 'Ventas' && /https?:\/\//.test(p[0].link),
    JSON.stringify(p.map(x => [x.tipo, x.formato, x.cantidad_piezas, x.fecha, x.hora, x.objetivo, x.link, 'diap ' + x.diapositivas.join(',')])));
  const ps = buscar(res, 'Primera Quincena Story').map(x => x.fecha.slice(8)).join(',');
  check('Tiendas: Primera Quincena Story → 6 contenidos 02,04,06,09,11,13', ps === '02,04,06,09,11,13', ps);
  const ss = buscar(res, 'Segunda Quincena Story').map(x => x.fecha.slice(8)).join(',');
  check('Tiendas: Segunda Quincena Story → 16,18,20,23,25,27', ss === '16,18,20,23,25,27', ss);
  const m = buscar(res, 'Mudanza');
  check('Tiendas: Mudanza → "Corregir esto" en notas', m.length === 1 && /Corregir esto/.test(m[0].notas), JSON.stringify(m.map(x => x.notas)));
}

// ---------------- informe ----------------
function informe(file, { res, ms, tamanio, bytesLeidos }) {
  const r = resumir(res);
  const L = [];
  L.push(`## ${path.basename(file)}`);
  L.push('');
  L.push(`- Archivo: ${(tamanio / 1048576).toFixed(0)} MB — se leyeron solo ${(bytesLeidos / 1024).toFixed(0)} KB (diapositivas) en ${ms} ms`);
  L.push(`- Portada: **${res.marca}**, ${nombreMes(res.mes)} ${res.anio} (origen: ${res.origenPortada})`);
  L.push(`- Diapositivas: ${res.diapositivas}`);
  L.push(`- **Feed: ${r.feed} · Stories: ${r.stories} · Omitidos: ${r.omitidos}** · Contenidos con advertencias: ${r.conAdvertencias}`);
  if (res.advertencias.length) { L.push(''); L.push('**Advertencias generales**'); res.advertencias.forEach(a => L.push(`- ${a}`)); }
  L.push('');
  L.push('| Fecha | Hora | Tipo | Id | Formato | Redes | Objetivo | Diap. | Advertencias / notas |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of res.contenidos) {
    const fmt = c.formato + (c.cantidad_piezas > 1 ? ` (${c.cantidad_piezas})` : '');
    const redes = c.redes.map(x => ({ instagram: 'IG', facebook: 'FB', tiktok: 'TT', youtube: 'YT', linkedin: 'IN' }[x])).join(' ');
    const extra = [...c.advertencias, c.notas ? `Notas: ${c.notas.replace(/\n/g, ' / ')}` : ''].filter(Boolean).join(' · ').replace(/\|/g, '\\|');
    L.push(`| ${c.fecha ? c.fecha.slice(8) + '/' + c.fecha.slice(5, 7) : '—'} | ${c.hora || '—'} | ${c.tipo} | ${c.id_pieza} | ${fmt} | ${redes || '—'} | ${c.objetivo || '—'} | ${c.diapositivas.join(',')} | ${extra} |`);
  }
  if (res.omitidos.length) {
    L.push('');
    L.push('**Omitidos (no se importan)**');
    res.omitidos.forEach(o => L.push(`- ${o.id_pieza} — ${o.motivo} (diap. ${o.diapositivas.join(', ')})`));
  }
  L.push('');
  return L.join('\n');
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
const usarChecks = !process.argv.slice(2).length;
let md = `# Prueba del parser de cronogramas\n\nGenerado el ${new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' })} con \`node tools/test-parser/test-parser.mjs\`.\nUsa el mismo \`js/pptx-parser.js\` que el importador del navegador.\n\n`;
const secciones = [];
for (const f of files) {
  const out = await leerCronograma(f);
  if (usarChecks) {
    if (/grido/i.test(f)) verificarGrido(out.res);
    if (/tiendas/i.test(f)) verificarTiendas(out.res);
  }
  const r = resumir(out.res);
  console.log(`\n${path.basename(f)}: feed ${r.feed}, stories ${r.stories}, omitidos ${r.omitidos}, con advertencias ${r.conAdvertencias} (${out.ms} ms, ${(out.bytesLeidos / 1024).toFixed(0)} KB leídos de ${(out.tamanio / 1048576).toFixed(0)} MB)`);
  secciones.push(informe(f, out));
}
if (checks.length) {
  md += '## Verificaciones\n\n';
  for (const c of checks) md += `- ${c.ok ? '✅' : '❌'} ${c.nombre}${c.ok ? '' : ` — obtenido: \`${c.detalle}\``}\n`;
  md += '\n';
  console.log('\nVerificaciones:');
  for (const c of checks) console.log(`  ${c.ok ? 'OK ' : 'FALLA'} ${c.nombre}${c.ok ? '' : '  → ' + c.detalle}`);
}
md += secciones.join('\n');
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resultado.md');
await writeFile(outPath, md, 'utf8');
console.log(`\nResumen escrito en ${outPath}`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
