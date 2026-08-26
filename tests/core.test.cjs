const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared/core.js");
const scanner = require("../src/content/scanner.js");
const occupancy = require("../src/content/occupancy.js");

test("detecta las secciones principales de SAES", () => {
  assert.equal(core.detectContext({ url: "https://saes.ejemplo.ipn.mx/Academica/horarios.aspx" }), "schedule");
  assert.equal(core.detectContext({ url: "https://saes.ejemplo.ipn.mx/Academica/Ocupabilidad_grupos.aspx" }), "occupancy");
  assert.equal(core.detectContext({ url: "https://saes.ejemplo.ipn.mx/Alumnos/Evaluacion_Docente/evaluacion_profesor.aspx" }), "evaluation");
  assert.equal(core.detectContext({ url: "https://saes.ejemplo.ipn.mx/Alumnos/Reinscripciones/reinscripcion.aspx" }), "reenrollment");
  assert.equal(core.detectContext({ text: "Iniciar Sesión Usuario Password Captcha" }), "login");
  assert.equal(core.detectContext({
    url: "https://saes.ejemplo.ipn.mx/Academica/horarios.aspx",
    text: "Iniciar Sesión Usuario Password Captcha"
  }), "login");
  assert.equal(core.detectContext({
    url: "https://saes.ejemplo.ipn.mx/Academica/horarios.aspx",
    text: "Iniciar Sesión Usuario Password Captcha",
    authenticated: true
  }), "schedule");
});

test("adapta la invitación de acceso al estado de la sesión", () => {
  assert.deepEqual(core.launcherModel({ authenticated: false }), {
    title: "MI SAES 2.0",
    message: "Inicia sesión para continuar",
    ariaLabel: "MI SAES 2.0: inicia sesión en SAES para continuar"
  });
  assert.deepEqual(core.launcherModel({ authenticated: true }), {
    title: "MI SAES 2.0",
    message: "Arma tu horario sin empalmes",
    ariaLabel: "Abrir MI SAES 2.0: arma tu horario sin empalmes"
  });
});

test("descarta la preferencia heredada del asistente de evaluación", () => {
  const settings = core.mergeSettings({
    modules: { evaluationAssist: true }
  });

  assert.equal(Object.hasOwn(settings.modules, "evaluationAssist"), false);
});

test("describe las novedades verificadas de la versión 0.12.4", () => {
  assert.deepEqual(core.releaseNotes("0.12.4"), {
    version: "0.12.4",
    title: "MI SAES se actualizó",
    items: [
      "MI SAES conserva su tamaño aunque el portal use estilos tipográficos antiguos.",
      "El acceso público ahora indica claramente que debes iniciar sesión para continuar."
    ],
    releaseUrl: "https://github.com/LeonardSF/MI-SAES-2.0/releases/tag/v0.12.4"
  });
  assert.equal(core.releaseNotes("9.9.9"), null);
});

test("crea un aviso sólo cuando Chrome actualiza a una versión con novedades", () => {
  assert.deepEqual(core.releaseNoticeForInstall({
    reason: "update",
    previousVersion: "0.12.3",
    currentVersion: "0.12.4"
  }), {
    version: "0.12.4",
    previousVersion: "0.12.3"
  });
  assert.equal(core.releaseNoticeForInstall({ reason: "install", currentVersion: "0.12.4" }), null);
  assert.equal(core.releaseNoticeForInstall({ reason: "update", currentVersion: "9.9.9" }), null);
});

test("construye la ruta de Horarios en el mismo plantel", () => {
  assert.equal(
    core.schedulePageUrl("https://www.saes.esimecu.ipn.mx"),
    "https://www.saes.esimecu.ipn.mx/Academica/horarios.aspx"
  );
  assert.equal(core.schedulePageUrl("origen-inválido"), null);
});

test("permite abrir el planificador desde cualquier página autenticada de SAES", () => {
  assert.equal(core.shouldRenderSchedulePlanner({ authenticated: true, offeringsPage: false, context: "general" }), true);
  assert.equal(core.shouldRenderSchedulePlanner({ authenticated: false, offeringsPage: true, context: "schedule" }), true);
  assert.equal(core.shouldRenderSchedulePlanner({ authenticated: false, offeringsPage: false, context: "general" }), false);
  assert.equal(core.shouldRenderSchedulePlanner({ authenticated: true, offeringsPage: false, context: "login" }), false);
});

