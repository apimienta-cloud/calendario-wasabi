// auth.js — Login con contraseña compartida y token guardado en localStorage.
// La contraseña nunca está en el frontend: la valida el Apps Script y devuelve un token.

const KEY = 'wasabi.calendario.token';

export function getToken() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return '';
    const { token, exp } = JSON.parse(raw);
    if (!token || !exp || exp < Date.now()) { clearToken(); return ''; }
    return token;
  } catch {
    return memoria;
  }
}

let memoria = ''; // por si localStorage no está disponible (modo privado, bloqueado)

export function setToken(token, exp) {
  memoria = token;
  try { localStorage.setItem(KEY, JSON.stringify({ token, exp })); } catch { /* queda en memoria */ }
}

export function clearToken() {
  memoria = '';
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
}

/**
 * Muestra la pantalla de login y resuelve cuando el usuario ingresa bien.
 * @param {(password:string)=>Promise<{token:string,exp:number}>} loginFn
 */
export function mostrarLogin(loginFn, mensaje = '') {
  const pantalla = document.getElementById('login');
  const app = document.getElementById('app');
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-pass');
  const btn = document.getElementById('login-btn');
  const error = document.getElementById('login-error');
  app.hidden = true;
  pantalla.hidden = false;
  error.textContent = mensaje;
  input.value = '';
  setTimeout(() => input.focus(), 30);

  return new Promise(resolve => {
    form.onsubmit = async e => {
      e.preventDefault();
      error.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Ingresando…';
      try {
        const { token, exp } = await loginFn(input.value);
        setToken(token, exp);
        pantalla.hidden = true;
        app.hidden = false;
        form.onsubmit = null;
        resolve();
      } catch (err) {
        error.textContent = err.message || 'No se pudo ingresar';
        input.select();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
    };
  });
}
