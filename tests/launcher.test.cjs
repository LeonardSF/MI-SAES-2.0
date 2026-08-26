const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "src/content/content.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/content/content.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("el acceso flotante presenta MI SAES 2.0 como una invitacion accionable", () => {
  assert.match(script, /ms-launcher__icon[^>]*src="\$\{chrome\.runtime\.getURL\("assets\/icon-misaes-calendar-candidate\.png"\)\}"/);
  assert.doesNotMatch(script, /<span>MI<\/span>/);
  assert.match(script, /ms-launcher__title[^>]*>MI SAES 2\.0</);
  assert.match(script, /ms-launcher__message[^>]*>Arma tu horario sin empalmes</);
  assert.doesNotMatch(script, /ms-launcher__action|Probar ahora/);
  assert.match(styles, /\.ms-launcher\s*\{[^}]*inset-inline-end:/s);
  assert.match(styles, /\.ms-launcher\s*\{[^}]*width:\s*fit-content;/s);
  assert.match(styles, /\.ms-launcher\s*\{[^}]*max-width:\s*calc\(100vw - 2 \* var\(--space-md\)\)/s);
  assert.doesNotMatch(styles, /\.ms-launcher\s*\{[^}]*inset-inline-start:/s);
  assert.match(styles, /background:\s*color-mix\(in oklch, var\(--color-surface-raised\) 75%, transparent\)/);
  assert.ok(
    manifest.web_accessible_resources.some(({ resources }) => resources.includes("assets/icon-misaes-calendar-candidate.png")),
    "el icono del launcher debe ser accesible desde las paginas de SAES"
  );
});

test("la cabecera identifica MI SAES con el mismo icono del acceso flotante", () => {
  assert.match(
    script,
    /ms-brand__icon[^>]*src="\$\{chrome\.runtime\.getURL\("assets\/icon-misaes-calendar-candidate\.png"\)\}"/
  );
  assert.match(styles, /\.ms-brand__icon\s*\{[^}]*width:\s*2rem;[^}]*height:\s*2rem;/s);
});

test("muestra las novedades instaladas en un banner descartable", () => {
  assert.match(script, /class="ms-release-banner"[^>]*hidden/);
  assert.match(script, /data-action="dismiss-release"[^>]*>Entendido</);
  assert.match(script, /releaseNotice[^\n]*releaseNotes/);
  assert.match(styles, /\.ms-release-banner\s*\{[^}]*display:\s*grid;/s);
});

test("mantiene sincronizada la versión 0.12.3 en las superficies publicadas", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const options = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  assert.equal(manifest.version, "0.12.3");
  assert.equal(packageJson.version, "0.12.3");
  assert.match(options, /versión 0\.12\.3/);
});

test("el acceso flotante conserva una version compacta para ventanas estrechas", () => {
  assert.match(styles, /@media\s*\(max-width:\s*30rem\)[\s\S]*inset-inline-end:/);
  assert.doesNotMatch(styles, /@media\s*\(max-width:\s*30rem\)[\s\S]*\.ms-launcher__message\s*\{[^}]*display:\s*none/);
});

test("el modal retira el promocional del tabulador y devuelve el foco al cerrar", () => {
  assert.match(script, /previousFocus\s*=\s*shadow\.activeElement\s*\|\|\s*document\.activeElement/);
  assert.match(script, /launcher\.tabIndex\s*=\s*isOpen\s*\?\s*-1\s*:\s*0/);
});

test("MI SAES ocupa el viewport con una superficie ligeramente transparente", () => {
  assert.match(styles, /\.ms-panel\s*\{[^}]*inset:\s*0;[^}]*width:\s*100%;/s);
  assert.match(styles, /\.ms-panel\s*\{[^}]*background:\s*color-mix\([^;]*transparent\);/s);
  assert.match(styles, /\.ms-panel\s*\{[^}]*backdrop-filter:\s*blur\(/s);
  assert.doesNotMatch(styles, /\.ms-panel\s*\{[^}]*border-inline-start:/s);
});

test("permite alternar claramente entre SAES y MI SAES", () => {
  assert.match(script, /class="ms-surface-switch"[^>]*aria-label="Cambiar entre SAES y MI SAES"/);
  assert.match(script, /data-action="show-saes"[^>]*>SAES</);
  assert.match(script, /data-action="show-misaes"[^>]*aria-pressed="true"[^>]*>MI SAES</);
  assert.match(script, /\[data-action="show-saes"\][\s\S]*addEventListener\("click",\s*\(\)\s*=>\s*setOpen\(false\)\)/);
});

test("usa navegación superior compacta sin fijarla al desplazamiento", () => {
  assert.match(styles, /\.ms-view-nav\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*2\.75rem/s);
  assert.doesNotMatch(styles, /\.ms-view-nav\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(styles, /\.ms-panel__body\s*>\s*\.ms-view\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(styles, /\.ms-view-nav\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.ms-panel__header\s*\{[^}]*min-height:\s*3\.75rem/s);
});

test("presenta horarios generados sin acciones de propuesta", () => {
  assert.doesNotMatch(script, /Generar propuestas|Guardar para reinscripción|Guarda esta propuesta|Propuesta \$\{/);
  assert.match(script, /Generar horarios/);
});

test("la navegación principal no reserva espacio dentro de Mi trayectoria en Inicio", () => {
  assert.doesNotMatch(styles, /@media\s*\(min-width:\s*56rem\)[\s\S]*\n\s{2}\.ms-view\s*\{[^}]*grid-template-columns:/);
  assert.match(script, /homeView\.className\s*=\s*"ms-view ms-trajectory-home__view"/);
});
