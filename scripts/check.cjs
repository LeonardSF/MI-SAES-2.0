const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "manifest.json",
  "tokens.css",
  "src/background.js",
  "src/shared/core.js",
  "src/content/scanner.js",
  "src/content/occupancy.js",
  "src/content/trajectory.js",
  "src/content/trajectory-view.js",
  "src/content/student-home.js",
  "src/content/content.js",
  "src/content/content.css",
  "src/content/student-home.css",
  "src/content/trajectory-home.css",
  "src/content/page.css",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "options/options.html",
  "options/options.js",
  "options/options.css",
  "assets/icon.svg",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-48.png",
  "assets/icon-128.png",
  "assets/icon-misaes-calendar-candidate.png",
  "assets/fonts/ibm-plex-sans-regular.woff2",
  "assets/fonts/ibm-plex-sans-bold.woff2",
  "assets/fonts/ibm-plex-mono-semibold.woff2",
  "PRIVACY.md",
  "README.md"
];

const publicRepositoryFiles = [
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md"
];

const missing = [...required, ...publicRepositoryFiles].filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`Faltan archivos: ${missing.join(", ")}`);

const testsRoot = path.join(root, "tests");
const testFiles = fs.readdirSync(testsRoot, { recursive: true })
  .filter((file) => /\.(?:cjs|html|js)$/u.test(file));
const testSource = testFiles
  .map((file) => fs.readFileSync(path.join(testsRoot, file), "utf8"))
  .join("\n");
const scheduleFixture = fs.readFileSync(path.join(testsRoot, "fixtures", "saes-schedule.html"), "utf8");
const fixtureTeachers = [...scheduleFixture.matchAll(
  /<tr><td>[^<]+<\/td><td>[^<]+<\/td><td>([^<]+)<\/td>/gu
)].map((match) => match[1]);
if (!fixtureTeachers.length || fixtureTeachers.some((teacher) => !/^PERSONA DOCENTE [A-Z]+$/u.test(teacher))) {
  throw new Error("Los nombres de docentes en fixtures deben ser claramente ficticios");
}
const studentNumbers = testSource.match(/\b20\d{8}\b/gu) || [];
if (studentNumbers.some((studentNumber) => studentNumber !== "2026000000")) {
  throw new Error("Las pruebas sólo pueden usar la boleta sintética 2026000000");
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("El manifiesto debe ser V3");
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage"])) {
  throw new Error("Los permisos deben limitarse a storage");
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(["*://*.ipn.mx/*"])) {
  throw new Error("El acceso de red debe limitarse a los subdominios del IPN");
}

const javascriptFiles = required.filter((file) => file.endsWith(".js"));
javascriptFiles.forEach((file) => {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\beval\s*\(|new\s+Function\s*\(|XMLHttpRequest|WebSocket\s*\(|fetch\s*\(\s*["']https?:/u.test(source)) {
    throw new Error(`Código remoto o dinámico detectado en ${file}`);
  }
});

for (const htmlFile of ["popup/popup.html", "options/options.html"]) {
  const html = fs.readFileSync(path.join(root, htmlFile), "utf8");
  if (/<script(?![^>]*\bsrc=)/iu.test(html)) throw new Error(`Script inline detectado en ${htmlFile}`);
}

console.log(
  `MI SAES ${manifest.version}: manifiesto, permisos, CSP y ${required.length + publicRepositoryFiles.length} archivos verificados.`
);