test("limpia sólo los datos derivados del escaneo de materias", async () => {
  const records = new Map([
    ["catalogo", { offerings: [{ id: "6CM21" }] }],
    ["seleccion", ["6CM21"]],
    ["ocupabilidad", { records: [{ group: "6CM21", available: 20 }] }],
    ["horario-guardado", { offerings: [{ id: "6CM21" }] }],
    ["preferencias", { hideStudentId: true }]
  ]);
  const storage = {
    async remove(keys) {
      keys.forEach((key) => records.delete(key));
    }
  };

  const result = await core.clearScannedScheduleData(storage, {
    catalogKey: "catalogo",
    plannerKey: "seleccion",
    occupancyKey: "ocupabilidad"
  });

  assert.deepEqual([...records.keys()], ["horario-guardado", "preferencias"]);
  assert.deepEqual(result, {
    scanCatalog: null,
    occupancyCatalog: null,
    plannerSelection: [],
    generatedSchedules: [],
    activeGeneratedSchedule: 0
  });
});

test("no reutiliza un catálogo de otra Carrera o Plan de estudio", () => {
  const catalog = { career: "INGENIERÍA EN COMPUTACIÓN", plan: "Plan del 1/1/2004", mode: "Periodo actual" };

  assert.equal(core.scheduleCatalogMatches(catalog, {
    careerLabel: "Ingenieria en Computacion",
    planLabel: "Plan del 1/1/2004"
  }), true);
  assert.equal(core.scheduleCatalogMatches(catalog, {
    careerLabel: "INGENIERÍA EN COMPUTACIÓN",
    planLabel: "Plan 2020"
  }), false);
  assert.equal(core.scheduleCatalogMatches(catalog, {
    careerLabel: "INGENIERÍA EN COMUNICACIONES",
    planLabel: "Plan del 1/1/2004"
  }), false);
  assert.equal(core.scheduleCatalogMatches(catalog, {
    careerLabel: "INGENIERÍA EN COMPUTACIÓN",
    planLabel: "Plan del 1/1/2004",
    modeLabel: "Próximo periodo"
  }), false);
});

test("interpreta rangos de hora frecuentes", () => {
  assert.deepEqual(core.parseTimeRange("07:00 - 08:30"), { start: 420, end: 510 });
  assert.deepEqual(core.parseTimeRange("9.00 a 10.30"), { start: 540, end: 630 });
  assert.equal(core.parseTimeRange("sin horario"), null);
  assert.equal(core.parseTimeRange("18:00 - 07:00"), null);
});

test("deriva bloques y detecta empalmes", () => {
  const entries = core.deriveScheduleEntries([{
    headers: ["Hora", "Lunes", "Martes"],
    rows: [
      ["07:00 - 08:30", "Cálculo", ""],
      ["08:00 - 09:30", "Física", "Programación"],
      ["10:00 - 11:30", "", "Bases de datos"]
    ]
  }]);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].day, "Lunes");
  assert.equal(core.findScheduleConflicts(entries).length, 1);
});

test("sólo marca traslapes reales y no confunde horarios consecutivos", () => {
  const systems = { day: "Lunes", start: 420, end: 510, label: "SISTEMAS OPERATIVOS · 6CM13" };
  const administration = { day: "Lunes", start: 420, end: 510, label: "ADMINISTRACIÓN DE LA INGENIERÍA · 7CM25" };
  const consecutive = { day: "Lunes", start: 510, end: 600, label: "MODULACIÓN DIGITAL · 6CM21" };
  const otherDay = { day: "Martes", start: 420, end: 510, label: "CONTROL · 6CM12" };
  const conflicts = core.findScheduleConflicts([systems, administration, consecutive, otherDay]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].left, systems);
  assert.equal(conflicts[0].right, administration);
});

test("interpreta encabezados abreviados y horarios por día del SAES real", () => {
  const entries = core.deriveScheduleEntries([{
    headers: ["Grupo", "Asignatura", "Profesor", "Lun", "Mar", "Mie"],
    rows: [["6CM11", "MODULACIÓN DIGITAL", "PERSONA DOCENTE UNO", "10:00-11:30", "10:00-11:30", "08:30-10:00"]]
  }]);
  assert.deepEqual(entries.map(({ day, start, end, label }) => ({ day, start, end, label })), [
    { day: "Lunes", start: 600, end: 690, label: "MODULACIÓN DIGITAL · 6CM11" },
    { day: "Martes", start: 600, end: 690, label: "MODULACIÓN DIGITAL · 6CM11" },
    { day: "Miércoles", start: 510, end: 600, label: "MODULACIÓN DIGITAL · 6CM11" }
  ]);
});

