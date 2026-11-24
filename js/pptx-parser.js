// pptx-parser.js — Parser de cronogramas Wasabi.
// Módulo puro: no depende del navegador ni de Node. Recibe el XML de cada
// diapositiva (ya extraído del .pptx) y devuelve los contenidos detectados.
// Lo usan tanto el importador del navegador (js/importer.js, con zip.js)
// como el script de prueba (tools/test-parser), así la lógica es la misma.

export const REDES = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------------------------------------------------------------------------
// 1. XML → líneas (un <a:p> = una línea; <a:br/> también corta línea)
// ---------------------------------------------------------------------------

export function decodeXmlEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(code); } catch { return m; }
  });
}

export function extractSlideLines(xml) {
  const lines = [];
  const paraRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
  let pm;
  while ((pm = paraRe.exec(xml))) {
    const body = pm[1];
    let current = '';
    const tokRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*?(?:\/>|>[\s\S]*?<\/a:br>)/g;
    let tm;
    while ((tm = tokRe.exec(body))) {
      if (tm[1] === undefined) { // <a:br/>
        if (current.trim()) lines.push(current);
        current = '';
      } else {
        current += decodeXmlEntities(tm[1]);
      }
    }
    if (current.trim()) lines.push(current);
  }
  return lines.map(l => l.replace(/ /g, ' ').replace(/[ \t]+$/g, ''));
}

export function slideNumberFromPath(path) {
  const m = /slide(\d+)\.xml$/i.exec(path);
  return m ? parseInt(m[1], 10) : null;
}

export function isSlidePath(path) {
  return /^ppt\/slides\/slide\d+\.xml$/i.test(path);
}

// ---------------------------------------------------------------------------
// 2. Helpers de texto
// ---------------------------------------------------------------------------

