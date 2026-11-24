// api-smoke.mjs — Prueba rápida del backend (Code.gs) contra el mock-server.
// Uso: con el server corriendo →  node tools/mock-server/api-smoke.mjs
const BASE = process.env.BASE || 'http://localhost:8787/api';
let token = '';
async function call(action, payload = {}) {
  const r = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, payload }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${action}: ${j.error}`);
  return j.data;
}
const assert = (c, m) => { if (!c) throw new Error('FALLA: ' + m); console.log('ok -', m); };

try { await call('getEquipos'); assert(false, 'sin token debe fallar'); } catch (e) { assert(/Sesión/.test(e.message), 'sin token → AUTH'); }
try { await call('login', { password: 'mal' }); assert(false, 'pass mala'); } catch (e) { assert(/incorrecta/.test(e.message), 'contraseña mala rechazada'); }
token = (await call('login', { password: process.env.APP_PASSWORD || 'wasabi-demo' })).token;
const eq = await call('getEquipos');
assert(eq.map(e => e.nombre).join() === 'CHILI,TABASCO,PUTAPARIÓ,PEPPERS', 'equipos fijos');
const m = await call('saveMarca', { marca: { nombre: 'Smoke ' + Date.now(), equipo_id: 'chili', color: '#703873', redes_activas: ['instagram', 'facebook'] } });
assert(m.id && m.activa, 'marca creada');
const base = { id_pieza: 'Prueba', tipo: 'feed', formato: 'Reel', fecha: '2026-11-10', hora: '15:00', redes: ['instagram', 'facebook'], objetivo: 'Alcance' };
let prev = await call('importPreview', { marca_id: m.id, anio: 2026, mes: 11, contenidos: [base, { ...base, id_pieza: 'Prueba Story', tipo: 'story' }] });
assert(prev.nuevos.length === 2, 'preview: 2 nuevos');
let r = await call('importCommit', { marca_id: m.id, anio: 2026, mes: 11, nuevos: prev.nuevos.map(n => n.contenido) });
assert(r.agregados === 2, 'commit: 2 agregados');
let cs = await call('getContenidos', { marca_id: m.id, desde: '2026-11-01', hasta: '2026-11-30' });
const feed = cs.find(c => c.tipo === 'feed');
await call('setEstado', { id: feed.id, red: 'instagram', estado: 'publicado' });
prev = await call('importPreview', { marca_id: m.id, anio: 2026, mes: 11, contenidos: [{ ...base, hora: '16:00' }] });
assert(prev.nuevos.length === 0 && prev.modificados.length === 1 && prev.eliminados.length === 1, 'reimport: 0 nuevos, 1 modificado, 1 ya no está');
r = await call('importCommit', { marca_id: m.id, anio: 2026, mes: 11, nuevos: [base], actualizar: prev.modificados.map(x => ({ id: x.id, contenido: x.contenido })) });
assert(r.agregados === 0 && r.actualizados === 1 && r.omitidosDuplicados === 1, 'reimport: no duplica');
cs = await call('getContenidos', { marca_id: m.id });
const f2 = cs.find(c => c.id === feed.id);
assert(cs.length === 2 && f2.hora === '16:00' && f2.estado_instagram === 'publicado', 'estado conservado y hora actualizada');
await call('saveContenido', { contenido: { ...f2, titulo: 'editado a mano' } });
prev = await call('importPreview', { marca_id: m.id, anio: 2026, mes: 11, contenidos: [{ ...base, hora: '17:00' }] });
assert(prev.modificados[0].editado_manual === true, 'detecta edición manual');
r = await call('importCommit', { marca_id: m.id, anio: 2026, mes: 11, actualizar: [{ id: f2.id, contenido: { ...base, hora: '17:00' }, pisarManual: false }] });
assert(r.conservados === 1, 'conserva edición manual si no se pisa');
// Pieza movida a mano a otra fecha: al reimportar no se duplica
await call('saveContenido', { contenido: { ...cs.find(c => c.id === f2.id), fecha: '2026-11-12' } });
prev = await call('importPreview', { marca_id: m.id, anio: 2026, mes: 11, contenidos: [base] });
assert(prev.nuevos.length === 0 && prev.modificados.length === 1 && prev.modificados[0].cambios.some(x => x.campo === 'fecha'), 'pieza movida a mano → modificada, no nueva');
cs = await call('getContenidos', { marca_id: m.id });
for (const c of cs) await call('deleteContenido', { id: c.id });
await call('deleteMarca', { id: m.id });
console.log('\nTodo OK');
