const test = require("node:test");
const assert = require("node:assert/strict");
const curriculum = require("../src/content/curriculum.js");

function documentWithTables(tables, text = "") {
  return {
    body: { textContent: text },
    querySelectorAll(selector) { return selector === "table" ? tables : []; }
  };
}

function table(rows) {
  return {
    rows: rows.map((cells) => ({
      cells: cells.map((text) => ({ textContent: text }))
    }))
  };
}

test("lee clave, créditos y horas únicamente de la tabla curricular", () => {
  const document = documentWithTables([
    table([
      ["Clave", "Unidad de aprendizaje", "Créditos", "Horas teoría", "Horas práctica"],
      ["C101", "Cálculo diferencial", "7.5", "4.5", "1.5"],
      ["F102", "Física", "6", "3", "1.5"]
    ]),
    table([["Enlace", "Créditos", "Horas teoría", "Horas práctica"], ["Ayuda", "99", "99", "99"]])
  ]);

  assert.deepEqual(curriculum.parseCurriculumPeriod(document, 1), [
    { key: "C101", name: "Cálculo diferencial", period: 1, credits: 7.5, theoryHours: 4.5, practiceHours: 1.5 },
    { key: "F102", name: "Física", period: 1, credits: 6, theoryHours: 3, practiceHours: 1.5 }
  ]);
});

test("aplica la precedencia aprobada, cursando, no aprobada y pendiente", () => {
  const periods = [{ period: 1, subjects: [
    { key: "A1", name: "Aprobada", period: 1, credits: 6 },
    { key: "C1", name: "Cursando", period: 1, credits: 5 },
    { key: "R1", name: "Reprobada", period: 1, credits: 4 },
    { key: "P1", name: "Pendiente", period: 1, credits: 3 }
  ] }];
  const model = curriculum.buildCurriculumModel({
    periods,
    kardexRecords: [
      { key: "A1", grade: 8, period: "2025/1", date: "2025-06-10" },
      { key: "C1", grade: 5, period: "2024/2", date: "2024-12-01" },
      { key: "R1", grade: 5, period: "2025/2", date: "2025-07-01" }
    ],
    currentSubjects: [{ key: "C1", name: "Cursando" }, { key: "A1", name: "Aprobada" }]
  });

  assert.deepEqual(model.periods[0].subjects.map((subject) => subject.state), ["approved", "current", "failed", "pending"]);
  assert.equal(model.summary.approvedCredits, 6);
  assert.equal(model.summary.progressPercent, 33);
});

test("un resultado posterior aprobado reemplaza un intento no aprobado", () => {
  const model = curriculum.buildCurriculumModel({
    periods: [{ period: 2, subjects: [{ key: "M2", name: "Métodos", period: 2 }] }],
    kardexRecords: [
      { key: "M2", grade: 5, period: "2024/2", date: "2024-12-01" },
      { key: "M2", grade: 7, period: "2025/1", date: "2025-06-01" }
    ]
  });
  assert.equal(model.periods[0].subjects[0].state, "approved");
});

test("cruza por nombre cuando el mapa no reporta la clave del Kárdex", () => {
  const model = curriculum.buildCurriculumModel({
    periods: [{ period: 1, subjects: [{ key: "", name: "Cálculo diferencial", period: 1 }] }],
    kardexRecords: [{ key: "C101", name: "CALCULO DIFERENCIAL", grade: 8, period: "2025/1" }]
  });

  assert.equal(model.periods[0].subjects[0].state, "approved");
});

test("cuenta las optativas de octavo como dos elecciones y no como todas sus alternativas", () => {
  const subjects = [
    "REDES DE COMPUTADORAS",
    "SISTEMAS DISTRIBUIDOS",
    "FORMULACIÓN Y EVALUACIÓN DE PROYECTOS",
    "PROYECTO DE INGENIERÍA",
    "SISTEMAS DE INFORMACIÓN II",
    "TRANSFERENCIA Y PROC.DE LA INFORMACIÓN II",
    "ALGORITMOS DE CÓMPUTO II",
    "INTERFASES INTELIGENTES II",
    "CÓMPUTO APLICADO A SISTEMAS ECOLÓGICOS II",
    "REDES NEURONALES",
    "INTELIGENCIA ARTIFICIAL",
    "SISTEMAS EXPERTOS"
  ].map((name) => ({ key: "", name, period: 8, credits: null }));
  const model = curriculum.buildCurriculumModel({
    career: "INGENIERÍA EN COMPUTACIÓN",
    plan: "Plan del 1/1/2004",
    periods: [{ period: 8, subjects }],
    kardexRecords: [
      { name: "REDES DE COMPUTADORAS", grade: 8, period: "2025/1" },
      { name: "SISTEMAS DE INFORMACIÓN II", grade: 7, period: "2025/1" }
    ],
    currentSubjects: [{ name: "INTELIGENCIA ARTIFICIAL" }]
  });

  const requirements = model.periods[0].requirements;
  assert.equal(requirements.length, 6);
  assert.deepEqual(requirements.filter((item) => item.type === "elective").map((item) => [item.label, item.subjects.length, item.state]), [
    ["Optativa II", 5, "approved"],
    ["Optativa III", 3, "current"]
  ]);
  assert.equal(model.summary.subjects, 6);
  assert.equal(model.summary.electiveSlots, 2);
  assert.equal(model.summary.approved, 2);
  assert.equal(model.summary.progressPercent, 33);
});

