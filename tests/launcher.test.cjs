const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "src/content/content.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/content/content.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("mantiene el tamaño de MI SAES cuando el portal usa una raíz de 10px", {
  skip: !fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
}, () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "misaes-chrome-"));
  try {
    const tokens = fs.readFileSync(path.join(root, "tokens.css"), "utf8");
    const contentStyles = fs.readFileSync(path.join(root, "src/content/content.css"), "utf8")
      .replace('@import url("../../tokens.css");', "");
    const fixture = fs.readFileSync(path.join(root, "tests/fixtures/root-font-preview.html"), "utf8")
      .replace("__MI_SAES_STYLES__", JSON.stringify(`${tokens}\n${contentStyles}`));
    const fixturePath = path.join(profile, "root-font-preview.html");
    fs.writeFileSync(fixturePath, fixture);
    const chrome = spawnSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      new URL(`file://${fixturePath}`).href
    ], { encoding: "utf8", timeout: 2000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "ignore"] });
    const output = chrome.stdout || "";
    const match = output.match(/<output id="result">([^<]+)<\/output>/);
    assert.ok(match, "la vista de prueba debe entregar sus medidas computadas");
    const result = JSON.parse(match[1].replaceAll("&quot;", '"'));
    assert.equal(result.rootFontSize, "10px", "MI SAES no debe cambiar el tamaño del portal");
    assert.ok(result.launcherHeight >= 60, `el acceso flotante midió ${result.launcherHeight}px`);
    assert.ok(result.iconWidth >= 44, `el icono midió ${result.iconWidth}px`);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("el acceso flotante presenta MI SAES 2.0 como una invitacion accionable", () => {
  assert.match(script, /ms-launcher__icon[^>]*src="\$\{chrome\.runtime\.getURL\("assets\/icon-misaes-calendar-candidate\.png"\)\}"/);
  assert.doesNotMatch(script, /<span>MI<\/span>/);
  assert.match(script, /const launcherCopy = core\.launcherModel\(\{ authenticated: hasAuthenticatedSession \}\)/);
  assert.match(script, /ms-launcher__title[^>]*>\$\{launcherCopy\.title\}</);
  assert.match(script, /ms-launcher__message[^>]*>\$\{launcherCopy\.message\}</);
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
  assert.match(styles, /\.ms-brand__icon\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s);
});

test("muestra las novedades instaladas en un banner descartable", () => {
  assert.match(script, /class="ms-release-banner"[^>]*hidden/);
  assert.match(script, /data-action="dismiss-release"[^>]*>Entendido</);
  assert.match(script, /releaseNotice[^\n]*releaseNotes/);
  assert.match(styles, /\.ms-release-banner\s*\{[^}]*display:\s*grid;/s);
});

test("mantiene sincronizada la versión 0.13.0 en las superficies publicadas", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const options = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  assert.equal(manifest.version, "0.13.0");
  assert.equal(packageJson.version, "0.13.0");
  assert.match(options, /versión 0\.13\.0/);
});

test("el acceso flotante conserva una version compacta para ventanas estrechas", () => {
  assert.match(styles, /@media\s*\(max-width:\s*480px\)[\s\S]*inset-inline-end:/);
  assert.doesNotMatch(styles, /@media\s*\(max-width:\s*480px\)[\s\S]*\.ms-launcher__message\s*\{[^}]*display:\s*none/);
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

test("enlaza el repositorio de GitHub antes del selector de superficie", () => {
  assert.match(script, /class="ms-panel__actions"[\s\S]*class="ms-github-link"[\s\S]*class="ms-surface-switch"/);
  assert.match(script, /class="ms-github-link"[^>]*href="https:\/\/github\.com\/LeonardSF\/MI-SAES-2\.0"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="Abrir repositorio de MI SAES en GitHub"/);
  assert.match(script, /ms-github-link[\s\S]*<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  assert.match(styles, /\.ms-panel__actions\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.ms-github-link\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
});

test("usa navegación superior compacta sin fijarla al desplazamiento", () => {
  assert.match(styles, /\.ms-view-nav\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*44px/s);
  assert.doesNotMatch(styles, /\.ms-view-nav\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(styles, /\.ms-panel__body\s*>\s*\.ms-view\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(styles, /\.ms-view-nav\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.ms-panel__header\s*\{[^}]*min-height:\s*60px/s);
});

test("presenta horarios generados sin acciones de propuesta", () => {
  assert.doesNotMatch(script, /Generar propuestas|Guardar para reinscripción|Guarda esta propuesta|Propuesta \$\{/);
  assert.match(script, /Generar horarios/);
});

test("la navegación principal no reserva espacio dentro de Mi trayectoria en Inicio", () => {
  assert.doesNotMatch(styles, /@media\s*\(min-width:\s*896px\)[\s\S]*\n\s{2}\.ms-view\s*\{[^}]*grid-template-columns:/);
  assert.match(script, /homeView\.className\s*=\s*"ms-view ms-trajectory-home__view"/);
});
