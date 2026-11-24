// main.js — Arranque, estado de la app, barra lateral, filtros y acciones.
import { api, alPerderSesion, AuthError, MODO_DEMO } from './api.js';
import { getToken, clearToken, mostrarLogin } from './auth.js';
import { renderCalendario, rangoVisible, tituloPeriodo } from './calendar.js';
import { abrirEditor, cerrarEditor } from './editor.js';
import { abrirImportador } from './importer.js';
import {
  h, add, toast, abrirModal, confirmar, REDES, RED_INFO, ESTADOS, COLORES_MARCA, siguienteEstado, hoyMVD, ahoraMVD,
  sumarDias, sumarMeses, isoDe, redesAtrasadas, preguntasPendientes, marcarNo, storageGet, storageSet, fmtCorta, chipRed,
} from './ui.js';

const $ = id => document.getElementById(id);
const esMovil = () => window.matchMedia('(max-width: 760px)').matches;

const S = {
  equipos: [],
  marcas: [],
  marcasMap: new Map(),
  contenidos: [],
  sel: storageGet('wasabi.sel', { equipo_id: '', marca_id: '' }),
  vista: storageGet('wasabi.vista', null) || (esMovil() ? 'lista' : 'mes'),
  ref: hoyMVD(),
  filtros: { red: '', estado: '', tipo: '', atrasadas: false },
  verArchivadas: false,
  abiertos: storageGet('wasabi.abiertos', ['chili']),
  orden: { k: 'fecha', dir: 1 },
  cargando: false,
  cargaId: 0,
};

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

alPerderSesion(msg => { iniciar(msg || 'Tu sesión venció. Volvé a ingresar.'); });

async function iniciar(mensaje = '') {
  cerrarEditor();
  $('modal-root').innerHTML = '';
  if (!getToken()) {
    await mostrarLogin(async password => api('login', { password }), mensaje);
  }
  $('login').hidden = true;
  $('app').hidden = false;
  try {
    await cargarBase();
    await cargarContenidos();
  } catch (err) {
    if (!(err instanceof AuthError)) toast(err.message, 'error');
  }
}

async function cargarBase() {
  const [equipos, marcas] = await Promise.all([api('getEquipos'), api('getMarcas')]);
  S.equipos = equipos;
  setMarcas(marcas);
  // Selección guardada que ya no existe
  if (S.sel.marca_id && !S.marcasMap.has(S.sel.marca_id)) S.sel = { equipo_id: '', marca_id: '' };
  pintarSidebar();
  pintarFiltrosScope();
}

function setMarcas(marcas) {
  S.marcas = marcas;
  S.marcasMap = new Map(marcas.map(m => [m.id, m]));
}

async function cargarContenidos() {
  const { desde, hasta } = rangoVisible(S.vista, S.ref);
  // Se trae también lo de los últimos 60 días, para las preguntas de control
  const desdeCarga = [desde, sumarDias(hoyMVD(), -60)].sort()[0];
  const hastaCarga = [hasta, hoyMVD()].sort()[1];
  const payload = { desde: desdeCarga, hasta: hastaCarga };
  if (S.sel.marca_id) payload.marca_id = S.sel.marca_id;
  else if (S.sel.equipo_id) payload.equipo_id = S.sel.equipo_id;
  const id = ++S.cargaId;
  S.cargando = true;
  pintar();
  try {
    const lista = await api('getContenidos', payload);
    if (id !== S.cargaId) return; // llegó una respuesta vieja
    S.contenidos = lista;
  } finally {
    if (id === S.cargaId) { S.cargando = false; pintar(); }
  }
}

// ---------------------------------------------------------------------------
// Filtros y selección
// ---------------------------------------------------------------------------

function marcasVisibles() {
  return S.marcas.filter(m => S.verArchivadas || m.activa);
}

function enScope(c) {
  const m = S.marcasMap.get(c.marca_id);
  if (!m) return false;
  if (!S.verArchivadas && !m.activa && S.sel.marca_id !== m.id) return false;
  if (S.sel.marca_id) return c.marca_id === S.sel.marca_id;
  if (S.sel.equipo_id) return m.equipo_id === S.sel.equipo_id;
  return true;
}