test("no agrupa por nombre las materias de un plan distinto", () => {
  const model = curriculum.buildCurriculumModel({
    career: "OTRA CARRERA",
    plan: "Plan 2004",
    periods: [{ period: 8, subjects: [
      { key: "", name: "INTELIGENCIA ARTIFICIAL", period: 8 },
      { key: "", name: "SISTEMAS EXPERTOS", period: 8 }
    ] }]
  });
  assert.equal(model.periods[0].requirements.length, 2);
  assert.equal(model.summary.electiveSlots, 0);
});

test("completa los 48 requisitos oficiales aunque Horarios no publique todos los periodos", () => {
  const model = curriculum.buildCurriculumModel({
    career: "INGENIERÍA EN COMPUTACIÓN",
    plan: "Plan del 1/1/2004",
    periods: Array.from({ length: 8 }, (_, index) => ({ period: index + 1, subjects: [] })),
    kardexRecords: [
      { name: "CALCULO DIFERENCIAL E INTEGRAL", grade: 10 },
      { name: "FISICA CLASICA", grade: 6 },
      { name: "FUNDAMENTOS DE PROGRAMACION", grade: 7 },
      { name: "HUMANIDADES I INGENERIA, CIENCIA Y SOCIEDAD", grade: 10 },
      { name: "FUNDAMENTOS DE ALGEBRA", grade: 7 },
      { name: "QUIMICA BASICA", grade: 10 }
    ],
    currentSubjects: [{ name: "MODULACIÓN DIGITAL" }, { name: "ADMINISTRACIÓN DE LA INGENERIA" }],
    creditProgress: { earnedCredits: 291, remainingCredits: 121.5 }
  });

  assert.deepEqual(model.periods.map((period) => period.requirements.length), [6, 6, 6, 6, 6, 6, 6, 6]);
  assert.equal(model.summary.subjects, 48);
  assert.equal(model.summary.approved, 6);
  assert.equal(model.summary.electiveSlots, 3);
  assert.deepEqual(model.summary.officialCreditProgress, {
    earnedCredits: 291,
    remainingCredits: 121.5,
    totalCredits: 412.5,
    progressPercent: 71
  });
  assert.equal(model.periods.flatMap((period) => period.subjects).filter((subject) => subject.state === "current").length, 2);
});

test("lee las materias del horario oficial desde cualquier página de SAES", () => {
  const document = documentWithTables([
    table([
      ["Grupo", "Materia", "Profesores", "Lunes", "Martes"],
      ["6CM21", "C634 - MODULACIÓN DIGITAL", "DOCENTE", "08:30 - 10:00", ""],
      ["7CM25", "C739 - ADMINISTRACIÓN DE LA INGENERIA", "DOCENTE", "07:00 - 08:30", ""]
    ])
  ]);

  assert.deepEqual(curriculum.parseCurrentSchedule(document), [
    { key: "C634", name: "MODULACIÓN DIGITAL" },
    { key: "C739", name: "ADMINISTRACIÓN DE LA INGENERIA" }
  ]);
});

test("conserva por periodo la última lectura cuando SAES falla", async () => {
  const previous = {
    periods: [{ period: 2, state: "ready", updatedAt: "2026-08-20T00:00:00.000Z", subjects: [{ key: "OLD", name: "Anterior", period: 2 }] }]
  };
  const result = await curriculum.collectCurriculum({
    periodNumbers: [1, 2],
    previous,
    now: () => "2026-08-26T20:00:00.000Z",
    async fetchPeriod(period) {
      if (period === 2) throw new Error("SAES no respondió");
      return documentWithTables([table([["Clave", "Materia", "Créditos", "HT", "HP"], ["NEW", "Nueva", "5", "3", "2"]])]);
    }
  });

  assert.equal(result.state, "partial");
  assert.equal(result.periods[0].subjects[0].key, "NEW");
  assert.equal(result.periods[1].subjects[0].key, "OLD");
  assert.equal(result.periods[1].state, "stale");
  assert.match(result.periods[1].error, /no respondió/i);
});

test("filtra sin eliminar la agrupación por periodo", () => {
  const periods = [
    { period: 1, subjects: [{ state: "approved" }, { state: "pending" }] },
    { period: 2, subjects: [{ state: "current" }] }
  ];
  assert.deepEqual(curriculum.filterCurriculumPeriods(periods, "pending"), [
    { period: 1, subjects: [{ state: "pending" }] }
  ]);
});

test("conserva todos los periodos detectados sin inventar créditos ni horas", () => {
  const snapshot = curriculum.curriculumFromOfferings([
    { subject: "Cálculo", key: "C101", source: { period: "1" } },
    { subject: "Cálculo", key: "C101", source: { period: "1" } },
    { subject: "Física", source: { period: "2" } },
    { subject: "Proyecto terminal", key: "P901", source: { period: "9" } }
  ], {
    updatedAt: "2026-08-26T20:00:00.000Z",
    periodNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9]
  });

  assert.deepEqual(snapshot.periods.map((period) => period.period), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(snapshot.periods[0].subjects, [
    { key: "C101", name: "Cálculo", period: 1, credits: null, theoryHours: null, practiceHours: null }
  ]);
  assert.equal(snapshot.periods[7].subjects.length, 0);
  assert.equal(snapshot.periods[8].subjects[0].name, "Proyecto terminal");
});

test("amplía el mapa cuando las materias revelan un periodo adicional", () => {
  const snapshot = curriculum.curriculumFromOfferings([
    { subject: "Proyecto terminal", source: { period: "9" } }
  ]);

  assert.deepEqual(snapshot.periods.map((period) => period.period), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
