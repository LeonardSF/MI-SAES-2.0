const test = require("node:test");
const assert = require("node:assert/strict");
const trajectory = require("../src/content/trajectory.js");

function documentWithTables(tables, text = "") {
  return {
    body: { textContent: text },
    querySelectorAll(selector) {
      return selector === "table" ? tables : [];
    }
  };
}

function table(rows) {
  return {
    rows: rows.map((cells) => ({
      cells: cells.map(({ text, tag = "TD" }) => ({ textContent: text, tagName: tag }))
    }))
  };
}

test("interpreta las métricas oficiales de la cita de reinscripción", () => {
  const document = documentWithTables([
    table([
      [
        { text: "Promedio", tag: "TH" },
        { text: "Materias Reprobadas", tag: "TH" }
      ],
      [{ text: "8.42" }, { text: "2" }]
    ]),
    table([
      [
        { text: "Total de creditos que has obtenido", tag: "TH" },
        { text: "Total de creditos que te faltan obtener", tag: "TH" },
        { text: "Periodos escolares que cursaste", tag: "TH" },
        { text: "Periodos escolares disponibles para completar tu carrera", tag: "TH" }
      ],
      [{ text: "250.5" }, { text: "180.5" }, { text: "6" }, { text: "5" }]
    ])
  ]);

  assert.deepEqual(trajectory.parseReenrollment(document), {
    average: 8.42,
    failedSubjects: 2,
    earnedCredits: 250.5,
    remainingCredits: 180.5,
    periodsCompleted: 6,
    periodsAvailable: 5,
    minimumLoad: null,
    mediumLoad: null,
    maximumLoad: null,
    authorizedLoad: null
  });
});

test("resume el Kárdex sin inventar estados académicos", () => {
  const document = documentWithTables([
    table([
      [{ text: "TERCER SEMESTRE" }],
      [
        { text: "Clave" },
        { text: "Materia" },
        { text: "Periodo" },
        { text: "Forma" },
        { text: "Fecha" },
        { text: "Calificacion" }
      ],
      [
        { text: "C301" },
        { text: "CÁLCULO" },
        { text: "2025/2" },
        { text: "ORD" },
        { text: "2025-06-10" },
        { text: "8" }
      ],
      [
        { text: "F302" },
        { text: "FÍSICA" },
        { text: "2025/2" },
        { text: "ETS" },
        { text: "2025-07-01" },
        { text: "5" }
      ],
      [
        { text: "P303" },
        { text: "PROGRAMACIÓN" },
        { text: "2025/2" },
        { text: "ORD" },
        { text: "" },
        { text: "" }
      ]
    ])
  ]);

  assert.deepEqual(trajectory.parseKardex(document), {
    records: 3,
    gradesFromSix: 1,
    gradesBelowSix: 1,
    withoutNumericGrade: 1
  });
});

test("el Kárdex no mezcla filas de otras tablas con el mismo número de columnas", () => {
  const document = documentWithTables([
    table([
      [{ text: "Materia" }, { text: "Periodo" }, { text: "Forma" }, { text: "Fecha" }, { text: "Grupo" }, { text: "Calificacion" }],
      [{ text: "CÁLCULO" }, { text: "2025/2" }, { text: "ORD" }, { text: "2025-06-10" }, { text: "3CV1" }, { text: "8" }]
    ]),
    table([
      [{ text: "Enlace" }, { text: "Sección" }, { text: "Ayuda" }, { text: "Estado" }, { text: "Orden" }, { text: "Valor" }]
    ])
  ]);

  assert.equal(trajectory.parseKardex(document).records, 1);
});

