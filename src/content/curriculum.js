(function initMiSaesCurriculum(globalScope) {
  "use strict";

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function numeric(value) {
    const match = String(value ?? "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function tableRows(document) {
    return [...(document?.querySelectorAll?.("table") || [])].map((table) => [...(table.rows || [])]
      .map((row) => [...(row.cells || [])].map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((row) => row.some(Boolean)));
  }

  function column(headers, pattern) {
    return headers.findIndex((header) => pattern.test(normalizeText(header)));
  }

  function parseCurriculumPeriod(document, period) {
    const subjects = [];
    for (const rows of tableRows(document)) {
      const headerIndex = rows.findIndex((row) => {
        const normalized = row.map(normalizeText);
        return normalized.some((cell) => /^(clave|codigo)$/.test(cell))
          && normalized.some((cell) => /(unidad de aprendizaje|asignatura|materia)/.test(cell));
      });
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex];
      const keyIndex = column(headers, /^(clave|codigo)$/);
      const nameIndex = column(headers, /(unidad de aprendizaje|asignatura|materia)/);
      const creditsIndex = column(headers, /credito/);
      const theoryIndex = column(headers, /(horas?\s*(teoria|teorica)|^ht$)/);
      const practiceIndex = column(headers, /(horas?\s*(practica|practicas)|^hp$)/);
      rows.slice(headerIndex + 1).forEach((row) => {
        const key = String(row[keyIndex] || "").trim();
        const name = String(row[nameIndex] || "").trim();
        if (!key || !name || row.length !== headers.length) return;
        subjects.push({
          key,
          name,
          period: Number(period),
          credits: creditsIndex < 0 ? null : numeric(row[creditsIndex]),
          theoryHours: theoryIndex < 0 ? null : numeric(row[theoryIndex]),
          practiceHours: practiceIndex < 0 ? null : numeric(row[practiceIndex])
        });
      });
    }
    return subjects;
  }

  function identity(subject) {
    return normalizeText(subject?.key) || normalizeText(subject?.name);
  }

  function normalizedSubjectName(subject) {
    return normalizeText(subject?.name).replace(/[^a-z0-9]+/g, " ").trim();
  }

  function isComputing2004Plan({ career = "", plan = "" } = {}) {
    const normalizedCareer = normalizeText(career);
    const normalizedPlan = normalizeText(plan);
    return normalizedCareer.includes("ingenieria en computacion") && /(2003|2004)/.test(normalizedPlan);
  }

  const COMPUTING_2004_REQUIRED = Object.freeze({
    1: [
      "CALCULO DIFERENCIAL E INTEGRAL", "FISICA CLASICA", "FUNDAMENTOS DE PROGRAMACION",
      "HUMANIDADES I INGENERIA, CIENCIA Y SOCIEDAD", "FUNDAMENTOS DE ALGEBRA", "QUIMICA BASICA"
    ],
    2: [
      "ALGEBRA LINEAL", "CALCULO VECTORIAL", "ELECTRICIDAD Y MAGNETISMO",
      "MATEMATICAS DISCRETAS", "PROGRAMACION ORIENTADA A OBJETOS", "HUMANIDADES II: LA COMUNICACION Y LA ING."
    ],
    3: [
      "ECUACIONES DIFERENCIALES", "CIRCUITOS DE C.A. Y C.D.", "CIRCUITOS LOGICOS I",
      "LENGUAJES DE BAJO NIVEL", "ESTRUCTURA DE DATOS", "HUMANIDADES III DESARROLLO HUMANO"
    ],
    4: [
      "ANALISIS NUMERICO", "VARIABLE COMPLEJA Y ANALISIS DE FOURIER", "CIRCUITOS LOGICOS II",
      "ELECTRONICA ANALOGICA", "TEORIA DE AUTOMATAS", "HUMANIDADES IV:DES.PER.Y PROF."
    ],
    5: [
      "PROBABILIDAD Y ESTADISTICA", "ANALISIS DE SEÑALES ANALOGICAS", "ANALISIS DE ALGORITMOS",
      "COMPILADORES", "ORGANIZACION DE COMPUTADORAS", "HUMANIDADES V:EL HUM.FRENTE A LA GLOB."
    ],
    6: [
      "MODULACIÓN DIGITAL", "TEORIA DE CONTROL ANALÓGICO", "SISTEMAS OPERATIVOS",
      "ARQUITECTURA DE COMPUTADORAS", "INGENIERIA DE SOFTWARE", "MET. DE LA INV. O TOP.SELEC.DE LA ING.I"
    ],
    7: [
      "TEORIA DE LA INFORMACION Y CODIFICACION", "TEORIA DE CONTROL DIGITAL", "BASES DE DATOS",
      "NVAS. TEC. EN LA TRANSFER. DE INFOR.", "ADMINISTRACIÓN DE LA INGENERIA"
    ],
    8: [
      "REDES DE COMPUTADORAS", "SISTEMAS DISTRIBUIDOS", "FORMULACION Y EVALUACION DE PROYECTOS",
      "PROYECTO DE INGENIERIA"
    ]
  });

  const COMPUTING_2004_ELECTIVES = Object.freeze({
    7: [{ key: "computing-2004-elective-1", label: "Optativa I" }],
    8: [
      { key: "computing-2004-elective-2", label: "Optativa II" },
      { key: "computing-2004-elective-3", label: "Optativa III" }
    ]
  });

  function completeKnownPlan(periods = [], context = {}) {
    if (!isComputing2004Plan(context)) return periods;
    return periods.map((period) => {
      const number = Number(period.period);
      const subjects = [...(period.subjects || [])];
      const existingNames = new Set(subjects.map(normalizedSubjectName));
      (COMPUTING_2004_REQUIRED[number] || []).forEach((name) => {
        const subject = { key: "", name, period: number, credits: null, theoryHours: null, practiceHours: null, source: "official-plan" };
        if (!existingNames.has(normalizedSubjectName(subject))) subjects.push(subject);
      });
      (COMPUTING_2004_ELECTIVES[number] || []).forEach((slot) => {
        const hasAlternatives = subjects.some((subject) => subject.electiveSlot === slot.key
          || electiveDefinition(subject, context)?.key === slot.key);
        if (!hasAlternatives) {
          subjects.push({
            key: "",
            name: slot.label,
            period: number,
            credits: null,
            theoryHours: null,
            practiceHours: null,
            electiveSlot: slot.key,
            electiveLabel: slot.label,
            isElectivePlaceholder: true,
            source: "official-plan"
          });
        }
      });
      return { ...period, subjects };
    });
  }

  // El mapa oficial del plan 2003 (identificado como 2004 en SAES) exige una
  // elección por bloque, no aprobar cada alternativa publicada en Horarios.
  function electiveDefinition(subject, context) {
    if (!isComputing2004Plan(context)) return null;
    const key = normalizeText(subject?.key).replace(/[^a-z0-9]/g, "").toUpperCase();
    const name = normalizedSubjectName(subject);
    const period = Number(subject?.period);
    if (period === 7 && name === "optativa i") return { key: "computing-2004-elective-1", label: "Optativa I" };
    if (period === 8 && name === "optativa ii") return { key: "computing-2004-elective-2", label: "Optativa II" };
    if (period === 8 && name === "optativa iii") return { key: "computing-2004-elective-3", label: "Optativa III" };
    if (period === 7 && (/^CLA04[6-9]$|^CLA050$/.test(key)
      || /^(computo aplicado a sistemas ecologicos|sistemas de informacion|transferencia.*informacion|algoritmos de computo|interfases inteligentes) i$/.test(name))) {
      return { key: "computing-2004-elective-1", label: "Optativa I" };
    }
    if (period === 8 && (/^CLA05[1-5]$/.test(key)
      || /^(computo aplicado a sistemas ecologicos|sistemas de informacion|transferencia.*informacion|algoritmos de computo|interfases inteligentes) ii$/.test(name))) {
      return { key: "computing-2004-elective-2", label: "Optativa II" };
    }
    if (period === 8 && (/^CLA05[6-9]$|^CLA06[0-1]$/.test(key)
      || /^(redes neuronales|inteligencia artificial|programacion logica|diseno asistido por computadora|lenguajes para arquitectura en paralelo|sistemas expertos)$/.test(name))) {
      return { key: "computing-2004-elective-3", label: "Optativa III" };
    }
    return null;
  }

  function aggregateState(subjects = []) {
    if (subjects.some((subject) => subject.state === "approved")) return "approved";
    if (subjects.some((subject) => subject.state === "current")) return "current";
    if (subjects.some((subject) => subject.state === "failed")) return "failed";
    return "pending";
  }

  function requirementsFromSubjects(subjects = []) {
    const requirements = [];
    const electives = new Map();
    subjects.forEach((subject) => {
      if (!subject.electiveSlot) {
        requirements.push({ type: "subject", key: identity(subject), state: subject.state, subject });
        return;
      }
      let requirement = electives.get(subject.electiveSlot);
      if (!requirement) {
        requirement = {
          type: "elective",
          key: subject.electiveSlot,
          label: subject.electiveLabel || "Optativa",
          selectionCount: 1,
          subjects: []
        };
        electives.set(subject.electiveSlot, requirement);
        requirements.push(requirement);
      }
      requirement.subjects.push(subject);
    });
    requirements.forEach((requirement) => {
      if (requirement.type === "elective") requirement.state = aggregateState(requirement.subjects);
    });
    return requirements;
  }

  function recordOrder(record) {
    const date = Date.parse(record?.date || "");
    if (Number.isFinite(date)) return date;
    const parts = String(record?.period || "").match(/(\d{4})\D*(\d+)/);
    return parts ? Number(parts[1]) * 10 + Number(parts[2]) : 0;
  }

  function buildCurriculumModel({ periods = [], kardexRecords = [], currentSubjects = [], career = "", plan = "", creditProgress = null } = {}) {
    const recordsBySubject = new Map();
    kardexRecords.forEach((record) => {
      const identities = new Set([normalizeText(record?.key), normalizeText(record?.name)].filter(Boolean));
      identities.forEach((id) => {
        const records = recordsBySubject.get(id) || [];
        records.push(record);
        recordsBySubject.set(id, records);
      });
    });
    const current = new Set(currentSubjects.flatMap((subject) => [normalizeText(subject?.key), normalizeText(subject?.name)]).filter(Boolean));
    const completedPeriods = completeKnownPlan(periods, { career, plan });
    const modeledPeriods = completedPeriods.map((period) => {
      const subjects = (period.subjects || []).map((subject) => {
        const records = recordsBySubject.get(identity(subject)) || recordsBySubject.get(normalizeText(subject.name)) || [];
        const latest = records.slice().sort((left, right) => recordOrder(right) - recordOrder(left))[0] || null;
        const approved = records.some((record) => Number.isFinite(record.grade) && record.grade >= 6);
        const isCurrent = current.has(normalizeText(subject.key)) || current.has(normalizeText(subject.name));
        const failed = !approved && Number.isFinite(latest?.grade) && latest.grade < 6;
        const state = approved ? "approved" : isCurrent ? "current" : failed ? "failed" : "pending";
        const elective = subject.electiveSlot
          ? { key: subject.electiveSlot, label: subject.electiveLabel || "Optativa" }
          : electiveDefinition(subject, { career, plan });
        return {
          ...subject,
          state,
          latestResult: latest,
          ...(elective ? { electiveSlot: elective.key, electiveLabel: elective.label } : {})
        };
      });
      return { ...period, subjects, requirements: requirementsFromSubjects(subjects) };
    });

    let approvedCredits = 0;
    let totalCredits = 0;
    let approvedCount = 0;
    let subjectCount = 0;
    let electiveSlots = 0;
    modeledPeriods.forEach((period) => period.requirements.forEach((requirement) => {
      const candidates = requirement.type === "elective" ? requirement.subjects : [requirement.subject];
      const representative = candidates.find((subject) => subject.state === "approved")
        || candidates.find((subject) => subject.state === "current")
        || candidates.find((subject) => Number.isFinite(subject.credits))
        || candidates[0];
      const credits = Number.isFinite(representative?.credits) ? representative.credits : 0;
      totalCredits += credits;
      subjectCount += 1;
      if (requirement.type === "elective") electiveSlots += 1;
      if (requirement.state === "approved") {
        approvedCredits += credits;
        approvedCount += 1;
      }
    }));
    const denominator = totalCredits || subjectCount;
    const numerator = totalCredits ? approvedCredits : approvedCount;
    const earnedCredits = Number(creditProgress?.earnedCredits);
    const remainingCredits = Number(creditProgress?.remainingCredits);
    const officialCreditProgress = Number.isFinite(earnedCredits) && Number.isFinite(remainingCredits) && earnedCredits + remainingCredits > 0
      ? {
          earnedCredits,
          remainingCredits,
          totalCredits: earnedCredits + remainingCredits,
          progressPercent: Math.round((earnedCredits / (earnedCredits + remainingCredits)) * 100)
        }
      : null;
    return {
      periods: modeledPeriods,
      summary: {
        subjects: subjectCount,
        approved: approvedCount,
        electiveSlots,
        totalCredits,
        approvedCredits,
        progressPercent: denominator ? Math.round((numerator / denominator) * 100) : 0,
        officialCreditProgress
      }
    };
  }

  function filterCurriculumPeriods(periods = [], filter = "all") {
    if (filter === "all") return periods;
    return periods.map((period) => ({ ...period, subjects: (period.subjects || []).filter((subject) => subject.state === filter) }))
      .filter((period) => period.subjects.length);
  }

  function parseCurrentSchedule(document) {
    const subjects = new Map();
    for (const rows of tableRows(document)) {
      const headerIndex = rows.findIndex((row) => {
        const normalized = row.map(normalizeText);
        return normalized.some((cell) => cell === "grupo")
          && normalized.some((cell) => cell === "materia")
          && normalized.some((cell) => /(lunes|martes|miercoles|jueves|viernes)/.test(cell));
      });
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex];
      const nameIndex = column(headers, /^materia$/);
      rows.slice(headerIndex + 1).forEach((row) => {
        if (row.length !== headers.length) return;
        const raw = String(row[nameIndex] || "").trim();
        const match = raw.match(/^([A-Z]{1,5}\d{2,4})\s*-\s*(.+)$/i);
        const subject = {
          key: match?.[1] || "",
          name: (match?.[2] || raw).trim()
        };
        if (subject.name) subjects.set(identity(subject), subject);
      });
    }
    return [...subjects.values()];
  }

  function curriculumFromOfferings(offerings = [], { updatedAt = new Date().toISOString() } = {}) {
    const buckets = new Map(Array.from({ length: 8 }, (_, index) => [index + 1, new Map()]));
    offerings.forEach((offering) => {
      const period = Number(String(offering?.source?.period || "").match(/\d+/)?.[0]);
      if (!buckets.has(period) || !offering?.subject) return;
      const subject = {
        key: String(offering.key || "").trim(),
        name: String(offering.subject).trim(),
        period,
        credits: null,
        theoryHours: null,
        practiceHours: null
      };
      buckets.get(period).set(identity(subject), subject);
    });
    return {
      state: "ready",
      updatedAt,
      periods: [...buckets].map(([period, subjects]) => ({ period, state: "ready", updatedAt, subjects: [...subjects.values()] }))
    };
  }

  async function collectCurriculum({ fetchPeriod, previous = null, periodNumbers = [1, 2, 3, 4, 5, 6, 7, 8], now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
    if (typeof fetchPeriod !== "function") throw new TypeError("fetchPeriod es obligatorio");
    const previousPeriods = new Map((previous?.periods || []).map((period) => [Number(period.period), period]));
    const periods = [];
    let ready = 0;
    let failed = 0;
    for (let index = 0; index < periodNumbers.length; index += 1) {
      const period = Number(periodNumbers[index]);
      onProgress({ period, index, total: periodNumbers.length });
      try {
        const subjects = parseCurriculumPeriod(await fetchPeriod(period), period);
        if (!subjects.length) throw new Error("SAES no mostró materias curriculares compatibles");
        periods.push({ period, state: "ready", updatedAt: now(), subjects });
        ready += 1;
      } catch (error) {
        const saved = previousPeriods.get(period);
        periods.push(saved
          ? { ...saved, state: "stale", error: error?.message || "No se pudo actualizar" }
          : { period, state: "error", updatedAt: null, subjects: [], error: error?.message || "No se pudo actualizar" });
        failed += 1;
      }
    }
    return {
      state: failed ? ready || periods.some((period) => period.subjects.length) ? "partial" : "error" : "ready",
      updatedAt: ready ? now() : previous?.updatedAt || null,
      periods
    };
  }

  const api = Object.freeze({ buildCurriculumModel, collectCurriculum, completeKnownPlan, curriculumFromOfferings, filterCurriculumPeriods, normalizeText, parseCurrentSchedule, parseCurriculumPeriod, requirementsFromSubjects });
  globalScope.MISaesCurriculum = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