export function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function limpiarId(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export function claveId(s) {
  return normalizar(s);
}

const pad2 = n => String(n).padStart(2, '0');

// Rótulos: nombre normalizado → campo
const ROTULOS = [
  ['hora', 'hora'],
  ['objetivo', 'objetivo'],
  ['campana', 'campania'],
  ['campania', 'campania'],
  ['circulacion', 'circulacion'],
  ['bajada', 'bajada'],
  ['copy', 'bajada'],
  ['titulo', 'titulo'],
  ['descripcion', 'descripcion'],
  ['link', 'link'],
  ['links', 'link'],
  ['formato', 'formato'],
  ['ubicacion', 'ubicacion'],
  ['id', 'id'],
];

// Campos que pueden seguir en las líneas siguientes sin rótulo
const MULTILINEA = { objetivo: ', ', link: '\n', bajada: '\n', circulacion: ' ', descripcion: ' ', titulo: ' ' };

function detectarRotulo(line) {
  const m = /^\s*([^:]{1,20}?)\s*:\s*([\s\S]*)$/.exec(line);
  if (m) {
    const k = normalizar(m[1]);
    for (const [nombre, campo] of ROTULOS) if (k === nombre) return { campo, valor: m[2].trim() };
  }
  // "Bajada" sola, sin dos puntos
  const solo = normalizar(line);
  if (solo === 'bajada' || solo === 'copy') return { campo: 'bajada', valor: '' };
  return null;
}

const DIA_LARGO = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
const DIA_CORTO = '(?:lun|mar|mie|jue|vie|sab|dom)';

// Devuelve { dias:[n...], mes:n } o null
export function parsearLineaFecha(line) {
  const n = normalizar(line);
  if (!new RegExp('^' + DIA_CORTO).test(n) && !new RegExp('^' + DIA_LARGO).test(n) && !/^\d{1,2}(\s*[,y]\s*\d{1,2})*\s*\/\s*\d{1,2}$/.test(n)) return null;
  if (!/\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(n)) return null;
  // Solo nombres de días, comas, "y", números y una barra final
  const sinDias = n.replace(new RegExp(DIA_LARGO, 'g'), ' ').replace(new RegExp(DIA_CORTO + '\\.?', 'g'), ' ');
  if (/[a-z]/.test(sinDias.replace(/\by\b/g, ''))) return null;
  const mMes = /\/\s*(\d{1,2})\s*$/.exec(sinDias);
  const mes = parseInt(mMes[1], 10);
  const antes = sinDias.slice(0, mMes.index);
  const dias = (antes.match(/\d{1,2}/g) || []).map(d => parseInt(d, 10));
  if (!dias.length || mes < 1 || mes > 12 || dias.some(d => d < 1 || d > 31)) return null;
  return { dias: [...new Set(dias)], mes };
}

const ALIAS_RED = {
  meta: ['instagram', 'facebook'],
  instagram: ['instagram'], ig: ['instagram'],
  facebook: ['facebook'], fb: ['facebook'],
  tiktok: ['tiktok'],
  youtube: ['youtube'], yt: ['youtube'],
  linkedin: ['linkedin'],
};

export function parsearLineaRedes(line) {
  const partes = line.split(/[,/]|\by\b/).map(p => normalizar(p).replace(/\s+/g, '')).filter(Boolean);
  if (!partes.length) return null;
  const set = new Set();
  for (const p of partes) {
    const r = ALIAS_RED[p];
    if (!r) return null;
    r.forEach(x => set.add(x));
  }
  return REDES.filter(r => set.has(r));
}

export function parsearHora(valor) {
  const v = String(valor || '').trim();
  if (!v) return { hora: '', valida: true };
  const m = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*(?:hs?\.?|horas)?$/i.exec(v);
  if (m) {
    const h = parseInt(m[1], 10), mi = parseInt(m[2] || '0', 10);
    if (h < 24 && mi < 60) return { hora: pad2(h) + ':' + pad2(mi), valida: true };
  }
  return { hora: v, valida: false };
}

export function parsearFormato(valor) {
  const v = String(valor || '').trim();
  const m = /^(.*?)\s*\(\s*(\d+)\s*\)?\s*$/.exec(v);
  if (m && m[1]) return { formato: m[1].trim(), cantidad: parseInt(m[2], 10) };
  return { formato: v, cantidad: v ? 1 : null };
}

export function esStory(ubicacion, id) {
  return /\bstor(y|ies)\b/i.test(ubicacion || '') || /story\s*$/i.test(id || '');
}

// ---------------------------------------------------------------------------
// 3. Diapositiva → campos
// ---------------------------------------------------------------------------

export function parsearDiapositiva(lines) {
  const s = { campos: {}, rotulos: new Set(), fechas: null, fechaTexto: '', redes: null, anuncio: '', notas: [] };
  let actual = null; // campo multilínea abierto

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const rot = detectarRotulo(line);
    if (rot) {
      s.rotulos.add(rot.campo);
      const prev = s.campos[rot.campo];
      if (prev && rot.valor && prev !== rot.valor && rot.campo !== 'bajada') {
        // rótulo repetido con otro valor: lo dejamos en notas
        s.notas.push(line);
      } else if (!prev || rot.valor) {
        s.campos[rot.campo] = rot.valor;
      }
      actual = MULTILINEA[rot.campo] !== undefined ? rot.campo : null;
      continue;
    }

    // La bajada solo se corta con otro rótulo
    if (actual === 'bajada') {
      s.campos.bajada = s.campos.bajada ? s.campos.bajada + '\n' + line : line;
      continue;
    }

    if (/^anuncio\b/i.test(normalizar(line))) {
      s.anuncio = line;
      actual = null;
      continue;
    }

    const f = parsearLineaFecha(line);
    if (f) {
      if (!s.fechas) { s.fechas = f; s.fechaTexto = line; }
      else s.notas.push(line);
      actual = null;
      continue;
    }

    const r = parsearLineaRedes(line);
    if (r && r.length) {
      if (!s.redes) s.redes = r;
      actual = null;
      continue;
    }

    if (actual) {
      const sep = MULTILINEA[actual];
      s.campos[actual] = s.campos[actual] ? s.campos[actual] + sep + line : line;
      continue;
    }

    // Línea suelta → notas (si tiene algo de texto real)
    if (/[\p{L}\p{N}]/u.test(line)) s.notas.push(line);
  }

  // Link: una línea por destino (el cronograma a veces los separa con "|")
  if (s.campos.link) s.campos.link = s.campos.link.split(/\n|\s\|\s/).map(x => x.trim()).filter(Boolean).join('\n');
  // Objetivo: "Alcance | Tráfico" o "Alcance" + "Tráfico" → "Alcance, Tráfico"
  if (s.campos.objetivo) s.campos.objetivo = s.campos.objetivo.split(/\s*[|,/]\s*/).map(x => x.trim()).filter(Boolean).join(', ');
  if (s.campos.id !== undefined) s.campos.id = limpiarId(s.campos.id);
  return s;
}