test("convierte la oferta académica en opciones independientes", () => {
  const offerings = core.deriveCourseOfferings([{
    headers: ["Grupo", "Asignatura", "Profesor", "Lun", "Mar"],
    rows: [
      ["6CM11", "MODULACIÓN DIGITAL", "PERSONA DOCENTE UNO", "10:00-11:30", "10:00-11:30"],
      ["6CM12", "CONTROL", "PERSONA DOCENTE DOS", "11:00-12:30", ""]
    ]
  }]);
  assert.equal(offerings.length, 2);
  assert.equal(offerings[0].entries.length, 2);
  assert.equal(core.findScheduleConflicts(offerings.flatMap((item) => item.entries)).length, 1);
});

test("une los componentes de una materia con el mismo grupo", () => {
  const offerings = core.deriveCourseOfferings([{
    headers: ["Grupo", "Asignatura", "Profesor", "Lun", "Vie"],
    rows: [
      ["6CM11", "MODULACIÓN DIGITAL", "PERSONA DOCENTE UNO", "10:00-11:30", ""],
      ["6CM11", "MODULACIÓN DIGITAL", "PERSONA DOCENTE DOS", "", "10:00-11:30"]
    ]
  }]);
  assert.equal(offerings.length, 1);
  assert.equal(offerings[0].entries.length, 2);
  assert.match(offerings[0].teacher, /PERSONA DOCENTE UNO \/ PERSONA DOCENTE DOS/);
});

test("genera combinaciones sin empalmes eligiendo una opción por materia", () => {
  const option = (id, subject, group, day, start, end) => ({
    id, subject, group, teacher: "", entries: [{ day, start, end, label: `${subject} · ${group}` }]
  });
  const combinations = core.generateScheduleCombinations([
    option("a1", "Cálculo", "1A", "Lunes", 420, 510),
    option("a2", "Cálculo", "1B", "Lunes", 600, 690),
    option("b1", "Física", "2A", "Lunes", 480, 570),
    option("b2", "Física", "2B", "Martes", 420, 510)
  ]);
  assert.equal(combinations.length, 3);
  assert.ok(combinations.every((item) => core.findScheduleConflicts(item.entries).length === 0));
  assert.ok(combinations.every((item) => item.offerings.length === 2));
});

test("calcula las métricas reales de un horario sin contar huecos como clase", () => {
  assert.deepEqual(core.scheduleMetrics([
    { day: "Lunes", start: 480, end: 570 },
    { day: "Lunes", start: 660, end: 720 },
    { day: "Miércoles", start: 600, end: 660 }
  ]), {
    attendanceDays: 2,
    classMinutes: 210,
    idleMinutes: 90,
    earliestStart: 480,
    latestEnd: 720,
    longestDaySpan: 240
  });

  assert.deepEqual(core.scheduleMetrics([]), {
    attendanceDays: 0,
    classMinutes: 0,
    idleMinutes: 0,
    earliestStart: null,
    latestEnd: null,
    longestDaySpan: 0
  });
});

