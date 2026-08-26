const test = require("node:test");
const assert = require("node:assert/strict");
const trajectoryView = require("../src/content/trajectory-view.js");

test("presenta un estado inicial que explica la actualización antes de consultar SAES", () => {
  assert.deepEqual(trajectoryView.buildModel(null), {
    state: "empty",
    title: "Mi trayectoria",
    description: "Reúne tu avance académico desde tres páginas de SAES. Los datos se guardan sólo en este navegador.",
    action: "Actualizar mi trayectoria",
    progress: null,
    metrics: [],
    sources: []
  });
});

test("transforma la fotografía académica en información factual y legible", () => {
  const model = trajectoryView.buildModel({
    state: "ready",
    progressPercent: 72,
    updatedAt: "2026-08-26T03:00:00.000Z",
    reenrollment: {
      earnedCredits: 310,
      remainingCredits: 120,
      average: 8.36,
      failedSubjects: 1,
      periodsCompleted: 7,
      periodsAvailable: 4,
      minimumLoad: 35,
      mediumLoad: 70,
      maximumLoad: 100,
      authorizedLoad: 70
    },
    kardex: { records: 42, gradesFromSix: 40, gradesBelowSix: 2, withoutNumericGrade: 0 },
    status: { records: 2, repeatedRecords: 1 },
    sources: { reenrollment: "ready", status: "ready", kardex: "ready" }
  });

  assert.equal(model.state, "ready");
  assert.equal(model.progress.value, 72);
  assert.equal(model.progress.detail, "310 de 430 créditos obtenidos");
  assert.deepEqual(model.metrics.map((metric) => metric.label), [
    "Promedio reportado",
    "Materias reprobadas",
    "Periodos cursados",
    "Periodos disponibles",
    "Carga autorizada",
    "Registros en Estado General"
  ]);
  assert.equal(model.sources.every((source) => source.state === "ready"), true);
});

test("explica una actualización parcial sin ocultar la fuente que falló", () => {
  const model = trajectoryView.buildModel({
    state: "partial",
    progressPercent: 75,
    updatedAt: "2026-08-26T03:00:00.000Z",
    reenrollment: { earnedCredits: 300, remainingCredits: 100 },
    status: { records: 1, repeatedRecords: 0 },
    sources: { reenrollment: "ready", status: "ready", kardex: "error" }
  });

  assert.equal(model.state, "partial");
  assert.equal(model.description, "Se actualizaron dos fuentes. Kárdex no respondió; puedes conservar estos datos y reintentar.");
  assert.deepEqual(model.sources.find((source) => source.id === "kardex"), {
    id: "kardex",
    label: "Kárdex",
    state: "error",
    detail: "No se pudo consultar",
    statusLabel: "Error"
  });
});

test("deriva el mensaje parcial de la fuente que realmente falló", () => {
  const model = trajectoryView.buildModel({
    state: "partial",
    updatedAt: "2026-08-26T03:00:00.000Z",
    kardex: { records: 10, gradesFromSix: 9, gradesBelowSix: 1, withoutNumericGrade: 0 },
    status: { records: 1, repeatedRecords: 0 },
    sources: { reenrollment: "error", status: "ready", kardex: "ready" }
  });

  assert.equal(model.description, "Se actualizaron dos fuentes. Reinscripción no respondió; puedes conservar estos datos y reintentar.");
});

test("nombra de forma explícita la sesión terminada y el error total", () => {
  const expired = trajectoryView.buildModel({
    state: "session-expired",
    sources: { reenrollment: "session-expired", status: "session-expired", kardex: "session-expired" }
  });
  const failed = trajectoryView.buildModel({
    state: "error",
    sources: { reenrollment: "error", status: "incompatible", kardex: "error" }
  });

  assert.equal(expired.sources[0].statusLabel, "Sesión terminada");
  assert.equal(failed.description, "SAES no entregó datos académicos compatibles. Revisa tu sesión y vuelve a intentarlo.");
});

test("prioriza el avance y conserva el detalle académico bajo demanda", () => {
  const model = trajectoryView.buildEmbeddedModel({
    state: "ready",
    progressPercent: 72,
    updatedAt: "2026-08-26T03:00:00.000Z",
    reenrollment: {
      average: 8.36,
      failedSubjects: 1,
      earnedCredits: 310,
      remainingCredits: 120,
      periodsCompleted: 7,
      periodsAvailable: 4,
      authorizedLoad: 70
    },
    kardex: { records: 42, gradesFromSix: 40, gradesBelowSix: 2, withoutNumericGrade: 0 },
    status: { records: 2, repeatedRecords: 1 },
    sources: { reenrollment: "ready", status: "ready", kardex: "ready" }
  });

  assert.deepEqual(model.metrics.map((metric) => metric.label), [
    "Promedio reportado",
    "Materias reprobadas",
    "Periodos académicos",
    "Carga autorizada"
  ]);
  assert.equal(model.progress.detail, "310 de 430 créditos obtenidos · faltan 120");
  assert.equal(model.metrics.find((metric) => metric.label === "Periodos académicos").value, "7 cursados · 4 disponibles");
  assert.deepEqual(model.attention, {
    title: "Revisa Estado General",
    detail: "2 materias figuran en seguimiento; 1 aparece más de una vez."
  });
  assert.deepEqual(model.kardex, { records: 42, gradesFromSix: 40, gradesBelowSix: 2, withoutNumericGrade: 0 });
  assert.deepEqual(model.loads, { minimum: null, medium: null, maximum: null });
  assert.deepEqual(model.sources, []);
});

test("no muestra una alerta cuando Estado General está vacío", () => {
  const model = trajectoryView.buildEmbeddedModel({
    state: "ready",
    reenrollment: { earnedCredits: 430, remainingCredits: 0 },
    status: { records: 0, repeatedRecords: 0 },
    sources: { reenrollment: "ready", status: "ready", kardex: "ready" }
  });

  assert.equal(model.attention, null);
});

test("resume Kárdex y rangos de carga sin reinterpretar sus valores", () => {
  const model = trajectoryView.buildEmbeddedModel({
    state: "ready",
    reenrollment: {
      earnedCredits: 310,
      remainingCredits: 120,
      minimumLoad: 35,
      mediumLoad: 70,
      maximumLoad: 100
    },
    kardex: { records: 42, gradesFromSix: 40, gradesBelowSix: 2, withoutNumericGrade: 0 },
    status: { records: 0, repeatedRecords: 0 },
    sources: { reenrollment: "ready", status: "ready", kardex: "ready" }
  });

  assert.deepEqual(trajectoryView.embeddedDetailFacts(model), [
    "42 registros en Kárdex: 40 con calificación de 6 a 10, 2 menores a 6 y 0 sin calificación numérica.",
    "Rangos de carga: mínima 35, media 70 y máxima 100 créditos."
  ]);
});