const CAMPOS_PRINCIPAL = ['objetivo', 'campania', 'circulacion', 'bajada', 'titulo', 'descripcion', 'link'];

function esPrincipal(s) {
  return !!s.redes || CAMPOS_PRINCIPAL.some(c => s.rotulos.has(c));
}

// ---------------------------------------------------------------------------
// 4. Portada
// ---------------------------------------------------------------------------

export function parsearPortada(lines) {
  const texto = lines.join(' | ');
  const m = /contenidos?\s*\|\s*(.+?)\s*\|\s*([a-záéíóúñ]+)\s+(\d{4})/i.exec(texto);
  if (!m) return null;
  const mes = MESES.indexOf(normalizar(m[2])) + 1;
  if (!mes) return null;
  return { marca: m[1].trim(), mes, anio: parseInt(m[3], 10) };
}

export function parsearNombreArchivo(nombre) {
  const base = String(nombre || '').replace(/^.*[\\/]/, '').replace(/\.pptx$/i, '');
  const m = /cronograma[-_ ]+(.+)[-_ ]+([a-záéíóúñ]+)[-_ ]+(\d{4})/i.exec(base);
  if (!m) return null;
  const mes = MESES.indexOf(normalizar(m[2])) + 1;
  if (!mes) return null;
  return { marca: m[1].replace(/[-_]+/g, ' ').trim(), mes, anio: parseInt(m[3], 10) };
}

