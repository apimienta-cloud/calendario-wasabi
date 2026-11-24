// importer.js — Importador de cronogramas .pptx.
// Lee el archivo EN EL NAVEGADOR con zip.js: solo el directorio central y los
// ppt/slides/slideN.xml. Nunca carga el archivo entero ni lo sube a ningún lado.
import { h, abrirModal, toast, REDES, RED_INFO, chipRed, fmtCorta, confirmar } from './ui.js';
import { extractSlideLines, isSlidePath, slideNumberFromPath, parsearCronograma, normalizar, nombreMes } from './pptx-parser.js';

const ZIP_URL = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.52/index.js';

const CAMPOS = ['id_pieza', 'tipo', 'formato', 'cantidad_piezas', 'ubicacion', 'fecha', 'hora', 'redes', 'objetivo',
  'campania', 'circulacion', 'bajada', 'titulo', 'descripcion', 'link', 'notas'];
const NOMBRE_CAMPO = {
  id_pieza: 'Id', tipo: 'Tipo', formato: 'Formato', cantidad_piezas: 'Cantidad', ubicacion: 'Ubicación', fecha: 'Fecha', hora: 'Hora',
  redes: 'Redes', objetivo: 'Objetivo', campania: 'Campaña', circulacion: 'Circulación', bajada: 'Bajada', titulo: 'Título',
  descripcion: 'Descripción', link: 'Link', notas: 'Notas',
};
const DINAMICAS = ['Falta la hora.', 'Faltan las redes.', 'Falta la fecha.', 'Falta el formato.'];

/** Lee las diapositivas de un .pptx (File) con zip.js. onProgreso(fraccion, texto) */
export async function leerDiapositivas(file, onProgreso = () => {}) {
  onProgreso(0.02, 'Cargando lector de archivos…');
  const zip = await import(ZIP_URL);
  zip.configure({ useWebWorkers: false });
  onProgreso(0.05, 'Leyendo el índice del archivo…');
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  try {
    const entries = (await reader.getEntries()).filter(e => isSlidePath(e.filename))
      .sort((a, b) => slideNumberFromPath(a.filename) - slideNumberFromPath(b.filename));
    if (!entries.length) throw new Error('El archivo no tiene diapositivas. ¿Es un .pptx?');
    const slides = [];
    for (let i = 0; i < entries.length; i++) {
      const xml = await entries[i].getData(new zip.TextWriter());
      slides.push({ num: slideNumberFromPath(entries[i].filename), lines: extractSlideLines(xml) });
      onProgreso(0.05 + 0.95 * (i + 1) / entries.length, `Diapositiva ${i + 1} de ${entries.length}`);
    }
    return slides;
  } finally {
    await reader.close().catch(() => {});
  }
}

/**
 * @param {object} o { marca, api, onListo(anio, mes) }
 */