function pasaFiltros(c, ahora) {
  const f = S.filtros;
  if (f.tipo && c.tipo !== f.tipo) return false;
  if (f.red && !c.redes.includes(f.red)) return false;
  const redes = f.red ? [f.red] : c.redes;
  if (f.estado && !redes.some(r => (c['estado_' + r] || 'pendiente') === f.estado)) return false;
  if (f.atrasadas && !redesAtrasadas(c, ahora).some(r => redes.includes(r))) return false;
  return true;
}

function visibles() {
  const { desde, hasta } = rangoVisible(S.vista, S.ref);
  const ahora = ahoraMVD();
  return S.contenidos.filter(c => c.fecha >= desde && c.fecha <= hasta && enScope(c) && pasaFiltros(c, ahora));
}

function seleccionar(sel) {
  S.sel = { equipo_id: sel.equipo_id || '', marca_id: sel.marca_id || '' };
  if (S.sel.marca_id) S.sel.equipo_id = S.marcasMap.get(S.sel.marca_id)?.equipo_id || '';
  storageSet('wasabi.sel', S.sel);
  $('sidebar').classList.remove('abierto');
  pintarSidebar();
  pintarFiltrosScope();
  cargarContenidos().catch(err => { if (!(err instanceof AuthError)) toast(err.message, 'error'); });
}

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------

function pintarSidebar() {
  const nav = $('side-equipos');
  nav.innerHTML = '';
  $('side-all').classList.toggle('activo', !S.sel.equipo_id && !S.sel.marca_id);
  for (const eq of S.equipos) {
    const marcas = marcasVisibles().filter(m => m.equipo_id === eq.id);
    const abierto = S.abiertos.includes(eq.id);
    const btn = h('button.side-equipo-btn', { on: { click: () => { abrirEquipo(eq.id, true); seleccionar({ equipo_id: eq.id }); } } },
      h('span.side-caret', { on: { click: e => { e.stopPropagation(); abrirEquipo(eq.id, !S.abiertos.includes(eq.id)); } } }, '▶'), eq.nombre);
    if (S.sel.equipo_id === eq.id && !S.sel.marca_id) btn.classList.add('activo');
    const lista = h('div.side-marcas',
      marcas.length ? null : h('div.side-empty', 'Sin marcas todavía'),
      marcas.map(m => {
        const item = h('div.side-marca', { role: 'button', tabindex: '0', on: { click: () => seleccionar({ marca_id: m.id }), keydown: e => { if (e.key === 'Enter') seleccionar({ marca_id: m.id }); } } },
          h('span.dot', { style: { background: m.color } }),
          h('span.nombre', m.nombre),
          h('button.edit', { type: 'button', title: 'Editar marca', 'aria-label': `Editar ${m.nombre}`, on: { click: e => { e.stopPropagation(); editarMarca(m); } } }, '✎'));
        if (!m.activa) item.classList.add('archivada');
        if (S.sel.marca_id === m.id) item.classList.add('activo');
        return item;
      }));
    const grupo = h('div.side-equipo',
      h('div.side-equipo-head', btn,
        h('button.side-add', { type: 'button', title: `Agregar marca en ${eq.nombre}`, 'aria-label': `Agregar marca en ${eq.nombre}`, on: { click: () => editarMarca({ equipo_id: eq.id }) } }, '+')),
      lista);
    if (abierto) grupo.classList.add('abierto');
    nav.append(grupo);
  }
}

function abrirEquipo(id, abrir) {
  S.abiertos = abrir ? [...new Set([...S.abiertos, id])] : S.abiertos.filter(x => x !== id);
  storageSet('wasabi.abiertos', S.abiertos);
  pintarSidebar();
}

