const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");

const studentScheduleTable = {
  headers: ["Grupo", "Materia", "Profesores", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"],
  rows: [
    [
      "6CM21",
      "C634 - MODULACIÓN DIGITAL",
      "CLARA CRUZ RAMOS",
      "08:30 - 10:00",
      "08:30 - 10:00",
      "10:00 - 11:30",
      "11:30 - 13:00",
      ""
    ],
    [
      "6CV13",
      "C635 - SISTEMAS OPERATIVOS",
      "RICARDO I. CALZADA SALAS",
      "17:30 - 19:00",
      "16:00 - 17:30",
      "19:00 - 20:30",
      "16:00 - 17:30",
      ""
    ]
  ]
};

test("convierte el horario del alumno en un payload privado y versionado", () => {
  const payload = core.parseStudentScheduleImport([studentScheduleTable]);

  assert.equal(payload.version, 1);
  assert.equal(payload.source, "mi-saes");
  assert.equal(payload.classes.length, 2);
  assert.deepEqual(payload.classes[0], {
    group: "6CM21",
    subjectCode: "C634",
    subject: "MODULACIÓN DIGITAL",
    teacher: "CLARA CRUZ RAMOS",
    days: {
      Lunes: "08:30-10:00",
      Martes: "08:30-10:00",
      Miercoles: "10:00-11:30",
      Jueves: "11:30-13:00",
      Viernes: "X"
    }
  });
});

test("rechaza tablas sin un horario estudiantil utilizable", () => {
  assert.equal(core.parseStudentScheduleImport([]), null);
  assert.equal(core.parseStudentScheduleImport([{ headers: ["Materia"], rows: [["C634"]] }]), null);
});

test("crea una URL UTF-8 en el fragmento sin exponer las materias", () => {
  const payload = core.parseStudentScheduleImport([studentScheduleTable]);
  const url = core.buildMiHorarioImportUrl(payload);

  assert.match(url, /^https:\/\/mihorarioesime\.com\/import#misaes=[A-Za-z0-9_-]+$/);
  assert.equal(url.includes("MODULACIÓN"), false);

  const encoded = new URL(url).hash.slice("#misaes=".length);
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  assert.deepEqual(decoded, payload);
});
