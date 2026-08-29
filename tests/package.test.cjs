const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

test("el paquete distribuible incluye la licencia y excluye archivos de desarrollo", () => {
  execFileSync(process.execPath, ["scripts/package.cjs"], { cwd: root, stdio: "pipe" });
  const archive = path.join(root, "dist", "mi-saes-2.0-0.14.0.zip");
  try {
    const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim()
      .split("\n");

    assert.ok(entries.includes("LICENSE"), "el paquete debe conservar el aviso de licencia MIT");
    assert.ok(entries.includes("THIRD_PARTY_NOTICES.md"));
    assert.ok(entries.every((entry) => !/^(?:\.git|\.github|docs|tests|dist)(?:\/|$)/u.test(entry)));
  } finally {
    require("node:fs").rmSync(archive, { force: true });
    try {
      require("node:fs").rmdirSync(path.dirname(archive));
    } catch {}
  }
});