function pintarFiltrosScope() {
  const fe = $('f-equipo'), fm = $('f-marca');
  fe.innerHTML = ''; fm.innerHTML = '';
  add(fe, h('option', { value: '' }, 'Todos los equipos'), S.equipos.map(e => h('option', { value: e.id, selected: e.id === S.sel.equipo_id }, e.nombre)));
  const marcas = marcasVisibles().filter(m => !S.sel.equipo_id || m.equipo_id === S.sel.equipo_id);
  add(fm, h('option', { value: '' }, S.sel.equipo_id ? 'Todas las marcas del equipo' : 'Todas las marcas'),
    marcas.map(m => h('option', { value: m.id, selected: m.id === S.sel.marca_id }, m.nombre)));
  fe.value = S.sel.equipo_id;
  fm.value = S.sel.marca_id;

  const t = $('scope-title');
  t.innerHTML = '';
  const marca = S.marcasMap.get(S.sel.marca_id);
  const equipo = S.equipos.find(e => e.id === S.sel.equipo_id);
  if (marca) add(t, h('span.dot', { style: { background: marca.color } }), marca.nombre, !marca.activa ? h('span.meta', ' (archivada)') : null);
  else t.append(equipo ? `${equipo.nombre} · todas las marcas` : 'Todas las marcas');
  $('import-btn').hidden = !marca;
}

function pintar() {
  $('period-label').textContent = tituloPeriodo(S.vista, S.ref);
  document.querySelectorAll('#view-seg button').forEach(b => b.classList.toggle('activo', b.dataset.vista === S.vista));
  const lista = visibles();
  const ahora = ahoraMVD();
  pintarContadores(lista, ahora);
  pintarBanner(ahora);

  const cal = $('calendar');
  if (S.cargando && !S.contenidos.length) { cal.innerHTML = ''; cal.append(h('div.loading', 'Cargando contenidos…')); return; }
  if (!S.marcas.length) {
    cal.innerHTML = '';
    cal.append(h('div.empty', h('h3', 'Todavía no hay marcas'), h('p', 'Agregá la primera marca con el botón + al lado de un equipo en la barra lateral.'),
      h('div.acciones', h('button.btn-primary', { on: { click: () => editarMarca({ equipo_id: 'chili' }) } }, '+ Agregar marca'))));
    return;
  }
  renderCalendario(cal, {
    vista: S.vista, ref: S.ref, contenidos: lista, marcas: S.marcasMap, mostrarMarca: !S.sel.marca_id, ahora,
    orden: S.orden, setOrden: o => { S.orden = o; pintar(); },
    on: { abrir: abrirContenido, estado: ciclarEstado, mover: moverContenido, responder, nuevo: nuevoContenido },
  });
  const sinFiltro = !S.filtros.red && !S.filtros.estado && !S.filtros.tipo && !S.filtros.atrasadas;
  if (!lista.length && !S.cargando && S.vista === 'lista') {
    cal.append(h('div.empty', { style: { marginTop: '10px' } },
      h('h3', sinFiltro ? 'No hay contenidos en este período' : 'Ningún contenido coincide con los filtros'),
      S.sel.marca_id && sinFiltro ? h('div.acciones',
        h('button.btn-primary', { on: { click: importar } }, 'Importar cronograma'),
        h('button.btn-ghost', { on: { click: () => nuevoContenido({}) } }, '+ Contenido')) : null));
  }
}

function pintarContadores(lista, ahora) {
  const n = { pendiente: 0, programado: 0, publicado: 0, atrasada: 0 };
  for (const c of lista) {
    const atr = redesAtrasadas(c, ahora);
    for (const r of c.redes) {
      if (S.filtros.red && r !== S.filtros.red) continue;
      n[c['estado_' + r] || 'pendiente']++;
      if (atr.includes(r)) n.atrasada++;
    }
  }
  const el = $('counters');
  el.innerHTML = '';
  for (const [k, t] of [['pendiente', 'Pendientes'], ['programado', 'Programadas'], ['publicado', 'Publicadas'], ['atrasada', 'Atrasadas']]) {
    el.append(h('div.counter.' + k, h('b', n[k]), h('span', t)));
  }
  el.append(h('div.counter-note', 'Publicaciones por red en el período visible.'));
}