export function nombreMes(mes) {
  const n = MESES[mes - 1] || '';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ---------------------------------------------------------------------------
// 5. Cronograma completo
// ---------------------------------------------------------------------------

/**
 * @param {{num:number, lines:string[]}[]} slides  ordenadas por número
 * @param {string} nombreArchivo
 * @returns {{marca:string, mes:number, anio:number, origenPortada:string,
 *   contenidos:object[], omitidos:object[], advertencias:string[], diapositivas:number}}
 */
export function parsearCronograma(slides, nombreArchivo = '') {
  slides = [...slides].sort((a, b) => a.num - b.num);
  const advertencias = [];
  const omitidos = [];

  // Portada
  let portada = slides.length ? parsearPortada(slides[0].lines) : null;
  let origenPortada = 'portada';
  if (!portada) {
    portada = parsearNombreArchivo(nombreArchivo);
    origenPortada = 'archivo';
    if (portada) advertencias.push('No se encontró la portada "Contenidos | Marca | Mes Año"; se usó el nombre del archivo.');
    else {
      portada = { marca: '', mes: 0, anio: 0 };
      origenPortada = 'ninguno';
      advertencias.push('No se pudo detectar marca, mes ni año (ni en la portada ni en el nombre del archivo).');
    }
  }

  // Parsear diapositivas de piezas
  const parsed = [];
  for (const sl of slides) {
    if (sl.num === 1 && origenPortada === 'portada') continue;
    if (!sl.lines.length) continue;
    const s = parsearDiapositiva(sl.lines);
    s.num = sl.num;
    if (sl.num === 3 && !s.campos.id) continue; // calendario resumen
    if (!s.campos.id) {
      const tieneDatos = s.fechas || s.redes || s.rotulos.size;
      if (tieneDatos && !s.anuncio) {
        advertencias.push(`Diapositiva ${sl.num}: tiene datos pero no tiene "Id:"; se ignoró.`);
      }
      if (s.anuncio && tieneDatos) {
        omitidos.push({ id_pieza: s.campos.titulo || `(sin Id, diap. ${sl.num})`, motivo: `${s.anuncio.trim()}: anuncio, no se publica`, diapositivas: [sl.num] });
      }
      continue;
    }
    parsed.push(s);
  }

  // Omitidos: anuncios, banners, catálogo
  const piezasValidas = [];
  for (const s of parsed) {
    const fmt = normalizar(s.campos.formato);
    const ubi = normalizar(s.campos.ubicacion);
    let motivo = '';
    if (s.anuncio) motivo = `Marcado como "${s.anuncio.trim().replace(/\s+/g, ' ')}": es un anuncio, no se publica`;
    else if (fmt.includes('banner')) motivo = 'Banner web: no es una publicación en redes';
    else if (ubi.includes('catalogo')) motivo = 'Anuncio de catálogo: no se publica';
    if (motivo) {
      const ya = omitidos.find(o => claveId(o.id_pieza) === claveId(s.campos.id) && o.motivo === motivo);
      if (ya) ya.diapositivas.push(s.num);
      else omitidos.push({ id_pieza: s.campos.id, motivo, diapositivas: [s.num] });
      continue;
    }
    piezasValidas.push(s);
  }

  // Agrupar principal + continuaciones
  const piezas = [];
  const claveFechas = s => s.fechas ? s.fechas.mes + ':' + s.fechas.dias.join(',') : '';
  let ultima = null; let ultimaNum = -1;

  for (const s of piezasValidas) {
    const kId = claveId(s.campos.id);
    const kF = claveFechas(s);
    const tipo = tipoDe(s);
    const principal = esPrincipal(s);
    let destino = piezas.find(p => p.kId === kId && p.tipo === tipo && (p.kF === kF || !kF || !p.kF));

    if (principal) {
      if (destino && destino.principal) {
        destino.advertencias.push(`El Id "${s.campos.id}" aparece como pieza completa en las diapositivas ${destino.diapositivas.join(', ')} y ${s.num}; se juntaron.`);
        fusionar(destino, s, false);
      } else if (destino) {
        // existía una continuación suelta: la principal manda
        fusionar(destino, s, true);
        destino.principal = true;
      } else {
        destino = nuevaPieza(s, true);
        piezas.push(destino);
      }
    } else {
      if (!destino && ultima && ultimaNum === s.num - 1 && ultima.tipo === tipo && (!kF || !ultima.kF || ultima.kF === kF)) {
        ultima.advertencias.push(`La diapositiva ${s.num} dice "Id: ${s.campos.id}", pero es continuación de "${ultima.campos.id}" (misma fecha, diapositiva siguiente); se agrupó con esta. Revisá el Id en el PowerPoint.`);
        destino = ultima;
      }
      if (destino) fusionar(destino, s, false);
      else {
        destino = nuevaPieza(s, false);
        destino.advertencias.push(`Diapositiva ${s.num}: solo tiene datos de continuación (sin redes, objetivo ni copy) y no se encontró la diapositiva principal.`);
        piezas.push(destino);
      }
    }
    ultima = destino; ultimaNum = s.num;
  }

  // Piezas → contenidos (uno por fecha)
  const contenidos = [];
  for (const p of piezas) {
    const c = p.campos;
    const fmt = parsearFormato(c.formato);
    const horaP = parsearHora(c.hora);
    const base = {
      id_pieza: c.id,
      tipo: p.tipo,
      formato: fmt.formato,
      cantidad_piezas: fmt.cantidad || 1,
      ubicacion: (c.ubicacion || '').trim(),
      hora: horaP.hora,
      redes: p.redes || [],
      objetivo: (c.objetivo || '').trim(),
      campania: (c.campania || '').trim(),
      circulacion: (c.circulacion || '').trim(),
      bajada: (c.bajada || '').trim(),
      titulo: (c.titulo || '').trim(),
      descripcion: (c.descripcion || '').trim(),
      link: (c.link || '').trim(),
      notas: [...new Set(p.notas)].join('\n'),
      diapositivas: p.diapositivas,
    };
    const adv = [...p.advertencias];
    if (!horaP.valida) adv.push(`Hora no reconocida: "${c.hora}".`);
    if (!base.hora) adv.push('Falta la hora.');
    if (!base.redes.length) adv.push('Faltan las redes.');
    if (!base.formato) adv.push('Falta el formato.');
    if (p.tipo === 'story' && !/story\s*$/i.test(c.id) && piezas.some(o => o !== p && o.kId === p.kId && o.tipo === 'feed')) {
      adv.push(`La ubicación dice Story pero el Id es igual al del feed ("${c.id}"); ¿debería ser "${c.id} Story"? Se importó como story aparte.`);
    }
    if (p.cantidadesDistintas.size > 1) adv.push(`El formato no coincide entre diapositivas (${[...p.cantidadesDistintas].join(' / ')}); se usó el de la principal.`);

    if (!p.fechas) {
      contenidos.push({ ...base, fecha: '', advertencias: [...adv, 'Falta la fecha.'] });
      continue;
    }
    const { dias, mes } = p.fechas;
    let anio = portada.anio;
    if (portada.mes && mes !== portada.mes) {
      if (portada.mes === 12 && mes === 1) anio += 1;
      else if (portada.mes === 1 && mes === 12) anio -= 1;
    }
    for (const d of dias) {
      const a = [...adv];
      if (portada.mes && mes !== portada.mes) a.push(`La fecha ${pad2(d)}/${pad2(mes)} no es del mes del cronograma.`);
      const fechaISO = anio ? `${anio}-${pad2(mes)}-${pad2(d)}` : '';
      if (fechaISO && !fechaValida(fechaISO)) a.push(`Fecha inválida: ${pad2(d)}/${pad2(mes)}.`);
      contenidos.push({ ...base, fecha: fechaISO, advertencias: a, fechaMultiple: dias.length > 1 ? p.fechaTexto : '' });
    }
  }

  contenidos.sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.hora || '').localeCompare(b.hora || '') || (a.tipo === b.tipo ? 0 : a.tipo === 'feed' ? -1 : 1));

  return {
    marca: portada.marca, mes: portada.mes, anio: portada.anio, origenPortada,
    contenidos, omitidos, advertencias, diapositivas: slides.length,
  };
}

