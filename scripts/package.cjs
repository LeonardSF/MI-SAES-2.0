const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const outputDirectory = path.join(root, "dist");
const archive = path.join(outputDirectory, `mi-saes-2.0-${manifest.version}.zip`);
const inputs = [
  "manifest.json",
  "tokens.css",
  "src",
  "popup",
  "options",
  "assets",
  "README.md",
  "PRIVACY.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
];

fs.mkdirSync(outputDirectory, { recursive: true });
if (fs.existsSync(archive)) fs.unlinkSync(archive);
execFileSync("zip", ["-q", "-r", archive, ...inputs], { cwd: root });
console.log(path.relative(root, archive));