function pintarBanner(ahora) {
  const el = $('banner');
  el.innerHTML = '';
  const preguntas = preguntasPendientes(S.contenidos.filter(enScope), ahora);
  if (!preguntas.length) return;
  el.append(h('div.banner',
    h('span', h('b', `Tenés ${preguntas.length} publicaci${preguntas.length === 1 ? 'ón' : 'ones'} sin confirmar.`), ' Ya pasó la fecha y hora y no están marcadas como publicadas.'),
    h('button.btn-ghost.sm', { on: { click: revisarPendientes } }, 'Revisar')));
}

// ---------------------------------------------------------------------------
// Acciones sobre contenidos
// ---------------------------------------------------------------------------

function reemplazar(c) {
  const i = S.contenidos.findIndex(x => x.id === c.id);
  if (i >= 0) S.contenidos[i] = c; else S.contenidos.push(c);
}

async function cambiarEstado(c, red, estado) {
  const anterior = c['estado_' + red];
  c['estado_' + red] = estado;
  pintar();
  try {
    const nuevo = await api('setEstado', { id: c.id, red, estado });
    reemplazar(nuevo);
    pintar();
    return nuevo;
  } catch (err) {
    c['estado_' + red] = anterior;
    pintar();
    if (!(err instanceof AuthError)) toast(err.message, 'error');
    throw err;
  }
}

function ciclarEstado(c, red) {
  cambiarEstado(c, red, siguienteEstado(c['estado_' + red])).catch(() => {});
}

function responder(c, red, si) {
  if (si) {
    cambiarEstado(c, red, 'publicado').then(() => toast(`Marcado como publicado en ${RED_INFO[red].nombre}`, 'ok')).catch(() => {});
  } else {
    marcarNo(c, red);
    pintar();
  }
}

async function moverContenido(id, fecha) {
  const c = S.contenidos.find(x => x.id === id);
  if (!c || c.fecha === fecha) return;
  const anterior = c.fecha;
  c.fecha = fecha;
  pintar();
  try {
    reemplazar(await api('saveContenido', { contenido: c }));
    pintar();
    toast(`"${c.id_pieza}" movido al ${fmtCorta(fecha)}`, 'ok');
  } catch (err) {
    c.fecha = anterior;
    pintar();
    if (!(err instanceof AuthError)) toast(err.message, 'error');
  }
}

const ctxEditor = () => ({
  marcas: S.marcas,
  marcasMap: S.marcasMap,
  guardar: async c => {
    const g = await api('saveContenido', { contenido: c });
    reemplazar(g);
    pintar();
    return g;
  },
  eliminar: async c => {
    await api('deleteContenido', { id: c.id });
    S.contenidos = S.contenidos.filter(x => x.id !== c.id);
    pintar();
  },
  setEstado: (c, red, estado) => cambiarEstado(S.contenidos.find(x => x.id === c.id) || c, red, estado),
  duplicar: borrador => abrirEditor(borrador, ctxEditor()),
});

function abrirContenido(c) { abrirEditor({ ...c, redes: [...c.redes] }, ctxEditor()); }

function nuevoContenido({ fecha, tipo } = {}) {
  const marca = S.marcasMap.get(S.sel.marca_id);
  abrirEditor({
    marca_id: marca ? marca.id : '',
    id_pieza: '', tipo: tipo || 'feed', formato: '', cantidad_piezas: 1, ubicacion: tipo === 'story' ? 'Story' : 'Feed',
    fecha: fecha || (S.ref.slice(0, 7) === hoyMVD().slice(0, 7) ? hoyMVD() : S.ref),
    hora: '', redes: marca ? [...marca.redes_activas] : ['instagram', 'facebook'],
    objetivo: '', campania: '', circulacion: '', bajada: '', titulo: '', descripcion: '', link: '', notas: '',
  }, ctxEditor());
}