test("ordena horarios con criterios explícitos y conserva los empates", () => {
  const schedules = [
    {
      id: "dos-dias-tarde",
      entries: [
        { day: "Lunes", start: 600, end: 690 },
        { day: "Martes", start: 600, end: 690 }
      ]
    },
    {
      id: "un-dia-con-hueco",
      entries: [
        { day: "Lunes", start: 480, end: 540 },
        { day: "Lunes", start: 600, end: 660 }
      ]
    },
    {
      id: "un-dia-continuo",
      entries: [
        { day: "Lunes", start: 420, end: 600 }
      ]
    }
  ];

  assert.deepEqual(core.sortScheduleCombinations(schedules, "balanced").map((item) => item.id), [
    "un-dia-continuo", "un-dia-con-hueco", "dos-dias-tarde"
  ]);
  assert.deepEqual(core.sortScheduleCombinations(schedules, "days").map((item) => item.id), [
    "un-dia-continuo", "un-dia-con-hueco", "dos-dias-tarde"
  ]);
  assert.deepEqual(core.sortScheduleCombinations(schedules, "gaps").map((item) => item.id), [
    "un-dia-continuo", "dos-dias-tarde", "un-dia-con-hueco"
  ]);
  assert.deepEqual(core.sortScheduleCombinations(schedules, "late-start").map((item) => item.id), [
    "dos-dias-tarde", "un-dia-con-hueco", "un-dia-continuo"
  ]);
  assert.deepEqual(core.sortScheduleCombinations(schedules, "early-end").map((item) => item.id), [
    "un-dia-continuo", "un-dia-con-hueco", "dos-dias-tarde"
  ]);

  const tied = core.sortScheduleCombinations([
    { id: "primero", entries: [{ day: "Lunes", start: 480, end: 540 }] },
    { id: "segundo", entries: [{ day: "Lunes", start: 480, end: 540 }] }
  ], "balanced");
  assert.deepEqual(tied.map((item) => item.id), ["primero", "segundo"]);
  assert.ok(tied.every((item) => item.metrics?.attendanceDays === 1));
});

test("agrupa la oferta por materia y distingue grupos aceptados", () => {
  const offerings = [
    { id: "calculo-a", subject: "Cálculo", group: "1A" },
    { id: "calculo-b", subject: "CÁLCULO", group: "1B" },
    { id: "fisica-a", subject: "Física", group: "2A" }
  ];

  assert.deepEqual(core.plannerSubjectGroups(offerings, new Set(["calculo-a"])), [
    {
      key: "calculo",
      subject: "Cálculo",
      selected: true,
      acceptedCount: 1,
      offerings: offerings.slice(0, 2)
    },
    {
      key: "fisica",
      subject: "Física",
      selected: false,
      acceptedCount: 0,
      offerings: offerings.slice(2)
    }
  ]);
});

test("seleccionar una materia acepta todos sus grupos y desmarcarla los quita", () => {
  const offerings = [
    { id: "calculo-a", subject: "Cálculo", group: "1A" },
    { id: "calculo-b", subject: "Cálculo", group: "1B" },
    { id: "fisica-a", subject: "Física", group: "2A" }
  ];

  assert.deepEqual(
    [...core.setPlannerSubjectSelected(offerings, new Set(["fisica-a"]), "CÁLCULO", true)],
    ["fisica-a", "calculo-a", "calculo-b"]
  );
  assert.deepEqual(
    [...core.setPlannerSubjectSelected(offerings, new Set(["fisica-a", "calculo-a"]), "calculo", false)],
    ["fisica-a"]
  );
});

test("resume los problemas del planificador con una recuperación concreta", () => {
  const control = {
    id: "control",
    subject: "TEORÍA DE CONTROL ANALÓGICO",
    group: "6CM12",
    entries: [{ day: "Lunes", start: 690, end: 780, label: "TEORÍA DE CONTROL ANALÓGICO · 6CM12" }]
  };
  const methodology = {
    id: "methodology",
    subject: "METODOLOGÍA DE LA INVESTIGACIÓN",
    group: "6CM16",
    entries: [{ day: "Lunes", start: 690, end: 780, label: "METODOLOGÍA DE LA INVESTIGACIÓN · 6CM16" }]
  };

  assert.deepEqual(core.plannerDiagnostics([]), {
    state: "empty",
    title: "Selecciona las materias que quieres cursar",
    detail: "Al elegir una materia aceptaremos inicialmente todos sus grupos.",
    conflicts: [],
    blockedSubjects: []
  });

  const conflict = core.plannerDiagnostics([control, methodology]);
  assert.equal(conflict.state, "conflict");
  assert.equal(conflict.title, "1 traslape por resolver");
  assert.equal(conflict.conflicts[0].leftOffering, control);
  assert.equal(conflict.conflicts[0].rightOffering, methodology);

  const blocked = core.plannerDiagnostics([control], { blockedSubjects: ["teoria de control analogico"] });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.title, "Falta una alternativa con lugares");

  const ready = core.plannerDiagnostics([control]);
  assert.equal(ready.state, "ready");
  assert.equal(ready.title, "Selección lista para generar");
});

