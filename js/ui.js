// ui.js — Helpers de interfaz, fechas y constantes compartidas.
import { CONFIG } from '../config.js';

export const TZ = CONFIG.TIMEZONE || 'America/Montevideo';

export const REDES = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin'];
export const RED_INFO = {
  instagram: { nombre: 'Instagram', corto: 'IG' },
  facebook: { nombre: 'Facebook', corto: 'FB' },
  tiktok: { nombre: 'TikTok', corto: 'TT' },
  youtube: { nombre: 'YouTube', corto: 'YT' },
  linkedin: { nombre: 'LinkedIn', corto: 'IN' },
};
export const ESTADOS = ['pendiente', 'programado', 'publicado'];
export const ESTADO_INFO = {
  pendiente: { nombre: 'Pendiente' },
  programado: { nombre: 'Programado' },
  publicado: { nombre: 'Publicado' },
};
export const siguienteEstado = e => ESTADOS[(ESTADOS.indexOf(e || 'pendiente') + 1) % ESTADOS.length];

export const COLORES_MARCA = ['#92C100', '#004612', '#703873', '#C8BFFA', '#82690A', '#FE7A02', '#2E6B8F', '#A8456B', '#3A8F7B', '#D4A72C', '#5C665D', '#B8352B'];

const ICONOS = {
  pendiente: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  programado: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  publicado: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.3 6.3l2.4 2.4 5-5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  atrasada: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.2v4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="6" cy="9.3" r="1" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** h('div.clase#id', {attrs, on:{click}}, ...hijos) */
export function h(sel, attrs, ...kids) {
  const [tag, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'selected' || k === 'checked') { el.setAttribute(k, ''); el[k] = true; }
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** append que ignora null/false (el append nativo los escribe como texto) */
export function add(parent, ...kids) {
  parent.append(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false));
  return parent;
}

export function toast(msg, tipo = '') {
  const t = h('div.toast', msg);
  if (tipo) t.classList.add(tipo);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 5200 : 2800);
}

// Modal genérico. Devuelve { el, body, foot, cerrar }
export function abrirModal({ titulo, ancho = false, onCerrar } = {}) {
  const root = document.getElementById('modal-root');
  const body = h('div.modal-body');
  const foot = h('div.modal-foot');
  const cerrarBtn = h('button.icon-btn', { 'aria-label': 'Cerrar', on: { click: () => cerrar() } }, '×');
  const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, h('div.modal-head', h('h3', titulo), cerrarBtn), body, foot);
  if (ancho) modal.classList.add('ancho');
  const back = h('div.modal-backdrop', modal);
  back.addEventListener('mousedown', e => { if (e.target === back) cerrar(); });
  const onKey = e => { if (e.key === 'Escape' && root.lastElementChild === back) cerrar(); };
  document.addEventListener('keydown', onKey);
  root.append(back);
  let cerrado = false;
  function cerrar(valor) {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', onKey);
    back.remove();
    onCerrar && onCerrar(valor);
  }
  return { el: modal, body, foot, cerrar, setTitulo: t => { modal.querySelector('h3').textContent = t; } };
}

export function confirmar(mensaje, { titulo = 'Confirmar', si = 'Sí', no = 'Cancelar', peligro = false } = {}) {
  return new Promise(resolve => {
    const m = abrirModal({ titulo, onCerrar: v => resolve(v === true) });
    m.body.append(h('p', { style: { margin: 0 } }, mensaje));
    m.foot.append(
      h('button.btn-ghost', { on: { click: () => m.cerrar(false) } }, no),
      h(peligro ? 'button.btn-danger' : 'button.btn-primary', { on: { click: () => m.cerrar(true) } }, si),
    );
  });
}

export function chipRed(red, estado, { atrasada = false, boton = true, grande = false, titulo } = {}) {
  const info = RED_INFO[red];
  const est = estado || 'pendiente';
  const el = h(boton ? 'button.chip-red' : 'span.chip-red', {
    type: boton ? 'button' : undefined,
    title: titulo || `${info.nombre}: ${ESTADO_INFO[est].nombre}${atrasada ? ' · Atrasada' : ''}${boton ? ' — clic para cambiar' : ''}`,
    html: (atrasada ? ICONOS.atrasada : ICONOS[est]) + `<span>${info.corto}</span>`,
  });
  el.classList.add('r-' + red, 's-' + est);
  if (atrasada) el.classList.add('atrasada');
  if (grande) el.classList.add('lg');
  return el;
}