function fechaValida(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function tipoDe(s) {
  return esStory(s.campos.ubicacion, s.campos.id) ? 'story' : 'feed';
}

function nuevaPieza(s, principal) {
  const p = {
    kId: claveId(s.campos.id), tipo: tipoDe(s), kF: s.fechas ? s.fechas.mes + ':' + s.fechas.dias.join(',') : '',
    principal, campos: { ...s.campos }, redes: s.redes, fechas: s.fechas, fechaTexto: s.fechaTexto,
    notas: [...s.notas], diapositivas: [s.num], advertencias: [], cantidadesDistintas: new Set(),
  };
  if (s.campos.formato) p.cantidadesDistintas.add(limpiarId(s.campos.formato));
  return p;
}

// Junta una diapositiva en una pieza. Si `manda` es true, los campos de la
// diapositiva pisan a los de la pieza (caso: llega la principal después).
function fusionar(p, s, manda) {
  for (const [k, v] of Object.entries(s.campos)) {
    if (k === 'id' && !manda) continue;
    if (v && (manda || !p.campos[k])) p.campos[k] = v;
  }
  if (s.redes && (manda || !p.redes)) p.redes = s.redes;
  if (s.fechas && (manda || !p.fechas)) {
    p.fechas = s.fechas; p.fechaTexto = s.fechaTexto;
    p.kF = s.fechas.mes + ':' + s.fechas.dias.join(',');
  }
  if (s.campos.formato) p.cantidadesDistintas.add(limpiarId(s.campos.formato));
  p.notas.push(...s.notas);
  p.diapositivas.push(s.num);
}

// Resumen para mostrar o testear
export function resumir(res) {
  const feed = res.contenidos.filter(c => c.tipo === 'feed').length;
  const stories = res.contenidos.filter(c => c.tipo === 'story').length;
  const conAdv = res.contenidos.filter(c => c.advertencias.length).length;
  return { feed, stories, omitidos: res.omitidos.length, conAdvertencias: conAdv };
}
