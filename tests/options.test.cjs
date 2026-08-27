const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
const script = fs.readFileSync(path.join(root, "options/options.js"), "utf8");

test("la pagina de opciones ofrece rutas verificables para conocer y apoyar el proyecto", () => {
  assert.match(html, /href="https:\/\/github\.com\/LeonardSF\/MI-SAES-2\.0"/);
  assert.match(html, /href="https:\/\/github\.com\/LeonardSF\/MI-SAES-2\.0\/issues"/);
  assert.match(html, /href="https:\/\/github\.com\/LeonardSF\/MI-SAES-2\.0\/releases"/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/Le0nardSF"/);
});

test("todos los enlaces que abren otra pestaña aislan la pagina de origen", () => {
  const externalLinks = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];
  assert.ok(externalLinks.length > 0);
  externalLinks.forEach((link) => assert.match(link, /rel="noopener noreferrer"/));
});

test("muestra la version realmente instalada en vez de mantenerla escrita a mano", async () => {
  const versionNode = { textContent: "" };
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === "installed-version") return versionNode;
      if (id === "save-status") return { dataset: {}, textContent: "" };
      return null;
    },
    querySelectorAll() { return []; },
  };
  const chrome = {
    runtime: { getManifest: () => ({ version: "9.8.7" }) },
    storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } },
  };
  const context = {
    chrome,
    document,
    MISaesCore: { mergeSettings: (settings) => ({ modules: {}, ...settings }) },
    globalThis: null,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;

  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(versionNode.textContent, "9.8.7");
});

test("mantiene oculto el aviso de guardado mientras no existe una operacion", async () => {
  const statusNode = { dataset: {}, hidden: false, textContent: "Preferencias cargadas." };
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) { return id === "save-status" ? statusNode : null; },
    querySelectorAll() { return []; },
  };
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.13.0" }) },
    storage: { local: { get: async () => ({ settings: {} }), set: async () => {} } },
  };
  const context = {
    chrome,
    document,
    MISaesCore: { mergeSettings: (settings) => ({ modules: {}, ...settings }) },
    globalThis: null,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;

  vm.runInNewContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(statusNode.hidden, true);
});
