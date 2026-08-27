(function initMiSaesTrajectory(globalScope) {
  "use strict";

  const SOURCES = Object.freeze(["reenrollment", "status", "kardex"]);

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function toNumber(value) {
    const match = String(value ?? "").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function tableRowsFrom(document) {
    // Conservamos el límite de cada tabla: SAES anida tablas de navegación junto a las académicas.
    // Aplanarlas haría que una tabla decorativa pudiera contarse como materias o calificaciones.
    return [...(document?.querySelectorAll?.("table") || [])].map((table) => [...(table.rows || [])]
      .map((row) => [...(row.cells || [])].map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((row) => row.some(Boolean)));
  }

  function headerValueMap(document) {
    // Las métricas de reinscripción aparecen como una fila de TH seguida por una fila de TD.
    // Se relacionan por posición dentro de la misma tabla, nunca por el orden global del documento.
    const metrics = new Map();
    for (const table of [...(document?.querySelectorAll?.("table") || [])]) {
      const rows = [...(table.rows || [])];
      if (rows.length < 2) continue;
      const headers = [...(rows[0].cells || [])];
      const values = [...(rows[1].cells || [])];
      if (!headers.length || headers.length !== values.length) continue;
      headers.forEach((header, index) => {
        const label = normalizeText(header.textContent);
        if (label) metrics.set(label, String(values[index]?.textContent || "").trim());
      });
    }
    return metrics;
  }

  function metric(metrics, aliases) {
    const entry = [...metrics.entries()].find(([label]) => aliases.some((alias) => label === alias || label.includes(alias)));
    return entry ? toNumber(entry[1]) : null;
  }

  function parseReenrollment(document) {
    const metrics = headerValueMap(document);
    return {
      average: metric(metrics, ["promedio"]),
      failedSubjects: metric(metrics, ["materias reprobadas"]),
      earnedCredits: metric(metrics, ["total de creditos que has obtenido"]),
      remainingCredits: metric(metrics, ["total de creditos que te faltan obtener"]),
      periodsCompleted: metric(metrics, ["periodos escolares que cursaste"]),
      periodsAvailable: metric(metrics, ["periodos escolares disponibles para completar tu carrera"]),
      minimumLoad: metric(metrics, ["carga minima de creditos"]),
      mediumLoad: metric(metrics, ["carga media de creditos"]),
      maximumLoad: metric(metrics, ["carga maxima de creditos"]),
      authorizedLoad: metric(metrics, ["carga autorizada"])
    };
  }

  function findHeaderRow(rows, requiredHeaders) {
    return rows.findIndex((row) => {
      const normalized = row.map(normalizeText);
      return requiredHeaders.every((header) => normalized.some((cell) => cell.includes(header)));
    });
  }

  function parseKardex(document) {
    let records = 0;
    let gradesFromSix = 0;
    let gradesBelowSix = 0;
    let withoutNumericGrade = 0;
    const entries = [];

    // Cada semestre puede vivir en su propia tabla y repetir el encabezado del Kárdex.
    for (const rows of tableRowsFrom(document)) {
      const headerIndex = findHeaderRow(rows, ["materia", "calificacion"]);
      if (headerIndex < 0) continue;
      const header = rows[headerIndex];
      const normalizedHeaders = header.map(normalizeText);
      const gradeColumn = normalizedHeaders.findIndex((cell) => cell.includes("calificacion"));
      const keyColumn = normalizedHeaders.findIndex((cell) => /^(clave|codigo)$/.test(cell));
      const nameColumn = normalizedHeaders.findIndex((cell) => /(materia|unidad de aprendizaje|asignatura)/.test(cell));
      const periodColumn = normalizedHeaders.findIndex((cell) => cell.includes("periodo"));
      const attemptColumn = normalizedHeaders.findIndex((cell) => /(forma|tipo|evaluacion)/.test(cell));
      const dateColumn = normalizedHeaders.findIndex((cell) => cell.includes("fecha"));
      for (let dataIndex = headerIndex + 1; dataIndex < rows.length; dataIndex += 1) {
        const dataRow = rows[dataIndex];
        if (findHeaderRow([dataRow], ["materia", "calificacion"]) >= 0 || dataRow.length !== header.length) break;
        if (!dataRow.some(Boolean)) continue;
        records += 1;
        const grade = toNumber(dataRow[gradeColumn]);
        if (grade === null) withoutNumericGrade += 1;
        else if (grade >= 6) gradesFromSix += 1;
        else gradesBelowSix += 1;
        entries.push({
          key: keyColumn < 0 ? "" : dataRow[keyColumn],
          name: nameColumn < 0 ? "" : dataRow[nameColumn],
          period: periodColumn < 0 ? "" : dataRow[periodColumn],
          attempt: attemptColumn < 0 ? "" : dataRow[attemptColumn],
          date: dateColumn < 0 ? "" : dataRow[dateColumn],
          grade
        });
      }
    }

    return { records, gradesFromSix, gradesBelowSix, withoutNumericGrade, entries };
  }

  function parseGeneralStatus(document) {
    const rows = tableRowsFrom(document).find((tableRows) => findHeaderRow(tableRows, ["materia", "descripcion", "veces"]) >= 0);
    if (!rows) return { records: 0, repeatedRecords: 0 };
    const headerIndex = findHeaderRow(rows, ["materia", "descripcion", "veces"]);
    const headers = rows[headerIndex].map(normalizeText);
    const timesColumn = headers.findIndex((cell) => cell.includes("veces"));
    const dataRows = rows.slice(headerIndex + 1).filter((row) => row.length === headers.length && row.some(Boolean));
    return {
      records: dataRows.length,
      repeatedRecords: dataRows.filter((row) => (toNumber(row[timesColumn]) || 0) > 1).length
    };
  }

  function looksLikeLogin(document) {
    const text = normalizeText(document?.body?.textContent);
    return /iniciar sesion/.test(text) && /(captcha|password|contrasena)/.test(text);
  }

  function isCompatible(source, document) {
    // Un HTTP 200 no garantiza datos válidos: algunas versiones de SAES devuelven páginas de error con 200.
    // Validamos la estructura mínima antes de permitir que una fotografía se guarde como actualizada.
    const tables = tableRowsFrom(document);
    if (source === "reenrollment") {
      const headers = [...headerValueMap(document).keys()];
      return headers.some((label) => label.includes("total de creditos que has obtenido"))
        && headers.some((label) => label.includes("total de creditos que te faltan obtener"));
    }
    if (source === "status") return tables.some((rows) => findHeaderRow(rows, ["materia", "descripcion", "veces"]) >= 0);
    if (source === "kardex") return tables.some((rows) => findHeaderRow(rows, ["materia", "calificacion"]) >= 0);
    return false;
  }

  function progressPercent(reenrollment) {
    const earned = reenrollment?.earnedCredits;
    const remaining = reenrollment?.remainingCredits;
    if (!Number.isFinite(earned) || !Number.isFinite(remaining) || earned + remaining <= 0) return null;
    return Math.round((earned / (earned + remaining)) * 100);
  }

  async function collectTrajectory({ fetchPage, now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
    if (typeof fetchPage !== "function") throw new TypeError("fetchPage es obligatorio");
    const parsers = {
      reenrollment: parseReenrollment,
      status: parseGeneralStatus,
      kardex: parseKardex
    };
    const sources = {};
    const data = {};

    // Las consultas son deliberadamente secuenciales para no aumentar la carga sobre el SAES.
    for (let index = 0; index < SOURCES.length; index += 1) {
      const source = SOURCES[index];
      onProgress({ source, index, total: SOURCES.length });
      try {
        const document = await fetchPage(source);
        if (looksLikeLogin(document)) {
          SOURCES.forEach((name) => { sources[name] = "session-expired"; });
          return { state: "session-expired", sources, updatedAt: null, progressPercent: null };
        }
        if (!isCompatible(source, document)) {
          sources[source] = "incompatible";
          continue;
        }
        data[source] = parsers[source](document);
        sources[source] = "ready";
      } catch {
        sources[source] = "error";
      }
    }

    const readyCount = Object.values(sources).filter((state) => state === "ready").length;
    return {
      state: readyCount === SOURCES.length ? "ready" : readyCount ? "partial" : "error",
      sources,
      updatedAt: readyCount ? now() : null,
      progressPercent: progressPercent(data.reenrollment),
      ...data
    };
  }

  const api = Object.freeze({
    SOURCES,
    collectTrajectory,
    parseGeneralStatus,
    parseKardex,
    parseReenrollment,
    progressPercent,
    isCompatible
  });

  globalScope.MISaesTrajectory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
