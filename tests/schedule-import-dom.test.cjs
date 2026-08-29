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

test("coloca una importación accesible junto al regreso del horario", {
  skip: !fs.existsSync(chromePath)
}, async (t) => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) return response.writeHead(404).end();
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
    "--virtual-time-budget=1500",
    "--dump-dom",
    `http://127.0.0.1:${port}/tests/fixtures/saes-student-schedule.html?misaes-preview=1`
  ], { timeout: 5000, maxBuffer: 3 * 1024 * 1024 });

  const links = stdout.match(/<a[^>]+data-misaes-import-schedule="true"[^>]*>/g) || [];
  assert.equal(links.length, 1);
  assert.match(links[0], /href="https:\/\/mihorarioesime\.com\/import#misaes=[A-Za-z0-9_-]+"/);
  assert.match(links[0], /target="_blank"/);
  assert.match(links[0], /rel="noopener noreferrer"/);
  assert.match(stdout, /data-misaes-import-schedule="true"[^>]*>Abrir en Mi Horario<\/a>/);
  assert.match(stdout, /Regresar<\/font><\/a><a[^>]+data-misaes-import-schedule="true"/);

  const styleMatch = stdout.match(/<output id="import-style-result">([^<]+)<\/output>/);
  assert.ok(styleMatch, "la fixture debe publicar los estilos computados de ambos botones");
  const styles = JSON.parse(styleMatch[1].replaceAll("&quot;", '"'));
  assert.deepEqual(styles.imported.height, styles.back.height);
  assert.deepEqual(styles.imported.paddingBlock, styles.back.paddingBlock);
  assert.deepEqual(styles.imported.fontSize, styles.back.fontSize);
  assert.deepEqual(styles.imported.lineHeight, styles.back.lineHeight);
  assert.equal(styles.imported.backgroundColor, "rgb(59, 130, 246)");
});