test("no trata como conflicto dos grupos alternativos de la misma materia", () => {
  const alternatives = [
    {
      id: "calculo-a",
      subject: "Cálculo",
      group: "1A",
      entries: [{ day: "Lunes", start: 480, end: 570, label: "Cálculo · 1A" }]
    },
    {
      id: "calculo-b",
      subject: "CÁLCULO",
      group: "1B",
      entries: [{ day: "Lunes", start: 480, end: 570, label: "Cálculo · 1B" }]
    }
  ];

  assert.equal(core.plannerDiagnostics(alternatives).state, "ready");
  assert.equal(core.plannerDiagnostics(alternatives).conflicts.length, 0);
});

test("exporta un horario semanal compatible con calendarios", () => {
  const ics = core.scheduleToIcs([{
    day: "Lunes",
    start: 420,
    end: 510,
    label: "Sistemas; Operativos"
  }], { startDate: "2026-08-24", weeks: 16 });
  assert.match(ics, /DTSTART:20260824T070000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;COUNT=16/);
  assert.match(ics, /SUMMARY:Sistemas\\; Operativos/);
  assert.equal(core.scheduleToIcs([], { startDate: "fecha-invalida" }), null);
});

test("filtra usando varios términos sin depender de acentos", () => {
  const rows = [
    ["Cálculo vectorial", "3CV1", "Dra. Pérez"],
    ["Programación", "3CV2", "Mtro. Díaz"],
    ["Cálculo diferencial", "2CV1", "Dra. Pérez"]
  ];
  assert.deepEqual(core.filterRowIndexes(rows, "calculo perez"), [0, 2]);
  assert.deepEqual(core.filterRowIndexes(rows, "3cv2 diaz"), [1]);
});

test("filtra la oferta del planificador por búsqueda, compatibilidad y lugares", () => {
  const offerings = [
    { id: "a", subject: "TEORÍA DE CONTROL", group: "6CM12", teacher: "PERSONA DOCENTE UNO", source: { period: "6", shift: "Matutino" } },
    { id: "b", subject: "SISTEMAS OPERATIVOS", group: "6CV13", teacher: "PERSONA DOCENTE DOS", source: { period: "6", shift: "Vespertino" } },
    { id: "c", subject: "TEORÍA DE CONTROL DIGITAL", group: "7CV12", teacher: "PERSONA DOCENTE TRES", source: { period: "7", shift: "Vespertino" } }
  ];

  assert.deepEqual(core.filterPlannerOfferings(offerings, { query: "teoria 7cv" }).map((item) => item.id), ["c"]);
  assert.deepEqual(core.filterPlannerOfferings(offerings, { compatibleOnly: true, compatibleIds: new Set(["a", "c"]) }).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(core.filterPlannerOfferings(offerings, { availableOnly: true, availableIds: new Set(["b", "c"]) }).map((item) => item.id), ["b", "c"]);
  assert.deepEqual(core.filterPlannerOfferings(offerings, {
    query: "teoria",
    compatibleOnly: true,
    compatibleIds: new Set(["a", "c"]),
    availableOnly: true,
    availableIds: new Set(["c"])
  }).map((item) => item.id), ["c"]);
});

test("combina varios semestres al filtrar la oferta del planificador", () => {
  const offerings = [
    { id: "p4", subject: "CÁLCULO", group: "4CM11", source: { period: "4", shift: "Matutino" } },
    { id: "p5", subject: "REDES", group: "5CM11", source: { period: "5", shift: "Matutino" } },
    { id: "p6", subject: "SISTEMAS", group: "6CV13", source: { period: "6", shift: "Vespertino" } },
    { id: "p7", subject: "CONTROL", group: "7CV12", source: { period: "7", shift: "Vespertino" } }
  ];

  assert.deepEqual(core.filterPlannerOfferings(offerings, { periods: new Set(["5", "6"]) }).map((item) => item.id), ["p5", "p6"]);
  assert.deepEqual(core.filterPlannerOfferings(offerings, { periods: new Set() }).map((item) => item.id), ["p4", "p5", "p6", "p7"]);
});

test("genera CSV seguro para comas y comillas", () => {
  const csv = core.tableToCsv({
    headers: ["Materia", "Profesor"],
    rows: [["Ética, profesión", "Pérez \"A\""]]
  });
  assert.match(csv, /^\uFEFFMateria,Profesor/);
  assert.match(csv, /"Ética, profesión","Pérez ""A"""/);
});

test("calcula promedio sólo con valores en escala de 0 a 10", () => {
  assert.deepEqual(core.calculateAverage(["8, 9.5, 7, 10"]), {
    count: 4,
    average: 8.63,
    minimum: 7,
    maximum: 10
  });
  assert.equal(core.calculateAverage(["11, -1, texto"]), null);
});

test("nombra las combinaciones generadas como horarios", () => {
  assert.deepEqual(core.generatedScheduleCopy(2, 0), {
    title: "2 horarios sin empalmes",
    option: "Horario 1"
  });
  assert.deepEqual(core.generatedScheduleCopy(1, 0), {
    title: "1 horario sin empalmes",
    option: "Horario 1"
  });
});

test("mantiene singular y plural en los resúmenes compactos", () => {
  assert.equal(core.countLabel(1, "periodo", "periodos"), "1 periodo");
  assert.equal(core.countLabel(2, "periodo", "periodos"), "2 periodos");
});

test("mezcla preferencias conservando módulos nuevos", () => {
  const settings = core.mergeSettings({ theme: "dark", modules: { notes: false } });
  assert.equal("theme" in settings, false);
  assert.equal(settings.modules.notes, false);
  assert.equal(settings.modules.schedule, true);
  assert.equal(settings.modules.trajectoryHome, true);
  assert.equal(settings.hideStudentId, false);
});

test("mantiene Mi trayectoria activa aunque una preferencia antigua la desactive", () => {
  const settings = core.mergeSettings({ modules: { trajectoryHome: false } });

  assert.equal(settings.modules.trajectoryHome, true);
});

test("muestra Mi trayectoria sólo en el inicio autenticado cuando está activada", () => {
  assert.equal(core.shouldShowTrajectoryHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx",
    enabled: true,
    authenticated: true
  }), true);
  assert.equal(core.shouldShowTrajectoryHome({
    url: "https://www.saes.esimecu.ipn.mx/alumnos/boleta/kardex.aspx",
    enabled: true,
    authenticated: true
  }), false);
  assert.equal(core.shouldShowTrajectoryHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx",
    enabled: false,
    authenticated: true
  }), false);
  assert.equal(core.shouldShowTrajectoryHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx",
    enabled: true,
    authenticated: false
  }), false);
});

