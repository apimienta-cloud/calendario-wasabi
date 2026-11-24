// calendar.js — Vistas del calendario: mes, semana y lista.
import {
  h, chipRed, RED_INFO, REDES, ESTADO_INFO, DIAS_CORTOS, sumarDias, inicioSemana, inicioMes, finMes, diaSemana,
  fmtMesAnio, fmtCorta, hoyMVD, redesAtrasadas, respondioNo, descargarCSV, colorTexto,
} from './ui.js';

/** Rango de fechas que muestra cada vista */
export function rangoVisible(vista, ref) {
  if (vista === 'semana') {
    const desde = inicioSemana(ref);
    return { desde, hasta: sumarDias(desde, 6), mesDe: ref };
  }
  if (vista === 'lista') return { desde: inicioMes(ref), hasta: finMes(ref), mesDe: ref };
  const desde = inicioSemana(inicioMes(ref));
  const fin = finMes(ref);
  const hasta = sumarDias(fin, 6 - diaSemana(fin));
  return { desde, hasta, mesDe: ref };
}

export function tituloPeriodo(vista, ref) {
  if (vista === 'semana') {
    const d = inicioSemana(ref), f = sumarDias(d, 6);
    return `Semana del ${fmtCorta(d)} al ${fmtCorta(f)}`;
  }
  const t = fmtMesAnio(ref);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Tarjetas con la pregunta de control desplegada (se mantiene al redibujar)
const desplegadas = new Set();

const ordenar = (a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99') || a.id_pieza.localeCompare(b.id_pieza, 'es');

/**
 * @param {HTMLElement} cont
 * @param {object} o  { vista, ref, contenidos, marcas: Map, mostrarMarca, ahora, on: {abrir, estado, mover, responder, nuevo}, orden, setOrden }
 */
export function renderCalendario(cont, o) {
  cont.innerHTML = '';
  if (o.vista === 'lista') return renderLista(cont, o);
  return renderGrilla(cont, o);
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

function tarjeta(c, o, detallada) {
  const marca = o.marcas.get(c.marca_id);
  const color = marca ? marca.color : '#92C100';
  const atrasadas = redesAtrasadas(c, o.ahora);
  const todoPublicado = c.redes.length > 0 && c.redes.every(r => c['estado_' + r] === 'publicado');

  const redesEl = h('div.cc-redes', c.redes.map(red => {
    const chip = chipRed(red, c['estado_' + red], { atrasada: atrasadas.includes(red) });
    chip.addEventListener('click', e => { e.stopPropagation(); o.on.estado(c, red); });
    return chip;
  }));
  if (!c.redes.length) redesEl.append(h('span.meta', 'Sin redes'));

  const preguntas = atrasadas.filter(red => !respondioNo(c, red));
  let qEl = null;
  if (preguntas.length) {
    const filas = preguntas.map(red => h('div.q-row',
      h('span.q-txt', `¿Se publicó en ${RED_INFO[red].nombre}?`),
      h('button.q-btn.si', { type: 'button', on: { click: e => { e.stopPropagation(); o.on.responder(c, red, true); } } }, 'Sí'),
      h('button.q-btn', { type: 'button', on: { click: e => { e.stopPropagation(); o.on.responder(c, red, false); } } }, 'No')));
    if (detallada || desplegadas.has(c.id)) {
      qEl = h('div.cc-q', filas);
    } else {
      // En la vista mes, la pregunta se muestra plegada para no agrandar la tarjeta
      qEl = h('div.cc-q', h('button.q-toggle', {
        type: 'button', title: 'Responder si ya se publicó',
        on: { click: e => { e.stopPropagation(); desplegadas.add(c.id); el.querySelector('.cc-q').replaceWith(h('div.cc-q', filas)); } },
      }, `¿Se publicó? (${preguntas.length})`));
    }
  }

  const fmt = c.formato ? c.formato + (c.cantidad_piezas > 1 ? ` · ${c.cantidad_piezas}` : '') : '';
  const el = h('div.cc', {
    draggable: 'true', tabindex: '0', role: 'button',
    title: `${c.id_pieza}${marca ? ' — ' + marca.nombre : ''}${c.titulo ? '\n' + c.titulo : ''}`,
    style: { '--marca': color, '--marca-texto': colorTexto(color) },
    dataset: { id: c.id },
    on: {
      click: () => o.on.abrir(c),
      keydown: e => { if (e.key === 'Enter') o.on.abrir(c); },
      dragstart: e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
      dragend: () => el.classList.remove('dragging'),
    },
  },
  h('div.cc-top', h('span.cc-hora', c.hora || 's/h'), fmt ? h('span.cc-fmt', fmt) : null),
  h('div.cc-id', c.id_pieza),
  o.mostrarMarca && marca ? h('div.cc-marca', marca.nombre) : null,
  detallada && (c.titulo || c.objetivo) ? h('div.cc-extra', c.titulo || c.objetivo) : null,
  redesEl,
  qEl);
  if (atrasadas.length) el.classList.add('atrasada');
  if (todoPublicado) el.classList.add('todo-publicado');
  return el;
}

// ---------------------------------------------------------------------------
// Mes y semana (feed y stories en filas separadas)
// ---------------------------------------------------------------------------

function renderGrilla(cont, o) {
  const { desde, hasta } = rangoVisible(o.vista, o.ref);
  const mesRef = o.ref.slice(0, 7);
  const hoy = hoyMVD();
  const porDia = new Map();
  for (const c of o.contenidos) {
    if (!c.fecha) continue;
    const k = c.fecha + '|' + c.tipo;
    if (!porDia.has(k)) porDia.set(k, []);
    porDia.get(k).push(c);
  }

  const cal = h('div.cal');
  cal.classList.add(o.vista === 'semana' ? 'semana' : 'mes');
  const wrap = h('div');
  cal.append(wrap);
  wrap.append(h('div.cal-head', h('div'), DIAS_CORTOS.map(d => h('div', d))));

  for (let ini = desde; ini <= hasta; ini = sumarDias(ini, 7)) {
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(ini, i));
    const week = h('div.cal-week');
    week.append(h('div.cal-nums', h('div'), dias.map(d => {
      const div = h('div', h('span', String(Number(d.slice(8)))));
      if (o.vista === 'mes' && d.slice(0, 7) !== mesRef) div.classList.add('fuera');
      if (d === hoy) div.classList.add('hoy');
      return div;
    })));
    for (const tipo of ['feed', 'story']) {
      const row = h('div.cal-row', h('div.rlabel', tipo === 'feed' ? 'Feed' : 'Stories'));
      if (tipo === 'story') row.classList.add('stories');
      for (const d of dias) {
        const cell = h('div.cell', { dataset: { fecha: d, tipo }, title: 'Doble clic para agregar un contenido' });
        if (o.vista === 'mes' && d.slice(0, 7) !== mesRef) cell.classList.add('fuera');
        const items = (porDia.get(d + '|' + tipo) || []).sort(ordenar);
        for (const c of items) cell.append(tarjeta(c, o, o.vista === 'semana'));
        cell.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drop'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
        cell.addEventListener('drop', e => {
          e.preventDefault();
          cell.classList.remove('drop');
          const id = e.dataTransfer.getData('text/plain');
          if (id) o.on.mover(id, d);
        });
        cell.addEventListener('dblclick', e => { if (e.target === cell) o.on.nuevo({ fecha: d, tipo }); });
        row.append(cell);
      }
      week.append(row);
    }
    wrap.append(week);
  }
  cont.append(cal);
}

// ---------------------------------------------------------------------------
// Lista (ordenable y exportable a CSV)
// ---------------------------------------------------------------------------

const COLUMNAS = [
  { k: 'fecha', t: 'Fecha', v: c => c.fecha || '' },
  { k: 'hora', t: 'Hora', v: c => c.hora || '' },
  { k: 'marca', t: 'Marca', v: (c, o) => o.marcas.get(c.marca_id)?.nombre || '' },
  { k: 'id_pieza', t: 'Id', v: c => c.id_pieza },
  { k: 'tipo', t: 'Tipo', v: c => c.tipo },
  { k: 'formato', t: 'Formato', v: c => c.formato + (c.cantidad_piezas > 1 ? ` (${c.cantidad_piezas})` : '') },
  { k: 'redes', t: 'Redes y estados', v: c => c.redes.map(r => RED_INFO[r].corto + ':' + (c['estado_' + r] || '')).join(' ') },
  { k: 'objetivo', t: 'Objetivo', v: c => c.objetivo },
  { k: 'campania', t: 'Campaña', v: c => c.campania },
];

function renderLista(cont, o) {
  const orden = o.orden || { k: 'fecha', dir: 1 };
  const col = COLUMNAS.find(x => x.k === orden.k) || COLUMNAS[0];
  const filas = [...o.contenidos].sort((a, b) => {
    const r = String(col.v(a, o)).localeCompare(String(col.v(b, o)), 'es', { numeric: true }) * orden.dir;
    return r || (a.fecha + a.hora).localeCompare(b.fecha + b.hora);
  });

  cont.append(h('div.list-tools',
    h('span', `${filas.length} contenido${filas.length === 1 ? '' : 's'}`),
    h('button.btn-ghost.sm', { on: { click: () => exportarCSV(filas, o) } }, 'Exportar CSV')));

  const thead = h('tr', COLUMNAS.map(c => h('th', {
    on: { click: () => o.setOrden({ k: c.k, dir: orden.k === c.k ? -orden.dir : 1 }) },
    'aria-sort': orden.k === c.k ? (orden.dir > 0 ? 'ascending' : 'descending') : undefined,
  }, c.t, orden.k === c.k ? h('span.sort', orden.dir > 0 ? '▲' : '▼') : null)));

  const tbody = h('tbody');
  for (const c of filas) {
    const marca = o.marcas.get(c.marca_id);
    const atrasadas = redesAtrasadas(c, o.ahora);
    const redes = h('div.cc-redes', c.redes.map(red => {
      const chip = chipRed(red, c['estado_' + red], { atrasada: atrasadas.includes(red) });
      chip.addEventListener('click', e => { e.stopPropagation(); o.on.estado(c, red); });
      return chip;
    }));
    const tr = h('tr.fila', { on: { click: () => o.on.abrir(c) } },
      h('td', { style: { whiteSpace: 'nowrap' } }, fmtCorta(c.fecha)),
      h('td', c.hora || '—'),
      h('td', { style: { whiteSpace: 'nowrap' } }, marca ? h('span.marca-dot', { style: { background: marca.color } }) : null, marca?.nombre || '—'),
      h('td', h('b', c.id_pieza)),
      h('td', h('span.tipo-tag' + (c.tipo === 'story' ? '.story' : ''), c.tipo === 'story' ? 'Story' : 'Feed')),
      h('td', COLUMNAS[5].v(c, o) || '—'),
      h('td', redes),
      h('td', c.objetivo || '—'),
      h('td', c.campania || '—'));
    if (atrasadas.length) tr.classList.add('atrasada');
    tbody.append(tr);
  }
  cont.append(h('div.tablewrap', h('table.lista', h('thead', thead), tbody)));
}

function exportarCSV(filas, o) {
  const cab = ['fecha', 'hora', 'marca', 'id_pieza', 'tipo', 'formato', 'cantidad_piezas', 'ubicacion', 'redes',
    ...REDES.map(r => 'estado_' + r), 'objetivo', 'campania', 'circulacion', 'titulo', 'descripcion', 'bajada', 'link', 'notas', 'atrasada'];
  const datos = filas.map(c => [
    c.fecha, c.hora, o.marcas.get(c.marca_id)?.nombre || '', c.id_pieza, c.tipo, c.formato, c.cantidad_piezas, c.ubicacion,
    c.redes.join(', '), ...REDES.map(r => c.redes.includes(r) ? ESTADO_INFO[c['estado_' + r]]?.nombre || '' : ''),
    c.objetivo, c.campania, c.circulacion, c.titulo, c.descripcion, c.bajada, c.link, c.notas,
    redesAtrasadas(c, o.ahora).map(r => RED_INFO[r].nombre).join(', '),
  ]);
  descargarCSV(`calendario-wasabi-${o.ref.slice(0, 7)}.csv`, [cab, ...datos]);
}
