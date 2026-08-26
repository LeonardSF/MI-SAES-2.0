(function initMiSaesCore(globalScope) {
  "use strict";

  const DAY_ALIASES = Object.freeze({
    lun: "Lunes",
    lunes: "Lunes",
    mar: "Martes",
    martes: "Martes",
    mie: "Miércoles",
    mié: "Miércoles",
    miercoles: "Miércoles",
    miércoles: "Miércoles",
    jue: "Jueves",
    jueves: "Jueves",
    vie: "Viernes",
    viernes: "Viernes",
    sab: "Sábado",
    sáb: "Sábado",
    sabado: "Sábado",
    sábado: "Sábado",
    dom: "Domingo",
    domingo: "Domingo"
  });

  const OCCUPANCY_REFRESH_MINUTES = Object.freeze([1, 2, 5, 10, 15]);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    hideStudentId: false,
    modules: {
      filters: true,
      schedule: true,
      trajectoryHome: false,
      evaluationAssist: true,
      notes: true,
      tools: true
    }
  });

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function mergeSettings(saved = {}) {
    const defaults = cloneDefaults();
    return {
      enabled: saved.enabled !== false,
      hideStudentId: saved.hideStudentId === true,
      modules: {
        ...defaults.modules,
        ...(saved.modules || {})
      }
    };
  }

  function applyStudentIdPrivacy(root, hidden) {
    const studentId = root?.querySelector?.("#ctl00_leftColumn_LoginNameSession");
    if (!studentId) return false;
    if (hidden) {
      if (!("misaesOriginalStudentId" in studentId.dataset)) {
        studentId.dataset.misaesOriginalStudentId = studentId.textContent;
      }
      studentId.textContent = "MI SAES 2.0";
      return true;
    }
    if ("misaesOriginalStudentId" in studentId.dataset) {
      studentId.textContent = studentId.dataset.misaesOriginalStudentId;
      delete studentId.dataset.misaesOriginalStudentId;
    }
    return true;
  }

  function normalizeOccupancyRefreshMinutes(value) {
    const minutes = Number(value);
    return OCCUPANCY_REFRESH_MINUTES.includes(minutes) ? minutes : 2;
  }

  function misProfesoresSearchUrl(teacherName) {
    const name = String(teacherName || "").trim();
    if (!name) return null;
    return `https://www.misprofesores.com/Buscar?${new URLSearchParams({ buscar: "Profesores", q: name })}`;
  }

  function schedulePageUrl(origin) {
    try {
      return new URL("/Academica/horarios.aspx", origin).href;
    } catch {
      return null;
    }
  }

  function shouldShowTrajectoryHome({ url = "", enabled = false, authenticated = false } = {}) {
    if (!enabled || !authenticated) return false;
    try {
      return /\/alumnos\/default\.aspx$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  function detectContext({ url = "", title = "", text = "", authenticated = false } = {}) {
    const normalizedUrl = normalizeText(url);
    const haystack = normalizeText(`${url} ${title} ${text}`);
    if (!authenticated && /(iniciar sesion|captcha|recuperar contrasena)/.test(haystack)) return "login";
    if (/\/academica\/horarios\.aspx/.test(normalizedUrl)) return "schedule";
    if (/\/academica\/ocupabilidad_grupos\.aspx/.test(normalizedUrl)) return "occupancy";
    if (/\/alumnos\/reinscripciones\//.test(normalizedUrl)) return "reenrollment";
    if (/(evaluacion[_-]*docente|evaluacion[_-]*profesor)/.test(normalizedUrl)) return "evaluation";
    if (/(evaluacion[_\s-]*docente|evaluacion[_\s-]*profesor)/.test(haystack)) return "evaluation";
    if (/(reinscripcion|reinscripciones|cita de reinscripcion)/.test(haystack)) return "reenrollment";
    if (/(ocupabilidad|cupo[s]?\b|lugares disponibles)/.test(haystack)) return "occupancy";
    if (/(horario[s]?\.aspx|horario de clase|mi horario)/.test(haystack)) return "schedule";
    if (/(calificaciones|kardex|boleta|trayectoria)/.test(haystack)) return "grades";
    return "general";
  }

  function parseTimeRange(value) {
    const normalized = normalizeText(value).replace(/\./g, ":");
    const match = normalized.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|a)\s*(\d{1,2})(?::(\d{2}))?(?:\s|$)/);
    if (!match) return null;
    const start = Number(match[1]) * 60 + Number(match[2] || 0);
    const end = Number(match[3]) * 60 + Number(match[4] || 0);
    if (start >= end || end > 24 * 60) return null;
    return { start, end };
  }

  function formatMinutes(total) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function canonicalDay(value) {
    return DAY_ALIASES[normalizeText(value)] || null;
  }

  function deriveScheduleEntries(tables = []) {
    const entries = [];
    tables.forEach((table, tableIndex) => {
      const headers = (table.headers || []).map(normalizeText);
      const dayColumns = headers
        .map((header, index) => ({ day: canonicalDay(header), index }))
        .filter((item) => item.day);

      if (dayColumns.length) {
        const subjectIndex = headers.findIndex((header) => /(materia|unidad de aprendizaje|asignatura)/.test(header));
        const groupIndex = headers.findIndex((header) => /grupo/.test(header));
        (table.rows || []).forEach((row, rowIndex) => {
          const rowRange = row.map(parseTimeRange).find(Boolean);
          dayColumns.forEach(({ day, index }) => {
            const cellValue = String(row[index] || "").trim();
            const range = parseTimeRange(cellValue) || rowRange;
            if (!cellValue || !range) return;
            const subject = String(row[subjectIndex] || "").trim();
            const group = String(row[groupIndex] || "").trim();
            const label = [subject, group].filter(Boolean).join(" · ") || cellValue;
            entries.push({
              day,
              start: range.start,
              end: range.end,
              label: label.replace(/\s+/g, " "),
              tableIndex,
              rowIndex
            });
          });
        });
        return;
      }

      const dayIndex = headers.findIndex((header) => header === "dia");
      const timeIndex = headers.findIndex((header) => /(hora|horario)/.test(header));
      const subjectIndex = headers.findIndex((header) => /(materia|unidad de aprendizaje|asignatura)/.test(header));
      if (dayIndex < 0 || timeIndex < 0) return;

      (table.rows || []).forEach((row, rowIndex) => {
        const day = canonicalDay(row[dayIndex]);
        const range = parseTimeRange(row[timeIndex]);
        if (!day || !range) return;
        entries.push({
          day,
          start: range.start,
          end: range.end,
          label: String(row[subjectIndex] || row.join(" · ")).trim(),
          tableIndex,
          rowIndex
        });
      });
    });
    return entries;
  }

  function findScheduleConflicts(entries = []) {
    const conflicts = [];
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const left = entries[i];
        const right = entries[j];
        if (left.day !== right.day) continue;
        if (left.start < right.end && right.start < left.end) {
          conflicts.push({ left, right });
        }
      }
    }
    return conflicts;
  }

  function deriveCourseOfferings(tables = []) {
    const offeringMap = new Map();
    tables.forEach((table, tableIndex) => {
      const headers = (table.headers || []).map(normalizeText);
      const groupIndex = headers.findIndex((header) => /grupo/.test(header));
      const subjectIndex = headers.findIndex((header) => /(materia|unidad de aprendizaje|asignatura)/.test(header));
      const teacherIndex = headers.findIndex((header) => /profesor|docente/.test(header));
      const dayColumns = headers
        .map((header, index) => ({ day: canonicalDay(header), index }))
        .filter((item) => item.day);
      if (groupIndex < 0 || subjectIndex < 0 || !dayColumns.length) return;

      (table.rows || []).forEach((row, rowIndex) => {
        const group = String(row[groupIndex] || "").trim();
        const subject = String(row[subjectIndex] || "").trim();
        if (!group || !subject) return;
        const teacher = teacherIndex >= 0 ? String(row[teacherIndex] || "").trim() : "";
        const entries = dayColumns.flatMap(({ day, index }) => {
          const range = parseTimeRange(row[index]);
          return range ? [{ day, ...range, label: `${subject} · ${group}`, tableIndex, rowIndex }] : [];
        });
        if (!entries.length) return;
        const id = `${normalizeText(group)}:${normalizeText(subject)}`;
        const existing = offeringMap.get(id);
        if (existing) {
          if (teacher && !existing.teachers.includes(teacher)) existing.teachers.push(teacher);
          existing.teacher = existing.teachers.join(" / ");
          existing.entries.push(...entries);
          existing.rowIndexes.push(rowIndex);
          return;
        }
        offeringMap.set(id, {
          id,
          group,
          subject,
          teacher,
          teachers: teacher ? [teacher] : [],
          entries,
          tableIndex,
          rowIndex,
          rowIndexes: [rowIndex]
        });
      });
    });
    return [...offeringMap.values()].map((offering) => {
      const seen = new Set();
      offering.entries = offering.entries.filter((entry) => {
        const key = `${entry.day}:${entry.start}:${entry.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return offering;
    });
  }

  function generateScheduleCombinations(offerings = [], limit = 30) {
    const groups = new Map();
    offerings.forEach((offering) => {
      const key = normalizeText(offering.subject);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(offering);
    });
    const subjects = [...groups.values()];
    const combinations = [];
    const max = Math.max(1, Math.min(100, Number(limit) || 30));

    function visit(subjectIndex, chosen, entries) {
      if (combinations.length >= max) return;
      if (subjectIndex >= subjects.length) {
        combinations.push({ offerings: chosen.slice(), entries: entries.slice() });
        return;
      }
      subjects[subjectIndex].forEach((offering) => {
        if (combinations.length >= max) return;
        const nextEntries = entries.concat(offering.entries || []);
        if (findScheduleConflicts(nextEntries).length) return;
        chosen.push(offering);
        visit(subjectIndex + 1, chosen, nextEntries);
        chosen.pop();
      });
    }

    if (subjects.length) visit(0, [], []);
    return combinations;
  }

  function escapeIcs(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function dateStamp(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
  }

  function scheduleToIcs(entries = [], { startDate, weeks = 18, calendarName = "MI SAES 2.0" } = {}) {
    const monday = new Date(`${startDate || ""}T00:00:00`);
    if (Number.isNaN(monday.getTime())) return null;
    const count = Math.max(1, Math.min(30, Number(weeks) || 18));
    const dayOffsets = { Lunes: 0, Martes: 1, "Miércoles": 2, Jueves: 3, Viernes: 4, "Sábado": 5, Domingo: 6 };
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MI SAES 2.0//Horario//ES",
      "CALSCALE:GREGORIAN",
      `X-WR-CALNAME:${escapeIcs(calendarName)}`
    ];
    entries.forEach((entry, index) => {
      const offset = dayOffsets[entry.day];
      if (offset === undefined) return;
      const eventDate = new Date(monday);
      eventDate.setDate(monday.getDate() + offset);
      const startHour = Math.floor(entry.start / 60);
      const startMinute = entry.start % 60;
      const endHour = Math.floor(entry.end / 60);
      const endMinute = entry.end % 60;
      const date = dateStamp(eventDate);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${date}-${entry.start}-${entry.end}-${index}@mi-saes.local`,
        `DTSTART:${date}T${String(startHour).padStart(2, "0")}${String(startMinute).padStart(2, "0")}00`,
        `DTEND:${date}T${String(endHour).padStart(2, "0")}${String(endMinute).padStart(2, "0")}00`,
        `RRULE:FREQ=WEEKLY;COUNT=${count}`,
        `SUMMARY:${escapeIcs(entry.label)}`,
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  }

  function filterRowIndexes(rows = [], query = "") {
    const needle = normalizeText(query);
    if (!needle) return rows.map((_, index) => index);
    const tokens = needle.split(" ").filter(Boolean);
    return rows.reduce((indexes, row, index) => {
      const haystack = normalizeText(Array.isArray(row) ? row.join(" ") : row);
      if (tokens.every((token) => haystack.includes(token))) indexes.push(index);
      return indexes;
    }, []);
  }

  function filterPlannerOfferings(offerings = [], {
    query = "",
    periods = new Set(),
    compatibleOnly = false,
    compatibleIds = new Set(),
    availableOnly = false,
    availableIds = new Set()
  } = {}) {
    const tokens = normalizeText(query).split(" ").filter(Boolean);
    return offerings.filter((offering) => {
      const haystack = normalizeText(`${offering.subject || ""} ${offering.group || ""} ${offering.teacher || ""} ${offering.source?.period || ""} ${offering.source?.shift || ""}`);
      if (tokens.length && !tokens.every((token) => haystack.includes(token))) return false;
      if (periods.size && !periods.has(String(offering.source?.period || ""))) return false;
      if (compatibleOnly && !compatibleIds.has(offering.id)) return false;
      if (availableOnly && !availableIds.has(offering.id)) return false;
      return true;
    });
  }

  function escapeCsvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function tableToCsv(table = {}) {
    const lines = [];
    if (table.headers?.length) lines.push(table.headers.map(escapeCsvCell).join(","));
    (table.rows || []).forEach((row) => lines.push(row.map(escapeCsvCell).join(",")));
    return `\uFEFF${lines.join("\n")}`;
  }

  function calculateAverage(values = []) {
    const numbers = values
      .flatMap((value) => String(value).split(/[\s,;|]+/))
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 10);
    if (!numbers.length) return null;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return {
      count: numbers.length,
      average: Math.round((total / numbers.length) * 100) / 100,
      minimum: Math.min(...numbers),
      maximum: Math.max(...numbers)
    };
  }

  const api = Object.freeze({
    DEFAULT_SETTINGS,
    OCCUPANCY_REFRESH_MINUTES,
    normalizeText,
    cloneDefaults,
    mergeSettings,
    normalizeOccupancyRefreshMinutes,
    applyStudentIdPrivacy,
    misProfesoresSearchUrl,
    schedulePageUrl,
    shouldShowTrajectoryHome,
    detectContext,
    parseTimeRange,
    formatMinutes,
    canonicalDay,
    deriveScheduleEntries,
    deriveCourseOfferings,
    generateScheduleCombinations,
    findScheduleConflicts,
    scheduleToIcs,
    filterRowIndexes,
    filterPlannerOfferings,
    tableToCsv,
    calculateAverage
  });

  globalScope.MISaesCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
