# Calendario de Contenidos · Wasabi

Web interna para ver, cargar, editar y controlar las publicaciones y stories programadas de cada marca, con estado por red (Pendiente → Programado → Publicado) e importador de cronogramas `.pptx`.

- **Frontend:** HTML + CSS + JavaScript (módulos ES), sin build. Se publica en Netlify o GitHub Pages.
- **Backend:** una Google Sheet con un Google Apps Script publicado como Web App (`apps-script/Code.gs`).
- **Acceso:** una sola contraseña para todo el equipo, guardada en el Apps Script (nunca en el frontend).
- **Zona horaria:** America/Montevideo en todo.

```
index.html
config.js                 ← URL del Web App (lo único que hay que tocar al publicar)
css/app.css
js/  main.js · api.js · auth.js · calendar.js · editor.js · importer.js · pptx-parser.js · ui.js
assets/                   ← logos, favicon e Inter 400/600/700/800
apps-script/Code.gs       ← backend completo + setup()
apps-script/appsscript.json
tools/test-parser/        ← prueba del parser con los .pptx reales (y resultado.md)
tools/mock-server/        ← servidor local que ejecuta Code.gs con una planilla simulada
```

---

## Probarlo ya (modo demo)

Mientras `config.js` no tenga la URL del Web App, la web funciona en **modo demo**: ejecuta el mismo `Code.gs` dentro del navegador y guarda los datos solo en ese navegador (nadie más los ve, y se pierden si borrás los datos del sitio). Contraseña: `demo`. Sirve para probar todo, incluido el importador de cronogramas. Cuando pegues la URL real, el modo demo se apaga solo (se puede forzar con `?demo=1`).

## Puesta en marcha

### 1. Crear la Google Sheet

1. En Google Drive: **Nuevo → Hojas de cálculo de Google**. Ponele un nombre, por ejemplo `Calendario de Contenidos Wasabi`.
2. Usá una cuenta de la agencia (no una personal): el script va a correr con esa cuenta.

### 2. Pegar el script

1. Dentro de la planilla: **Extensiones → Apps Script**.
2. Borrá el contenido de `Código.gs` y pegá todo el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. (Opcional, recomendado) En **Configuración del proyecto** (ícono de engranaje), tildá *Mostrar el archivo de manifiesto "appsscript.json"*. Después abrí `appsscript.json` en el editor y reemplazalo por el de [`apps-script/appsscript.json`](apps-script/appsscript.json). Así la zona horaria queda en America/Montevideo.
4. Guardá (💾).

### 3. Correr `setup()`

1. En el editor, arriba, elegí la función **`setup`** y tocá **Ejecutar**.
2. La primera vez Google pide permisos: **Revisar permisos → elegí la cuenta → Configuración avanzada → Ir a (nombre del proyecto) → Permitir**.
3. `setup()` crea las pestañas `Equipos`, `Marcas` y `Contenidos` con sus encabezados (solo si no existen), carga los equipos CHILI, TABASCO, PUTAPARIÓ y PEPPERS, pone la planilla en formato texto para que no convierta fechas ni horas y genera solo el `TOKEN_SECRET` (el secreto que firma las sesiones; nadie lo tiene que saber).

> Se puede volver a correr sin problema: no borra ni duplica nada.

### 4. Definir la contraseña

1. Volvé a la planilla y recargala: aparece el menú **Calendario**.
2. **Calendario → Definir contraseña** y escribí la que va a usar el equipo (8 caracteres o más).

Queda guardada en las Propiedades del script como `APP_PASSWORD` (también se puede cargar a mano en **Configuración del proyecto → Propiedades del script**).

### 5. Publicar como Web App

1. **Implementar → Nueva implementación**.
2. En *Tipo*, elegí **Aplicación web**.
3. **Ejecutar como:** *Yo* (la cuenta de la agencia).
4. **Quién tiene acceso:** *Cualquier persona*.
   Esto es necesario para que la web pueda llamarlo. Igual nadie puede leer ni escribir sin la contraseña: todas las acciones piden un token válido.