function revisarPendientes() {
  const m = abrirModal({ titulo: 'Publicaciones sin confirmar' });
  function pintarLista() {
    m.body.innerHTML = '';
    const preguntas = preguntasPendientes(S.contenidos.filter(enScope), ahoraMVD())
      .sort((a, b) => (a.c.fecha + a.c.hora).localeCompare(b.c.fecha + b.c.hora));
    if (!preguntas.length) { m.body.append(h('p', '¡Listo! No quedan publicaciones sin confirmar.')); return; }
    m.body.append(h('p.meta', { style: { margin: 0 } }, 'Si respondés "No", queda marcada en rojo como atrasada y no se vuelve a preguntar.'));
    for (const { c, red } of preguntas) {
      const marca = S.marcasMap.get(c.marca_id);
      m.body.append(h('div.sec', { style: { gap: '6px' } },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('b', c.id_pieza), h('span.meta', `${marca?.nombre || ''} · ${fmtCorta(c.fecha)} ${c.hora || ''} · ${c.tipo === 'story' ? 'Story' : 'Feed'}`),
          chipRed(red, c['estado_' + red], { atrasada: true, boton: false })),
        h('div.q-row', { style: { fontSize: '13px' } },
          h('span.q-txt', `¿Se publicó en ${RED_INFO[red].nombre}?`),
          h('button.q-btn.si', { on: { click: async () => { try { await cambiarEstado(c, red, 'publicado'); } catch { /* ya avisado */ } pintarLista(); } } }, 'Sí'),
          h('button.q-btn', { on: { click: () => { marcarNo(c, red); pintar(); pintarLista(); } } }, 'No'))));
    }
  }
  pintarLista();
  m.foot.append(h('button.btn-primary', { on: { click: () => m.cerrar() } }, 'Cerrar'));
}

// ---------------------------------------------------------------------------
// Marcas
// ---------------------------------------------------------------------------

function editarMarca(marca) {
  const nueva = !marca.id;
  const eq = S.equipos.find(e => e.id === marca.equipo_id);
  const m = abrirModal({ titulo: nueva ? `Nueva marca${eq ? ' en ' + eq.nombre : ''}` : `Editar ${marca.nombre}` });
  let color = marca.color || COLORES_MARCA[S.marcas.length % COLORES_MARCA.length];
  const nombre = h('input', { value: marca.nombre || '', placeholder: 'Ej: Grido', required: true });
  const equipo = h('select', S.equipos.map(e => h('option', { value: e.id, selected: e.id === marca.equipo_id }, e.nombre)));
  const picker = h('input', { type: 'color', value: color, title: 'Otro color', on: { input: e => { color = e.target.value; pintarSw(); } } });
  const sw = h('div.swatches');
  function pintarSw() {
    sw.innerHTML = '';
    COLORES_MARCA.forEach(c => {
      const b = h('button.swatch', { type: 'button', title: c, style: { background: c }, on: { click: () => { color = c; picker.value = c; pintarSw(); } } });
      if (c.toLowerCase() === color.toLowerCase()) b.classList.add('on');
      sw.append(b);
    });
    sw.append(picker);
  }
  pintarSw();
  const activas = marca.redes_activas || ['instagram', 'facebook'];
  const redes = h('div.redes-check', REDES.map(r => h('label', h('input', { type: 'checkbox', value: r, checked: activas.includes(r) }), RED_INFO[r].nombre)));

  add(m.body,
    h('label.field', h('span', 'Nombre'), nombre),
    h('label.field', h('span', 'Equipo'), equipo),
    h('div.field', h('span', 'Color en el calendario'), sw),
    h('div.field', h('span', 'Redes activas'), redes),
    !nueva && !marca.activa ? h('div.aviso', 'Esta marca está archivada: no aparece en la barra lateral (salvo con "Mostrar archivadas"), pero conserva todo su historial.') : null);

  const guardar = async (extra = {}) => {
    const datos = {
      id: marca.id, nombre: nombre.value.trim(), equipo_id: equipo.value, color,
      redes_activas: [...redes.querySelectorAll('input:checked')].map(i => i.value),
      activa: marca.activa !== false, ...extra,
    };
    if (!datos.nombre) { nombre.focus(); return toast('Poné un nombre.', 'error'); }
    try {
      const g = await api('saveMarca', { marca: datos });
      const lista = S.marcas.filter(x => x.id !== g.id).concat(g).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      setMarcas(lista);
      m.cerrar();
      toast(nueva ? `Marca "${g.nombre}" creada` : extra.activa === false ? `"${g.nombre}" archivada` : extra.activa === true ? `"${g.nombre}" restaurada` : 'Marca guardada', 'ok');
      if (nueva) { abrirEquipo(g.equipo_id, true); seleccionar({ marca_id: g.id }); }
      else if (extra.activa === false && S.sel.marca_id === g.id && !S.verArchivadas) seleccionar({ equipo_id: g.equipo_id });
      else { pintarSidebar(); pintarFiltrosScope(); pintar(); }
    } catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
  };

  add(m.foot,
    !nueva ? (marca.activa
      ? h('button.btn-danger', { on: { click: async () => { if (await confirmar(`¿Archivar "${marca.nombre}"? Se oculta de la barra lateral pero no se borra nada.`, { si: 'Archivar' })) guardar({ activa: false }); } } }, 'Archivar')
      : h('button.btn-ghost', { on: { click: () => guardar({ activa: true }) } }, 'Restaurar')) : null,
    h('span.spacer'),
    h('button.btn-ghost', { on: { click: () => m.cerrar() } }, 'Cancelar'),
    h('button.btn-primary', { on: { click: () => guardar() } }, nueva ? 'Crear marca' : 'Guardar'));
  setTimeout(() => nombre.focus(), 30);
  nombre.addEventListener('keydown', e => { if (e.key === 'Enter') guardar(); });
}