test("mejora el inicio del alumno sólo dentro de una sesión autenticada", () => {
  assert.equal(core.shouldEnhanceStudentHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx",
    enabled: true,
    authenticated: true
  }), true);
  assert.equal(core.shouldEnhanceStudentHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/boleta/kardex.aspx",
    enabled: true,
    authenticated: true
  }), false);
  assert.equal(core.shouldEnhanceStudentHome({
    url: "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx",
    enabled: true,
    authenticated: false
  }), false);
});

test("elige la foto oficial del alumno sin confundir logotipos ni imágenes externas", () => {
  const candidates = [
    { src: "/Images/logos/35.png", id: "ctl00_LogoEscuela", alt: "Escuela" },
    { src: "/Images/sliderDenuncia.jpg", alt: "Aviso" },
    { src: "https://imagenes.example/foto.jpg", id: "fotoAlumno" },
    { src: "../Pase_Digital/FotoAlumno.ashx?id=actual", id: "ctl00_mainCopy_imgFoto", alt: "Fotografía del alumno" }
  ];

  assert.equal(
    core.officialStudentPhotoUrl(candidates, "https://www.saes.esimecu.ipn.mx/Alumnos/Pase_Digital/Pase_Digital.aspx"),
    "https://www.saes.esimecu.ipn.mx/Alumnos/Pase_Digital/FotoAlumno.ashx?id=actual"
  );
  assert.equal(core.officialStudentPhotoUrl([
    { src: "/Images/logos/Poli_XCH.png" },
    { src: "/CaptchaImage.aspx", alt: "Captcha" },
    { src: "data:image/jpeg;base64,Zm90bw==", id: "fotoAlumno" }
  ], "https://www.saes.esimecu.ipn.mx/Alumnos/default.aspx"), null);
});

test("confía sólo en respuestas del mismo plantel", () => {
  assert.equal(core.isSameOriginUrl(
    "https://www.saes.esimecu.ipn.mx/Alumnos/Pase_Digital/Pase_Digital.aspx",
    "https://www.saes.esimecu.ipn.mx"
  ), true);
  assert.equal(core.isSameOriginUrl(
    "https://imagenes.example/Pase_Digital.aspx",
    "https://www.saes.esimecu.ipn.mx"
  ), false);
  assert.equal(core.isSameOriginUrl("respuesta-invalida", "https://www.saes.esimecu.ipn.mx"), false);
});

