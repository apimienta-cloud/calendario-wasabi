// api.js — Cliente de la API (Apps Script Web App).
// Todo va por POST con Content-Type text/plain para evitar el preflight de CORS.
// Si config.js todavía no tiene la URL del Web App (o la página se abre con ?demo=1),
// funciona en MODO DEMO: el mismo Code.gs corre en el navegador (ver demo-backend.js).
import { CONFIG } from '../config.js';
import { getToken, clearToken } from './auth.js';

export class AuthError extends Error {}

const sinUrl = !CONFIG.API_URL || CONFIG.API_URL.startsWith('PEGAR');
export const MODO_DEMO = sinUrl || new URLSearchParams(location.search).has('demo');

let onAuthLost = () => {};
export function alPerderSesion(fn) { onAuthLost = fn; }

async function enviar(body) {
  if (MODO_DEMO) {
    const { demoPost } = await import('./demo-backend.js');
    return demoPost(body);
  }
  let res;
  try {
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.');
  }
  try { return await res.json(); } catch { throw new Error(`Respuesta inválida del servidor (HTTP ${res.status}).`); }
}

export async function api(action, payload = {}) {
  const data = await enviar(JSON.stringify({ action, token: action === 'login' ? undefined : getToken(), payload }));
  if (!data.ok) {
    if (data.code === 'AUTH') {
      clearToken();
      onAuthLost(data.error);
      throw new AuthError(data.error);
    }
    throw new Error(data.error || 'Error desconocido');
  }
  return data.data;
}
