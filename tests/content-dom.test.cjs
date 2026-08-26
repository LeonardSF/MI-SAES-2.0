const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("en tablas WebForms anidadas enlaza únicamente la columna Profesor", {
  skip: !fs.existsSync(chromePath)
}, async (t) => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      response.writeHead(404).end();
      return;
    }
    response.end(fs.readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const { stdout } = await execFileAsync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--disable-background-networking",
    "--dump-dom",
    `http://127.0.0.1:${port}/tests/fixtures/saes-schedule.html?misaes-preview=1`
  ], { timeout: 5000, maxBuffer: 5 * 1024 * 1024 });

  assert.doesNotMatch(stdout, /data-group="6CM21"[^>]*>\s*<a/i);
  assert.match(stdout, /data-teacher="PERSONA DOCENTE UNO"[^>]*>\s*<a[^>]+data-misaes-teacher-link="true"/i);
});

test("carga la configuración de Carrera y Plan antes de escanear", {
  skip: !fs.existsSync(chromePath)
}, async (t) => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      response.writeHead(404).end();
      return;
    }
    response.end(fs.readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const { stdout } = await execFileAsync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--disable-background-networking",
    "--dump-dom",
    `http://127.0.0.1:${port}/tests/fixtures/scanner-configuration.html`
  ], { timeout: 5000, maxBuffer: 5 * 1024 * 1024 });

  assert.match(stdout, /<output id="result">\{"careers":\[\{"value":"ISC","label":"INGENIERÍA EN COMPUTACIÓN"\}\],"plans":\[\{"value":"04","label":"Plan 2004"\}\]/);
});