test("construye la fuente oficial de la foto desde Datos Personales", () => {
  assert.equal(
    core.studentPhotoPageUrl("https://www.saes.esimecu.ipn.mx"),
    "https://www.saes.esimecu.ipn.mx/Alumnos/info_alumnos/Datos_Alumno.aspx"
  );
  assert.equal(core.studentPhotoPageUrl("origen-invalido"), null);
});

test("convierte el saludo antiguo de SAES en una identidad breve", () => {
  assert.deepEqual(core.studentGreetingModel([
    "MENÚ PRINCIPAL DE ALUMNOS",
    "BUENAS NOCHES",
    "ESTUDIANTE DE PRUEBA"
  ]), {
    greeting: "Buenas noches",
    name: "ESTUDIANTE DE PRUEBA"
  });
  assert.deepEqual(core.studentGreetingModel(["MENÚ PRINCIPAL DE ALUMNOS"]), {
    greeting: "Bienvenido a tu espacio académico",
    name: "Estudiante"
  });
});

test("normaliza el intervalo de actualización de ocupabilidad", () => {
  assert.equal(core.normalizeOccupancyRefreshMinutes(), 2);
  assert.equal(core.normalizeOccupancyRefreshMinutes("5"), 5);
  assert.equal(core.normalizeOccupancyRefreshMinutes(15), 15);
  assert.equal(core.normalizeOccupancyRefreshMinutes(3), 2);
  assert.equal(core.normalizeOccupancyRefreshMinutes("nunca"), 2);
});

test("crea una búsqueda de MisProfesores con el nombre completo", () => {
  assert.equal(
    core.misProfesoresSearchUrl("PERSONA DOCENTE UNO"),
    "https://www.misprofesores.com/Buscar?buscar=Profesores&q=PERSONA+DOCENTE+UNO"
  );
  assert.equal(core.misProfesoresSearchUrl("   "), null);
});

test("protege sólo la boleta y puede restaurar su texto original", () => {
  const studentId = { textContent: "2026000000", dataset: {} };
  const root = {
    querySelector(selector) {
      return selector === "#ctl00_leftColumn_LoginNameSession" ? studentId : null;
    }
  };

  assert.equal(core.applyStudentIdPrivacy(root, true), true);
  assert.equal(studentId.textContent, "MI SAES 2.0");
  assert.equal(studentId.dataset.misaesOriginalStudentId, "2026000000");

  assert.equal(core.applyStudentIdPrivacy(root, false), true);
  assert.equal(studentId.textContent, "2026000000");
  assert.equal("misaesOriginalStudentId" in studentId.dataset, false);
});

test("ignora páginas que no contienen la boleta de sesión", () => {
  assert.equal(core.applyStudentIdPrivacy({ querySelector: () => null }, true), false);
});

test("el escáner ignora opciones vacías y conserva periodos y turnos reales", () => {
  const options = scanner.usefulOptions({
    options: [
      { value: "", textContent: "Seleccione", disabled: false },
      { value: "all", textContent: "Todo", disabled: false },
      { value: "M", textContent: "Matutino", disabled: false },
      { value: "V", textContent: "Vespertino", disabled: false },
      { value: "X", textContent: "Mixto", disabled: true }
    ]
  });
  assert.deepEqual(options.map((option) => option.value), ["M", "V"]);
});