function importar() {
  const marca = S.marcasMap.get(S.sel.marca_id);
  if (!marca) return toast('Elegí una marca en la barra lateral para importar su cronograma.', 'error');
  abrirImportador({
    marca, api,
    onListo: (anio, mes) => {
      S.ref = isoDe(anio, mes, 1);
      cargarContenidos().catch(err => { if (!(err instanceof AuthError)) toast(err.message, 'error'); });
    },
  });
}

// ---------------------------------------------------------------------------
// Eventos fijos
// ---------------------------------------------------------------------------

function mover(n) {
  S.ref = S.vista === 'semana' ? sumarDias(S.ref, 7 * n) : sumarMeses(S.ref, n);
  cargarContenidos().catch(err => { if (!(err instanceof AuthError)) toast(err.message, 'error'); });
}

$('prev-btn').addEventListener('click', () => mover(-1));
$('next-btn').addEventListener('click', () => mover(1));
$('today-btn').addEventListener('click', () => { S.ref = hoyMVD(); cargarContenidos().catch(() => {}); });
document.querySelectorAll('#view-seg button').forEach(b => b.addEventListener('click', () => {
  S.vista = b.dataset.vista;
  storageSet('wasabi.vista', S.vista);
  cargarContenidos().catch(() => {});
}));
$('new-btn').addEventListener('click', () => nuevoContenido({}));
$('import-btn').addEventListener('click', importar);
$('side-all').addEventListener('click', () => seleccionar({}));
$('ver-archivadas').addEventListener('change', e => { S.verArchivadas = e.target.checked; pintarSidebar(); pintarFiltrosScope(); pintar(); });
$('f-equipo').addEventListener('change', e => seleccionar({ equipo_id: e.target.value }));
$('f-marca').addEventListener('change', e => seleccionar(e.target.value ? { marca_id: e.target.value } : { equipo_id: S.sel.equipo_id }));
$('f-red').addEventListener('change', e => { S.filtros.red = e.target.value; pintar(); });
$('f-estado').addEventListener('change', e => { S.filtros.estado = e.target.value; pintar(); });
$('f-tipo').addEventListener('change', e => { S.filtros.tipo = e.target.value; pintar(); });
$('f-atrasadas').addEventListener('change', e => { S.filtros.atrasadas = e.target.checked; pintar(); });
$('menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('abierto'));
$('sidebar-backdrop').addEventListener('click', () => $('sidebar').classList.remove('abierto'));
$('logout-btn').addEventListener('click', async () => {
  if (!(await confirmar('¿Cerrar sesión en este navegador?', { si: 'Salir' }))) return;
  clearToken();
  S.contenidos = [];
  iniciar();
});
if (MODO_DEMO) { $('login-demo').hidden = false; $('demo-chip').hidden = false; }
// Cada minuto se recalculan los atrasos (sin pedir nada al servidor)
setInterval(() => { if (!$('app').hidden) pintar(); }, 60000);

iniciar();