test("cuenta las materias que Estado General reporta sin reinterpretar su descripción", () => {
  const document = documentWithTables([
    table([
      [
        { text: "No_Periodo", tag: "TH" },
        { text: "Materia", tag: "TH" },
        { text: "Descripcion", tag: "TH" },
        { text: "Periodo_escolar", tag: "TH" },
        { text: "Veces", tag: "TH" }
      ],
      [{ text: "3" }, { text: "C301" }, { text: "CÁLCULO" }, { text: "" }, { text: "1" }],
      [{ text: "4" }, { text: "F401" }, { text: "FÍSICA" }, { text: "" }, { text: "2" }]
    ])
  ]);

  assert.deepEqual(trajectory.parseGeneralStatus(document), {
    records: 2,
    repeatedRecords: 1
  });
});

test("Estado General limita el conteo a la tabla cuyo encabezado reconoció", () => {
  const document = documentWithTables([
    table([
      [{ text: "No_Periodo", tag: "TH" }, { text: "Materia", tag: "TH" }, { text: "Descripcion", tag: "TH" }, { text: "Periodo_escolar", tag: "TH" }, { text: "Veces", tag: "TH" }],
      [{ text: "3" }, { text: "C301" }, { text: "CÁLCULO" }, { text: "" }, { text: "1" }]
    ]),
    table([
      [{ text: "Menú" }, { text: "Ruta" }, { text: "Texto" }, { text: "Visible" }, { text: "2" }]
    ])
  ]);

  assert.deepEqual(trajectory.parseGeneralStatus(document), { records: 1, repeatedRecords: 0 });
});

test("conserva un resultado parcial cuando una fuente de SAES falla", async () => {
  const reenrollment = documentWithTables([
    table([
      [{ text: "Total de creditos que has obtenido", tag: "TH" }, { text: "Total de creditos que te faltan obtener", tag: "TH" }],
      [{ text: "300" }, { text: "100" }]
    ])
  ]);
  const status = documentWithTables([
    table([
      [{ text: "No_Periodo", tag: "TH" }, { text: "Materia", tag: "TH" }, { text: "Descripcion", tag: "TH" }, { text: "Periodo_escolar", tag: "TH" }, { text: "Veces", tag: "TH" }],
      [{ text: "3" }, { text: "C301" }, { text: "CÁLCULO" }, { text: "" }, { text: "1" }]
    ])
  ]);
  const documents = new Map([
    ["reenrollment", reenrollment],
    ["status", status]
  ]);
  const fetchPage = async (source) => {
    if (source === "kardex") throw new Error("SAES no respondió");
    return documents.get(source);
  };

  const result = await trajectory.collectTrajectory({ fetchPage, now: () => "2026-08-26T03:00:00.000Z" });

  assert.equal(result.state, "partial");
  assert.equal(result.progressPercent, 75);
  assert.deepEqual(result.sources, {
    reenrollment: "ready",
    status: "ready",
    kardex: "error"
  });
  assert.equal(result.updatedAt, "2026-08-26T03:00:00.000Z");
});

test("rechaza una respuesta que en realidad es la pantalla de inicio de sesión", async () => {
  const loginDocument = documentWithTables([], "Iniciar Sesión Usuario Password Captcha");

  const result = await trajectory.collectTrajectory({
    fetchPage: async () => loginDocument,
    now: () => "2026-08-26T03:00:00.000Z"
  });

  assert.equal(result.state, "session-expired");
  assert.deepEqual(result.sources, {
    reenrollment: "session-expired",
    status: "session-expired",
    kardex: "session-expired"
  });
});

test("marca como incompatible una página que no contiene la estructura esperada", async () => {
  const reenrollment = documentWithTables([
    table([
      [{ text: "Total de creditos que has obtenido", tag: "TH" }, { text: "Total de creditos que te faltan obtener", tag: "TH" }],
      [{ text: "300" }, { text: "100" }]
    ])
  ]);
  const invalidDocument = documentWithTables([], "Error de servidor en la aplicación");

  const result = await trajectory.collectTrajectory({
    fetchPage: async (source) => source === "reenrollment" ? reenrollment : invalidDocument,
    now: () => "2026-08-26T03:00:00.000Z"
  });

  assert.equal(result.state, "partial");
  assert.deepEqual(result.sources, {
    reenrollment: "ready",
    status: "incompatible",
    kardex: "incompatible"
  });
});