// ---------------------------------------------------------------------------
// Fechas (todo en America/Montevideo, como strings ISO yyyy-mm-dd)
// ---------------------------------------------------------------------------

const fmtAhora = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "yyyy-mm-dd HH:mm" en Montevideo */
export function ahoraMVD() {
  return fmtAhora.format(new Date()).replace('T', ' ');
}
export function hoyMVD() { return ahoraMVD().slice(0, 10); }

const pad = n => String(n).padStart(2, '0');
export function isoDe(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
function partes(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
function utc(iso) { const { y, m, d } = partes(iso); return new Date(Date.UTC(y, m - 1, d)); }
function deUtc(dt) { return isoDe(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }

export function sumarDias(iso, n) { const dt = utc(iso); dt.setUTCDate(dt.getUTCDate() + n); return deUtc(dt); }
export function sumarMeses(iso, n) { const { y, m } = partes(iso); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); return deUtc(dt); }
/** 0 = lunes … 6 = domingo */
export function diaSemana(iso) { return (utc(iso).getUTCDay() + 6) % 7; }
export function inicioSemana(iso) { return sumarDias(iso, -diaSemana(iso)); }
export function inicioMes(iso) { const { y, m } = partes(iso); return isoDe(y, m, 1); }
export function finMes(iso) { return sumarDias(sumarMeses(inicioMes(iso), 1), -1); }

export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fmtMesAnio(iso) { const { y, m } = partes(iso); return `${MESES[m - 1]} ${y}`; }
export function fmtCorta(iso) { if (!iso) return '—'; const { m, d } = partes(iso); return `${pad(d)}/${pad(m)}`; }
export function fmtLarga(iso) {
  if (!iso) return 'Sin fecha';
  const { y, m, d } = partes(iso);
  const dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  return `${dias[diaSemana(iso)]} ${d} de ${MESES[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Estados y atrasos
// ---------------------------------------------------------------------------

export function vencido(c, ahora = ahoraMVD()) {
  if (!c.fecha) return false;
  return `${c.fecha} ${c.hora || '23:59'}` <= ahora;
}

/** Redes de un contenido que ya pasaron de fecha/hora y no están en Publicado */
export function redesAtrasadas(c, ahora) {
  if (!vencido(c, ahora)) return [];
  return (c.redes || []).filter(r => c['estado_' + r] !== 'publicado');
}

// Respuestas "No" a la pregunta de control: se recuerdan en este navegador para no
// volver a preguntar (la red sigue marcada como Atrasada).
const KEY_NO = 'wasabi.calendario.respuestasNo';
function leerNo() { try { return new Set(JSON.parse(localStorage.getItem(KEY_NO) || '[]')); } catch { return new Set(); } }
let respNo = leerNo();
const claveNo = (c, red) => `${c.id}|${red}|${c.fecha} ${c.hora || ''}`;
export function respondioNo(c, red) { return respNo.has(claveNo(c, red)); }
export function marcarNo(c, red) {
  respNo.add(claveNo(c, red));
  try { localStorage.setItem(KEY_NO, JSON.stringify([...respNo].slice(-2000))); } catch { /* sin storage: solo en memoria */ }
}

/** Preguntas pendientes: [{c, red}] */
export function preguntasPendientes(contenidos, ahora = ahoraMVD()) {
  const out = [];
  for (const c of contenidos) for (const red of redesAtrasadas(c, ahora)) if (!respondioNo(c, red)) out.push({ c, red });
  return out;
}

// ---------------------------------------------------------------------------
// Otros
// ---------------------------------------------------------------------------

export function descargarCSV(nombre, filas) {
  const csv = filas.map(f => f.map(v => {
    const s = String(v ?? '');
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function storageGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } }
export function storageSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorar */ } }

export function textoContraste(hex) {
  const n = parseInt(String(hex || '#92C100').slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10201A' : '#FFFFFF';
}

/** Color de marca oscurecido si es muy claro, para usarlo como texto sobre blanco */
export function colorTexto(hex) {
  const n = parseInt(String(hex || '#5C665D').slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 140) { const f = 140 / lum; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
  return `rgb(${r},${g},${b})`;
}
