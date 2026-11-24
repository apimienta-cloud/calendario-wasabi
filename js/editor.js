// editor.js — Panel lateral con todos los campos editables de un contenido.
import { h, add, REDES, RED_INFO, ESTADOS, ESTADO_INFO, confirmar, fmtLarga, redesAtrasadas, ahoraMVD, toast } from './ui.js';

let abierto = null;

export function cerrarEditor() { if (abierto) abierto(true); }

/**
 * @param {object} c  contenido existente (con id) o borrador (sin id)
 * @param {object} ctx { marcas:[], marcasMap: Map, guardar(c)→Promise<c>, eliminar(c)→Promise,
 *                       setEstado(c, red, estado)→Promise<c>, duplicar(c) }
 */
export function abrirEditor(c, ctx) {
  if (abierto) abierto(true);
  const root = document.getElementById('panel-root');
  const esNuevo = !c.id;
  const original = JSON.stringify(c);
  const estados = {};
  REDES.forEach(r => { estados[r] = c['estado_' + r] || 'pendiente'; });
  let redesGuardadas = esNuevo ? [] : [...c.redes];

  // ---------- campos ----------
  const campo = (label, input) => h('label.field', h('span', label), input);
  const inp = (k, attrs = {}) => h('input', { value: c[k] ?? '', name: k, ...attrs });
  const area = (k, rows = 3) => h('textarea', { name: k, rows }, c[k] ?? '');

  const marcasActivas = ctx.marcas.filter(m => m.activa || m.id === c.marca_id);
  const selMarca = h('select', { name: 'marca_id' },
    h('option', { value: '' }, 'Elegí una marca…'),
    marcasActivas.map(m => h('option', { value: m.id, selected: m.id === c.marca_id }, m.nombre)));
  const selTipo = h('select', { name: 'tipo' },
    h('option', { value: 'feed', selected: c.tipo !== 'story' }, 'Feed'),
    h('option', { value: 'story', selected: c.tipo === 'story' }, 'Story'));

  const redesBox = h('div.redes-check', REDES.map(r => h('label',
    h('input', { type: 'checkbox', value: r, checked: c.redes.includes(r), on: { change: pintarEstados } }), RED_INFO[r].nombre)));
  const estadosBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

  function redesMarcadas() { return [...redesBox.querySelectorAll('input:checked')].map(i => i.value); }

  function pintarEstados() {
    estadosBox.innerHTML = '';
    const redes = redesMarcadas();
    if (!redes.length) { estadosBox.append(h('div.meta', 'Marcá al menos una red para ver sus estados.')); return; }
    const borrador = { ...c, fecha: form.fecha.value, hora: form.hora.value, redes, ...Object.fromEntries(REDES.map(r => ['estado_' + r, estados[r]])) };
    const atrasadas = c.id ? redesAtrasadas(borrador, ahoraMVD()) : [];
    for (const r of redes) {
      const seg = h('div.estado-seg', ESTADOS.map(e => {
        const b = h('button', { type: 'button', on: { click: () => cambiarEstado(r, e) } }, ESTADO_INFO[e].nombre);
        b.classList.add(e);
        if (estados[r] === e) b.classList.add('on');
        return b;
      }));
      estadosBox.append(h('div.estado-row',
        h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('b', RED_INFO[r].nombre),
          atrasadas.includes(r) ? h('span.chip-red.atrasada', { html: '<span>Atrasada</span>' }) : null),
        seg));
    }
  }

  async function cambiarEstado(red, estado) {
    const anterior = estados[red];
    estados[red] = estado;
    pintarEstados();
    // Si el contenido ya existe y la red ya estaba guardada, se guarda al instante
    if (c.id && redesGuardadas.includes(red)) {
      try {
        const nuevo = await ctx.setEstado(c, red, estado);
        c['estado_' + red] = nuevo['estado_' + red];
      } catch (err) {
        estados[red] = anterior;
        pintarEstados();
        toast(err.message, 'error');
      }
    }
  }

  const form = h('form', { style: { display: 'contents' }, on: { submit: e => { e.preventDefault(); guardar(); } } });
  const marca = ctx.marcasMap.get(c.marca_id);

  add(form,
    c.editado_manual ? h('div.aviso', 'Este contenido vino del cronograma y se editó a mano. Si reimportás el cronograma, te va a preguntar si conservar estos cambios.') : null,
    h('div.sec',
      h('h4', 'Pieza'),
      campo('Marca', selMarca),
      h('div.grid2', campo('Id de la pieza', inp('id_pieza', { required: true, placeholder: 'Ej: Bocaditos' })), campo('Tipo', selTipo)),
      h('div.grid3',
        campo('Formato', inp('formato', { list: 'formatos-list', placeholder: 'Reel, Estática…' })),
        campo('Cant. piezas', inp('cantidad_piezas', { type: 'number', min: 1, step: 1 })),
        campo('Ubicación', inp('ubicacion', { placeholder: 'Feed, Story…' }))),
      h('datalist#formatos-list', ['Reel', 'Estática', 'Carrusel', 'Video', 'Shorts'].map(f => h('option', { value: f })))),
    h('div.sec',
      h('h4', 'Cuándo y dónde'),
      h('div.grid2',
        campo('Fecha', inp('fecha', { type: 'date', required: true, on: { change: pintarEstados } })),
        campo('Hora', inp('hora', { type: 'time', on: { change: pintarEstados } }))),
      h('div.field', h('span', 'Redes'), redesBox)),
    h('div.sec', h('h4', 'Estado por red'), estadosBox),
    h('div.sec',
      h('h4', 'Copy y datos'),
      campo('Bajada (copy)', area('bajada', 5)),
      campo('Título', inp('titulo')),
      campo('Descripción', inp('descripcion')),
      campo('Link', area('link', 2)),
      h('div.grid2', campo('Objetivo', inp('objetivo')), campo('Campaña', inp('campania'))),
      campo('Circulación', inp('circulacion')),
      campo('Notas', area('notas', 2))),
    c.id ? h('div.meta', `Origen: ${c.origen === 'import' ? 'cronograma importado' : 'carga manual'}${c.actualizado ? ' · Última modificación: ' + c.actualizado.replace('T', ' ') : ''}`) : null,
  );

  // ---------- panel ----------
  const btnGuardar = h('button.btn-primary', { type: 'button', on: { click: () => guardar() } }, esNuevo ? 'Crear contenido' : 'Guardar');
  const foot = h('div.panel-foot',
    btnGuardar,
    !esNuevo ? h('button.btn-ghost', { type: 'button', on: { click: () => { cerrar(true); ctx.duplicar(leer(true)); } } }, 'Duplicar') : null,
    h('span.spacer'),
    !esNuevo ? h('button.btn-danger', { type: 'button', on: { click: eliminar } }, 'Eliminar') : null);

  const panel = h('aside.panel', { role: 'dialog', 'aria-label': 'Detalle del contenido' },
    h('div.panel-head',
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('h3', esNuevo ? (c._titulo || 'Nuevo contenido') : c.id_pieza),
        h('div.sub', [marca?.nombre, c.fecha ? fmtLarga(c.fecha) : null].filter(Boolean).join(' · '))),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Cerrar', on: { click: () => cerrar() } }, '×')),
    h('div.panel-body', form),
    foot);
  const back = h('div.panel-backdrop', { on: { click: () => cerrar() } });
  root.append(back, panel);
  pintarEstados();
  setTimeout(() => (esNuevo ? form.id_pieza : panel.querySelector('.icon-btn')).focus(), 30);

  const onKey = e => { if (e.key === 'Escape' && !document.getElementById('modal-root').children.length) cerrar(); };
  document.addEventListener('keydown', onKey);

  function leer(paraDuplicar = false) {
    const out = {
      ...c,
      marca_id: selMarca.value,
      id_pieza: form.id_pieza.value.trim(),
      tipo: selTipo.value,
      formato: form.formato.value.trim(),
      cantidad_piezas: Math.max(1, parseInt(form.cantidad_piezas.value, 10) || 1),
      ubicacion: form.ubicacion.value.trim(),
      fecha: form.fecha.value,
      hora: form.hora.value,
      redes: redesMarcadas(),
      bajada: form.bajada.value, titulo: form.titulo.value, descripcion: form.descripcion.value,
      link: form.link.value, objetivo: form.objetivo.value, campania: form.campania.value,
      circulacion: form.circulacion.value, notas: form.notas.value,
    };
    REDES.forEach(r => { out['estado_' + r] = estados[r]; });
    if (paraDuplicar) {
      delete out.id; delete out.creado; delete out.actualizado;
      out.origen = 'manual'; out.editado_manual = false;
      REDES.forEach(r => { out['estado_' + r] = 'pendiente'; });
      out._titulo = `Copia de ${c.id_pieza}`;
    }
    return out;
  }

  async function guardar() {
    const datos = leer();
    if (!datos.marca_id) return toast('Elegí la marca.', 'error');
    if (!datos.id_pieza) { form.id_pieza.focus(); return toast('Falta el Id de la pieza.', 'error'); }
    if (!datos.fecha) { form.fecha.focus(); return toast('Falta la fecha.', 'error'); }
    if (!datos.redes.length && !(await confirmar('No marcaste ninguna red. ¿Guardar igual?', { si: 'Guardar' }))) return;
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando…';
    try {
      const guardado = await ctx.guardar(datos);
      Object.assign(c, guardado);
      redesGuardadas = [...guardado.redes];
      toast(esNuevo ? 'Contenido creado' : 'Cambios guardados', 'ok');
      cerrar(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = esNuevo ? 'Crear contenido' : 'Guardar';
    }
  }

  async function eliminar() {
    if (!(await confirmar(`¿Eliminar "${c.id_pieza}" del ${fmtLarga(c.fecha)}? No se puede deshacer.`, { titulo: 'Eliminar contenido', si: 'Eliminar', peligro: true }))) return;
    try {
      await ctx.eliminar(c);
      toast('Contenido eliminado', 'ok');
      cerrar(true);
    } catch (err) { toast(err.message, 'error'); }
  }

  function hayCambios() {
    const actual = leer();
    const base = JSON.parse(original);
    const claves = ['marca_id', 'id_pieza', 'tipo', 'formato', 'ubicacion', 'fecha', 'hora', 'bajada', 'titulo', 'descripcion', 'link', 'objetivo', 'campania', 'circulacion', 'notas'];
    if (claves.some(k => String(actual[k] ?? '') !== String(base[k] ?? ''))) return true;
    if (String(actual.cantidad_piezas) !== String(base.cantidad_piezas ?? 1)) return true;
    if (actual.redes.join() !== (base.redes || []).join()) return true;
    if (esNuevo) return false;
    return REDES.some(r => !redesGuardadas.includes(r) && actual.redes.includes(r) && estados[r] !== (base['estado_' + r] || 'pendiente'));
  }

  async function cerrar(forzar = false) {
    if (!forzar && hayCambios() && !(await confirmar('Hay cambios sin guardar. ¿Cerrar igual?', { si: 'Descartar cambios', peligro: true }))) return;
    document.removeEventListener('keydown', onKey);
    back.remove(); panel.remove();
    abierto = null;
  }
  abierto = cerrar;
}
