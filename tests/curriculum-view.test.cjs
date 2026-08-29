const test = require("node:test");
const assert = require("node:assert/strict");
const view = require("../src/content/curriculum-view.js");

test("construye copy accesible para estados y periodos desactualizados", () => {
  const model = view.buildViewModel({
    state: "partial",
    periods: [
      { period: 1, state: "ready", subjects: [{ state: "approved" }] },
      { period: 2, state: "stale", error: "SAES no respondió", subjects: [{ state: "pending" }] }
    ],
    summary: { subjects: 2, approved: 1, progressPercent: 50, approvedCredits: 6, totalCredits: 12 }
  });

  assert.equal(model.notice, "El periodo 2 conserva su última lectura porque no se pudo actualizar.");
  assert.deepEqual(model.legend.map((item) => item.label), ["Aprobada", "Cursando", "Último resultado no aprobado", "Pendiente"]);
  assert.equal(model.progressDetail, "6 de 12 créditos aprobados");
});

test("explica el avance por materias cuando SAES no reporta créditos", () => {
  const model = view.buildViewModel({
    state: "ready",
    periods: [],
    summary: { subjects: 10, approved: 4, progressPercent: 40, approvedCredits: 0, totalCredits: 0 }
  });
  assert.equal(model.progressDetail, "4 de 10 materias aprobadas");
});

test("cuenta cada bloque optativo como un requisito en filtros y avance", () => {
  const model = view.buildViewModel({
    periods: [{
      period: 8,
      requirements: [
        { type: "subject", state: "approved", subject: { state: "approved" } },
        { type: "elective", state: "current", subjects: [{ state: "current" }, { state: "pending" }] }
      ]
    }],
    summary: { subjects: 2, approved: 1, electiveSlots: 1, progressPercent: 50, totalCredits: 0 }
  });

  assert.deepEqual(model.counts, { all: 2, approved: 1, current: 1, failed: 0, pending: 0 });
  assert.equal(model.progressDetail, "1 de 2 materias requeridas cubiertas");
});

test("usa el avance oficial por créditos y deja las materias como desglose", () => {
  const model = view.buildViewModel({
    periods: [{ period: 1, requirements: [
      ...Array.from({ length: 33 }, () => ({ type: "subject", state: "approved", subject: { state: "approved" } })),
      ...Array.from({ length: 4 }, () => ({ type: "subject", state: "current", subject: { state: "current" } })),
      ...Array.from({ length: 11 }, () => ({ type: "subject", state: "pending", subject: { state: "pending" } }))
    ] }],
    summary: {
      subjects: 48,
      approved: 33,
      progressPercent: 69,
      officialCreditProgress: { earnedCredits: 291, remainingCredits: 121.5, totalCredits: 412.5, progressPercent: 71 }
    }
  });

  assert.equal(model.progressPercent, 71);
  assert.equal(model.progressLabel, "por créditos");
  assert.equal(model.progressDetail, "291 de 412.5 créditos obtenidos · faltan 121.5");
  assert.equal(model.subjectDetail, "33 de 48 materias aprobadas · 4 cursando");
});

test("conserva todos los periodos al filtrar y vacía sólo los que no coinciden", () => {
  const periods = [
    { period: 1, subjects: [{ state: "approved" }, { state: "pending" }] },
    { period: 2, subjects: [{ state: "pending" }] },
    { period: 9, subjects: [{ state: "current" }] }
  ];

  assert.deepEqual(view.buildPeriodPanels(periods, "approved").map((period) => period.subjects.length), [1, 0, 0]);
});

test("limita la navegación anterior y siguiente a los periodos disponibles", () => {
  assert.equal(view.nextPeriodIndex(0, -1, 9), 0);
  assert.equal(view.nextPeriodIndex(3, 1, 9), 4);
  assert.equal(view.nextPeriodIndex(8, 1, 9), 8);
});