5. **Implementar** y copiá la **URL de la aplicación web** (termina en `/exec`).

### 6. Pegar la URL en `config.js`

```js
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  TIMEZONE: 'America/Montevideo',
};
```

### 7. Subir a Netlify

**Opción rápida (arrastrar):**
1. Entrá a [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. Arrastrá la carpeta del proyecto. No hace falta build: es un sitio estático.

**Opción con GitHub (recomendada si el equipo va a hacer cambios):**
1. Subí la carpeta a un repositorio.
2. En Netlify: **Add new site → Import an existing project → GitHub**. Build command: vacío. Publish directory: `/` (la raíz).

Las carpetas `tools/` y `apps-script/` no molestan si se publican, pero si querés podés excluirlas. `index.html` ya tiene `noindex` para que no aparezca en buscadores.

### 8. Cambiar la contraseña más adelante

1. En la planilla: **Calendario → Definir contraseña** (o en Apps Script → **Configuración del proyecto → Propiedades del script** → editá `APP_PASSWORD`).
2. Listo: no hace falta volver a implementar. **Todas las sesiones abiertas se cierran solas** (el token incluye la contraseña en su firma), y cada persona tiene que entrar con la nueva.

> Si cambiás el código de `Code.gs`, tenés que publicar una versión nueva: **Implementar → Administrar implementaciones → ✎ → Versión: Nueva versión → Implementar**. La URL no cambia.

---

## Cómo se usa

- **Barra lateral:** los 4 equipos con sus marcas. Clic en un equipo = todas sus marcas; clic en una marca = solo esa. El **+** agrega una marca en ese equipo; el ✎ la edita o la archiva. Archivar la oculta sin borrar su historial (se ve con *Mostrar archivadas*).
- **Vistas:** Mes (por defecto), Semana y Lista (ordenable por columna y exportable a CSV). En el celular arranca en Lista. En cada día, el feed y las stories van en filas separadas.
- **Estados:** clic en el chip de una red (IG, FB, TT, YT, IN) para pasar de Pendiente → Programado → Publicado. Publicado se ve tachado y atenuado. Instagram y Facebook van por separado aunque el cronograma diga "Meta".
- **Pregunta de control:** cuando pasan la fecha y la hora de un contenido y alguna red no está en Publicado, aparece **"¿Se publicó en [red]?"**: arriba del calendario ("Tenés N publicaciones sin confirmar" → *Revisar*) y en la tarjeta. *Sí* la pasa a Publicado; *No* la deja como estaba, marcada en naranja como **Atrasada**, y no vuelve a preguntar en ese navegador. Si un contenido no tiene hora, se considera atrasado desde las 23:59 de su día.
- **Detalle:** clic en una tarjeta → panel con todos los campos editables, Guardar, Duplicar y Eliminar.
- **Mover:** arrastrá una tarjeta a otro día para cambiarle la fecha (en computadora).
- **+ Contenido:** carga manual. Doble clic en una celda vacía crea uno en ese día.

### Importar un cronograma

1. Elegí la marca en la barra lateral → **Importar cronograma** → arrastrá o elegí el `.pptx`.
2. El archivo **no se sube a ningún lado**: se lee en el navegador con zip.js y solo se toma el texto de `ppt/slides/slideN.xml`. Un cronograma de 800 MB se lee en un par de segundos.
3. **Vista previa editable:** podés corregir celdas, destildar filas y ver advertencias y omitidos.
4. **Comparar y seguir:** si el mes ya estaba cargado, se muestran *Nuevos*, *Modificados* (campo por campo) y *Ya no están en el cronograma*.
   - Los **estados por red nunca se tocan** al reimportar.
   - Si un contenido se editó a mano en la web, se pregunta si *conservar la edición manual* o *pisar con el cronograma*.
   - Lo que ya no está no se borra solo: hay que tildarlo.
5. **Confirmar importación** escribe todo de una vez en la planilla.

### Cómo interpreta el cronograma

Relevado de los cronogramas reales de Grido y Tiendas Montevideo:

- **Portada:** marca, mes y año salen de la diapositiva 1 (`Contenidos | Grido | Noviembre 2026`). Si falta, se toman del nombre del archivo (`Cronograma-Grido-Noviembre-2026.pptx`).
- **Diapositiva 3** (calendario resumen) y las vacías se ignoran.
- **Campos por rótulo, no por posición:** Hora, Objetivo, Campaña, Circulación, Bajada (todas las líneas hasta `Título:`), Título, Descripción, Link (puede ocupar varias líneas), Formato (`Carrusel (3)` = Carrusel de 3), Ubicación e Id.
  - La fecha es la línea `Lunes 02/11`.
  - Las redes son la línea `Meta, TikTok, YouTube` (Meta = Instagram + Facebook).
  - `Objetivo: Alcance | Tráfico` queda como `Alcance, Tráfico`.
- **Story:** si la ubicación dice Story/Stories o el Id termina en "Story".
- **Carruseles en varias diapositivas:** se agrupan con la principal y se crea un solo contenido.
  - Si una continuación trae un Id equivocado pero sigue a la principal con la misma fecha, se agrupa igual y se avisa. Pasa, por ejemplo, en la diapositiva 29 de Grido, que dice "Bombón Story" en lugar de "Combinaciones Story".
- **Fechas múltiples** (`Lun, Mié, Vie, 02,04,06, 09,11 y 13/11`): un contenido por fecha. Los nombres de los días se ignoran.
- **Omitidos (no se importan):**
  - todo lo marcado como `Anuncio…` (con o sin número, por ejemplo `Anuncio 0 Octubre`);
  - los `Banner WEB`;
  - las piezas con `Ubicación: Catálogo`.
- **Notas:** cualquier línea que no encaja en un rótulo (por ejemplo `Corregir esto`, o `Está muy alto el volumen, a -3`) va a `notas`.
- **Clave al reimportar:** marca + año + mes + Id + fecha + **tipo**.
  - El tipo se suma porque en los cronogramas a veces el feed y la story comparten Id y fecha (por ejemplo `Promo Baño` en Tiendas Montevideo).
  - Si de una pieza queda exactamente una sin pareja de cada lado, se toma como la misma con la fecha cambiada (por ejemplo, porque alguien la movió en el calendario). Así no se duplica.

---

## Probar sin publicar nada

Necesitás [Node.js](https://nodejs.org) 20 o superior.

**Prueba del parser** con los dos cronogramas de noviembre (lee solo el texto, no los videos):

```powershell
node tools/test-parser/test-parser.mjs
```

Escribe el resumen en `tools/test-parser/resultado.md` (no se sube al repo porque incluye los copys de los clientes). También acepta otros archivos:

```powershell
node tools/test-parser/test-parser.mjs "C:\ruta\Cronograma-Marca-Mes-Año.pptx"
```

**Web completa en local** (ejecuta el `Code.gs` real con una planilla simulada en `tools/mock-server/data.json`):

```powershell
node tools/mock-server/server.mjs
```

Abrí http://localhost:8787. La contraseña de prueba es `wasabi-demo`; se puede cambiar con la variable `APP_PASSWORD`. Para borrar los datos de prueba, borrá `tools/mock-server/data.json`.

Prueba automática del backend (con el servidor local corriendo):

```powershell
node tools/mock-server/api-smoke.mjs
```

---

## Datos en la planilla

| Pestaña | Columnas |
|---|---|
| `Equipos` | id, nombre, orden |
| `Marcas` | id, equipo_id, nombre, color, redes_activas, activa, creado, actualizado |
| `Contenidos` | id, marca_id, anio, mes, id_pieza, tipo, formato, cantidad_piezas, ubicacion, fecha, hora, redes, objetivo, campania, circulacion, bajada, titulo, descripcion, link, notas, estado_instagram, estado_facebook, estado_tiktok, estado_youtube, estado_linkedin, origen, editado_manual, creado, actualizado |

Se puede mirar la planilla, pero conviene no editarla a mano mientras alguien usa la web. Las escrituras usan `LockService` para que dos personas guardando a la vez no se pisen.
