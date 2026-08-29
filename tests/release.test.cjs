const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("documenta el salto de v0.13.0 a v0.14.0 para publicar la release", () => {
  const notes = read("docs/releases/v0.14.0.md");

  assert.match(notes, /^# MI SAES 2\.0 v0\.14\.0$/m);
  assert.match(notes, /^## Comparativa con v0\.13\.0$/m);
  assert.match(notes, /^## Notas para GitHub Release$/m);
  assert.match(notes, /^## Texto para Chrome Web Store$/m);
  assert.match(notes, /^## Checklist de publicación$/m);
  assert.match(notes, /Mapa curricular/);
  assert.match(notes, /Mi trayectoria/);
  assert.match(notes, /Mi Horario/);
  assert.doesNotMatch(notes, /ocho periodos/i);
  assert.match(notes, /no se ha creado el commit final de release, el tag ni ninguna publicación/);
});

test("sincroniza el README con la versión candidata", () => {
  const readme = read("README.md");

  assert.match(readme, /alt="Versión 0\.14\.0"/);
  assert.match(readme, /badge\/versión-0\.14\.0-/);
  assert.match(readme, /\*\*Mapa curricular\*\*/);
  assert.match(readme, /\*\*Mi Horario\*\*/);
  assert.doesNotMatch(readme, /ocho periodos/i);
});