test("presenta Carrera, Plan y modo como una configuración dependiente", () => {
  const select = (name, value, values) => ({
    id: name,
    name,
    tagName: "SELECT",
    value,
    options: values.map(([optionValue, textContent]) => ({ value: optionValue, textContent, disabled: false })),
    selectedOptions: values.filter(([optionValue]) => optionValue === value).map(([optionValue, textContent]) => ({ value: optionValue, textContent }))
  });
  const career = select("carrera", "ISC", [["", "Seleccione"], ["ISC", "INGENIERÍA EN COMPUTACIÓN"], ["ICE", "INGENIERÍA EN COMUNICACIONES"]]);
  const shift = select("turno", "M", [["M", "Matutino"], ["V", "Vespertino"]]);
  const plan = select("plan", "04", [["", "Seleccione"], ["04", "Plan 2004"], ["20", "Plan 2020"]]);
  const period = select("periodo", "6", [["6", "6"]]);
  const radios = [
    { id: "actual", name: "periodo", value: "actual", checked: true, ownerDocument: null, closest: () => ({ textContent: "Periodo actual" }) },
    { id: "proximo", name: "periodo", value: "proximo", checked: false, ownerDocument: null, closest: () => ({ textContent: "Próximo periodo" }) }
  ];
  const doc = {
    querySelectorAll(selector) {
      if (selector === "select") return [career, shift, plan, period];
      if (selector === 'input[type="radio"]') return radios;
      return [];
    },
    querySelector() { return null; }
  };
  radios.forEach((radio) => { radio.ownerDocument = doc; });

  assert.deepEqual(scanner.configurationModel(doc), {
    careers: [
      { value: "ISC", label: "INGENIERÍA EN COMPUTACIÓN" },
      { value: "ICE", label: "INGENIERÍA EN COMUNICACIONES" }
    ],
    plans: [
      { value: "04", label: "Plan 2004" },
      { value: "20", label: "Plan 2020" }
    ],
    modes: [
      { value: "0", label: "Periodo actual" },
      { value: "1", label: "Próximo periodo" }
    ],
    selectedCareer: "ISC",
    selectedPlan: "04",
    selectedMode: "0"
  });
});

test("limita el escaneo al plan elegido", () => {
  const control = {
    value: "04",
    options: [
      { value: "04", textContent: "Plan 2004", disabled: false },
      { value: "20", textContent: "Plan 2020", disabled: false }
    ]
  };

  assert.deepEqual(scanner.requestedOptions(control, "20").map((option) => option.value), ["20"]);
  assert.deepEqual(scanner.requestedOptions(control, "99"), []);
  assert.deepEqual(scanner.requestedOptions(control).map((option) => option.value), ["04", "20"]);
});

test("el escáner resuelve postbacks contra la página de Horarios", () => {
  const doc = { __misaesUrl: "https://www.saes.esimecu.ipn.mx/Academica/horarios.aspx" };
  const relativeForm = { getAttribute: () => "horarios.aspx" };
  const rootForm = { getAttribute: () => "/Academica/horarios.aspx" };

  assert.equal(
    scanner.formActionUrl(doc, relativeForm),
    "https://www.saes.esimecu.ipn.mx/Academica/horarios.aspx"
  );
  assert.equal(
    scanner.formActionUrl(doc, rootForm),
    "https://www.saes.esimecu.ipn.mx/Academica/horarios.aspx"
  );
});

test("interpreta la tabla real de cupo, inscritos y disponibles", () => {
  const cell = (textContent) => ({ textContent });
  const row = (values) => ({ cells: values.map(cell) });
  const doc = {
    querySelectorAll(selector) {
      if (selector !== "table") return [];
      return [{ rows: [
        row(["Grupo", "Materia", "Nombre de la Materia", "Semestre", "Cupo", "Inscritos", "Disponibles"]),
        row(["6CM11", "C611", "MODULACIÓN DIGITAL", "6", "30", "30", "0"]),
        row(["6CM21", "C611", "MODULACIÓN DIGITAL", "6", "30", "18", "12"])
      ] }];
    }
  };
  assert.deepEqual(occupancy.parseTable(doc), [
    { group: "6CM11", subject: "MODULACIÓN DIGITAL", period: "6", capacity: 30, enrolled: 30, available: 0 },
    { group: "6CM21", subject: "MODULACIÓN DIGITAL", period: "6", capacity: 30, enrolled: 18, available: 12 }
  ]);
});

test("asigna los lugares al grupo y materia correctos", () => {
  const records = [
    { group: "6CM11", subject: "MODULACIÓN DIGITAL", available: 0 },
    { group: "6CM11", subject: "LABORATORIO DE MODULACIÓN DIGITAL", available: 18 },
    { group: "6CM21", subject: "MODULACIÓN DIGITAL", available: 12 }
  ];

  assert.equal(occupancy.findRecord(records, {
    group: "6cm11",
    subject: "Modulacion digital"
  })?.available, 0);
  assert.equal(occupancy.findRecord(records, {
    group: "6CM21",
    subject: "MODULACIÓN DIGITAL"
  })?.available, 12);
  assert.equal(occupancy.findRecord(records, {
    group: "6CM11",
    subject: "MATERIA DISTINTA"
  }), null);
});