export function abrirImportador({ marca, api, onListo }) {
  const m = abrirModal({ titulo: `Importar cronograma · ${marca.nombre}`, ancho: true });
  let estado = null; // { res, filas, anio, mes, archivo }

  paso1();

  // ---------------- Paso 1: elegir archivo ----------------
  function paso1() {
    m.body.innerHTML = ''; m.foot.innerHTML = '';
    const input = h('input', { type: 'file', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', hidden: true, on: { change: () => input.files[0] && leer(input.files[0]) } });
    const zona = h('div.drop-zone',
      h('b', 'Arrastrá el cronograma (.pptx) acá'),
      h('div', 'o ', h('button.link-btn', { type: 'button', on: { click: () => input.click() } }, 'elegilo desde tu compu')),
      h('p.meta', { style: { marginTop: '12px' } }, 'El archivo no se sube a ningún lado: se lee en tu navegador y solo se toma el texto de las diapositivas (los videos no se cargan).'),
      input);
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('over'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('over'));
    zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) leer(f); });
    m.body.append(zona);
    m.foot.append(h('button.btn-ghost', { on: { click: () => m.cerrar() } }, 'Cancelar'));
  }

  // ---------------- Paso 2: leer ----------------
  async function leer(file) {
    if (!/\.pptx$/i.test(file.name)) { toast('Elegí un archivo .pptx', 'error'); return; }
    m.body.innerHTML = ''; m.foot.innerHTML = '';
    const barra = h('div');
    const txt = h('div.meta', 'Preparando…');
    m.body.append(h('div.sec',
      h('b', file.name), h('span.meta', `${(file.size / 1048576).toFixed(0)} MB`),
      h('div.progress', barra), txt));
    try {
      const t0 = performance.now();
      const slides = await leerDiapositivas(file, (f, t) => { barra.style.width = (f * 100).toFixed(1) + '%'; txt.textContent = t; });
      const res = parsearCronograma(slides, file.name);
      res.ms = Math.round(performance.now() - t0);
      const filas = res.contenidos.map(c => ({
        sel: true, abierta: false,
        c: Object.fromEntries(CAMPOS.map(k => [k, Array.isArray(c[k]) ? [...c[k]] : c[k]])),
        adv: c.advertencias.filter(a => !DINAMICAS.includes(a)),
        diap: c.diapositivas,
      }));
      estado = { res, filas, anio: res.anio || new Date().getFullYear(), mes: res.mes || 1, archivo: file.name };
      paso3();
    } catch (err) {
      console.error(err);
      m.body.innerHTML = '';
      m.body.append(h('div.aviso.naranja', 'No se pudo leer el archivo: ' + (err.message || err)));
      m.foot.append(h('button.btn-ghost', { on: { click: paso1 } }, 'Elegir otro archivo'));
    }
  }

  function advertenciasFila(f) {
    const a = [...f.adv];
    if (!f.c.fecha) a.push('Falta la fecha.');
    if (!f.c.hora) a.push('Falta la hora.');
    if (!f.c.redes.length) a.push('Faltan las redes.');
    if (!f.c.formato) a.push('Falta el formato.');
    if (f.c.fecha && (Number(f.c.fecha.slice(5, 7)) !== Number(estado.mes))) a.push('La fecha no es del mes elegido.');
    return a;
  }

  // ---------------- Paso 3: vista previa editable ----------------
  function paso3() {
    const { res, filas } = estado;
    m.body.innerHTML = ''; m.foot.innerHTML = '';
    m.setTitulo(`Vista previa · ${estado.archivo}`);

    const coincide = !res.marca || normalizar(res.marca) === normalizar(marca.nombre);
    if (!coincide) {
      m.body.append(h('div.aviso.naranja', `Ojo: la portada dice "${res.marca}", pero estás importando en "${marca.nombre}". Revisá que sea el archivo correcto antes de confirmar.`));
    }
    res.advertencias.forEach(a => m.body.append(h('div.aviso', a)));

    const selAnio = h('select', { on: { change: () => { estado.anio = Number(selAnio.value); } } },
      Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).concat(estado.anio).filter((v, i, arr) => arr.indexOf(v) === i).sort()
        .map(y => h('option', { value: y, selected: y === estado.anio }, y)));
    const selMes = h('select', { on: { change: () => { estado.mes = Number(selMes.value); pintarTabla(); } } },
      Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === estado.mes }, nombreMes(i + 1))));

    const resumen = h('div.imp-resumen');
    function pintarResumen() {
      const sel = filas.filter(f => f.sel);
      const conAdv = sel.filter(f => advertenciasFila(f).length).length;
      resumen.innerHTML = '';
      resumen.append(
        h('span.imp-pill', h('b', sel.filter(f => f.c.tipo === 'feed').length), ' feed'),
        h('span.imp-pill', h('b', sel.filter(f => f.c.tipo === 'story').length), ' stories'),
        h('span.imp-pill', h('b', res.omitidos.length), ' omitidos'),
        h('span.imp-pill.warn', h('b', conAdv), ' con advertencias'),
        h('span.imp-pill', h('b', filas.length - sel.length), ' destildados'));
    }

    m.body.append(
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span', 'Portada: ', h('b', res.marca || '—'), ` · ${res.diapositivas} diapositivas leídas en ${(res.ms / 1000).toFixed(1)} s`),
        h('span', { style: { flex: 1 } }),
        h('label.field', { style: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, h('span', 'Mes'), selMes),
        h('label.field', { style: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, h('span', 'Año'), selAnio)),
      resumen,
      h('p.meta', { style: { margin: 0 } }, 'Podés corregir cualquier celda o destildar filas antes de seguir. "Ver más" muestra el copy y el resto de los campos.'));

    const tbody = h('tbody');
    const wrap = h('div.imp-table-wrap', h('table.imp-table',
      h('thead', h('tr', ['', 'Fecha', 'Hora', 'Tipo', 'Id', 'Formato', 'Cant.', 'Redes', 'Objetivo', 'Advertencias', ''].map(t => h('th', t)))),
      tbody));
    m.body.append(wrap);

    if (res.omitidos.length) {
      m.body.append(h('details.omitidos',
        h('summary', `Omitidos (${res.omitidos.length}): no se importan`),
        h('ul', res.omitidos.map(o => h('li', h('b', o.id_pieza), ` — ${o.motivo} (diap. ${o.diapositivas.join(', ')})`)))));
    }

    function pintarTabla() {
      tbody.innerHTML = '';
      filas.forEach(f => {
        const set = (k, v) => { f.c[k] = v; pintarFila(); pintarResumen(); };
        const tr = h('tr');
        const det = h('tr.detalle');
        function pintarFila() {
          const adv = advertenciasFila(f);
          tr.className = (f.sel ? '' : 'off ') + (adv.length ? 'warn' : '');
          advTd.innerHTML = '';
          adv.forEach(a => advTd.append(h('div', a)));
        }
        const advTd = h('td.adv');
        const redes = h('div.mini-redes', REDES.map(r => {
          const b = chipRed(r, 'pendiente', { titulo: RED_INFO[r].nombre });
          if (f.c.redes.includes(r)) b.classList.add('on');
          b.addEventListener('click', () => {
            const s = new Set(f.c.redes);
            s.has(r) ? s.delete(r) : s.add(r);
            f.c.redes = REDES.filter(x => s.has(x));
            b.classList.toggle('on', s.has(r));
            pintarFila(); pintarResumen();
          });
          return b;
        }));
        tr.append(
          h('td', h('input', { type: 'checkbox', checked: f.sel, 'aria-label': 'Importar esta fila', on: { change: e => { f.sel = e.target.checked; pintarFila(); pintarResumen(); } } })),
          h('td.w-fecha', h('input', { type: 'date', value: f.c.fecha, on: { change: e => set('fecha', e.target.value) } })),
          h('td.w-hora', h('input', { type: 'time', value: f.c.hora, on: { change: e => set('hora', e.target.value) } })),
          h('td.w-tipo', h('select', { on: { change: e => set('tipo', e.target.value) } },
            h('option', { value: 'feed', selected: f.c.tipo === 'feed' }, 'Feed'), h('option', { value: 'story', selected: f.c.tipo === 'story' }, 'Story'))),
          h('td.w-id', h('input', { value: f.c.id_pieza, on: { change: e => set('id_pieza', e.target.value.trim()) } })),
          h('td', h('input', { value: f.c.formato, on: { change: e => set('formato', e.target.value.trim()) } })),
          h('td', h('input.w-num', { type: 'number', min: 1, value: f.c.cantidad_piezas, on: { change: e => set('cantidad_piezas', Math.max(1, parseInt(e.target.value, 10) || 1)) } })),
          h('td', redes),
          h('td', h('input', { value: f.c.objetivo, on: { change: e => set('objetivo', e.target.value) } })),
          advTd,
          h('td', h('button.link-btn', { type: 'button', on: { click: () => { f.abierta = !f.abierta; det.hidden = !f.abierta; } } }, 'Ver más')));
        const fld = (label, k, area) => h('label.field', h('span', label), area
          ? h('textarea', { rows: 3, on: { change: e => set(k, e.target.value) } }, f.c[k])
          : h('input', { value: f.c[k], on: { change: e => set(k, e.target.value) } }));
        det.append(h('td'), h('td', { colSpan: 10 },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' } },
            fld('Bajada (copy)', 'bajada', true), fld('Link', 'link', true), fld('Notas', 'notas', true),
            fld('Título', 'titulo'), fld('Descripción', 'descripcion'), fld('Ubicación', 'ubicacion'),
            fld('Campaña', 'campania'), fld('Circulación', 'circulacion')),
          h('div.meta', { style: { marginTop: '6px' } }, `Diapositivas: ${f.diap.join(', ')}`)));
        det.hidden = !f.abierta;
        pintarFila();
        tbody.append(tr, det);
      });
      pintarResumen();
    }
    pintarTabla();

    const btnSeguir = h('button.btn-primary', { on: { click: comparar } }, 'Comparar y seguir →');
    m.foot.append(
      h('button.btn-ghost', { on: { click: paso1 } }, 'Elegir otro archivo'),
      h('span.spacer'),
      h('button.btn-ghost', { on: { click: () => m.cerrar() } }, 'Cancelar'),
      btnSeguir);

    async function comparar() {
      const sel = filas.filter(f => f.sel);
      if (!sel.length) return toast('No hay filas tildadas para importar.', 'error');
      const sinFecha = sel.filter(f => !f.c.fecha || !f.c.id_pieza);
      if (sinFecha.length) return toast(`${sinFecha.length} fila(s) tildadas no tienen fecha o Id: completalas o destildalas.`, 'error');
      if (!coincide && !(await confirmar(`La portada dice "${res.marca}" y vas a importar en "${marca.nombre}". ¿Seguir igual?`, { si: 'Seguir' }))) return;
      btnSeguir.disabled = true; btnSeguir.textContent = 'Comparando…';
      try {
        const preview = await api('importPreview', { marca_id: marca.id, anio: estado.anio, mes: estado.mes, contenidos: sel.map(f => f.c) });
        paso4(preview);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btnSeguir.disabled = false; btnSeguir.textContent = 'Comparar y seguir →';
      }
    }
  }

  // ---------------- Paso 4: nuevos / modificados / ya no están ----------------
  function paso4(p) {
    m.body.innerHTML = ''; m.foot.innerHTML = '';
    m.setTitulo(`Confirmar importación · ${marca.nombre} · ${nombreMes(estado.mes)} ${estado.anio}`);
    const decision = new Map(); // id → pisarManual
    const borrar = new Set();

    const etiqueta = c => `${fmtCorta(c.fecha)} · ${c.tipo === 'story' ? 'Story' : 'Feed'} · ${c.id_pieza}`;
    const txt = v => v === '' ? '(vacío)' : (v.length > 90 ? v.slice(0, 90) + '…' : v);

    if (p.existentes === 0) {
      m.body.append(h('div.aviso', `Es la primera vez que se importa ${nombreMes(estado.mes)} ${estado.anio} para ${marca.nombre}.`));
    } else {
      m.body.append(h('div.aviso', `Ya había ${p.existentes} contenidos importados de este mes. Los estados por red (programado / publicado) nunca se modifican al reimportar.`));
    }

    m.body.append(h('div.grupo',
      h('h4', 'Nuevos', h('span.n', p.nuevos.length)),
      p.nuevos.length ? h('ul', p.nuevos.map(n => h('li', etiqueta(n.contenido)))) : h('div.meta', 'No hay contenidos nuevos.')));

    m.body.append(h('div.grupo.mod',
      h('h4', 'Modificados', h('span.n', p.modificados.length)),
      p.modificados.length ? h('ul', p.modificados.map(x => {
        if (x.editado_manual) decision.set(x.id, false);
        const nombre = 'pisar-' + x.id;
        return h('li',
          h('b', etiqueta(x.contenido)),
          h('div', x.cambios.map(ch => h('div.cambio', `${NOMBRE_CAMPO[ch.campo] || ch.campo}: `, h('del', txt(ch.antes)), ' → ', h('ins', txt(ch.despues))))),
          x.editado_manual ? h('div.aviso.naranja', { style: { marginTop: '4px' } },
            'Este contenido se editó a mano en la web. ',
            h('label', { style: { marginRight: '12px' } }, h('input', { type: 'radio', name: nombre, checked: true, on: { change: () => decision.set(x.id, false) } }), ' Conservar la edición manual'),
            h('label', h('input', { type: 'radio', name: nombre, on: { change: () => decision.set(x.id, true) } }), ' Pisar con el cronograma')) : null);
      })) : h('div.meta', 'Nada cambió en los contenidos que ya estaban.')));

    m.body.append(h('div.grupo.del',
      h('h4', 'Ya no están en el cronograma', h('span.n', p.eliminados.length)),
      p.eliminados.length ? h('div',
        h('p.meta', { style: { marginTop: 0 } }, 'No se borran solos. Tildá los que quieras eliminar.'),
        h('ul', { style: { listStyle: 'none', paddingLeft: 0 } }, p.eliminados.map(c => h('li',
          h('label', h('input', { type: 'checkbox', on: { change: e => e.target.checked ? borrar.add(c.id) : borrar.delete(c.id) } }),
            ' ', etiqueta(c), c.redes.some(r => c['estado_' + r] === 'publicado') ? h('span.meta', ' (ya publicado en alguna red)') : null))))) : h('div.meta', 'Todo lo que estaba sigue en el cronograma.')));

    if (p.sinCambios) m.body.append(h('p.meta', `${p.sinCambios} contenido(s) sin cambios.`));
    if (p.manuales) m.body.append(h('p.meta', `${p.manuales} contenido(s) cargados a mano en este mes no se tocan.`));

    const btn = h('button.btn-primary', { on: { click: confirmarImport } }, 'Confirmar importación');
    m.foot.append(h('button.btn-ghost', { on: { click: paso3 } }, '← Volver a la vista previa'), h('span.spacer'), btn);

    async function confirmarImport() {
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const r = await api('importCommit', {
          marca_id: marca.id, anio: estado.anio, mes: estado.mes,
          nuevos: p.nuevos.map(n => n.contenido),
          actualizar: p.modificados.map(x => ({ id: x.id, contenido: x.contenido, pisarManual: decision.get(x.id) === true })),
          eliminar: [...borrar],
        });
        const partes = [`${r.agregados} agregados`, `${r.actualizados} actualizados`];
        if (r.conservados) partes.push(`${r.conservados} con edición manual conservada`);
        if (r.eliminados) partes.push(`${r.eliminados} eliminados`);
        toast('Importación lista: ' + partes.join(', '), 'ok');
        m.cerrar();
        onListo && onListo(estado.anio, estado.mes);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Confirmar importación';
      }
    }
  }
}
