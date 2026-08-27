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

  const RELEASES = Object.freeze({
    "0.13.0": Object.freeze({
      version: "0.13.0",
      title: "MI SAES se actualizó",
      items: Object.freeze([
        "Elige materias y acepta varios grupos como alternativas antes de generar tu horario.",
        "Compara horarios generados con métricas de días, horas de clase y tiempo libre.",
        "Consulta los lugares actuales por grupo directamente en el calendario.",
        "Descarga tu horario compacto como imagen PNG."
      ]),
      releaseUrl: "https://github.com/LeonardSF/MI-SAES-2.0/releases/tag/v0.13.0"
    }),
    "0.12.4": Object.freeze({
      version: "0.12.4",
      title: "MI SAES se actualizó",
      items: Object.freeze([
        "MI SAES conserva su tamaño aunque el portal use estilos tipográficos antiguos.",
        "El acceso público ahora indica claramente que debes iniciar sesión para continuar."
      ]),
      releaseUrl: "https://github.com/LeonardSF/MI-SAES-2.0/releases/tag/v0.12.4"
    }),
    "0.12.3": Object.freeze({
      version: "0.12.3",
      title: "MI SAES se actualizó",
      items: Object.freeze([
        "MI SAES 2.0 ahora es un proyecto de código abierto.",
        "El repositorio incluye guías para contribuir y reportar problemas con seguridad.",
        "Los ejemplos de SAES usan datos ficticios para proteger la privacidad.",
        "Mejoras de documentación para estudiantes y personas desarrolladoras."
      ]),
      releaseUrl: "https://github.com/LeonardSF/MI-SAES-2.0/releases/tag/v0.12.3"
    }),
    "0.12.2": Object.freeze({
      version: "0.12.2",
      title: "MI SAES se actualizó",
      items: Object.freeze([
        "Nuevo: Mi trayectoria, para consultar tu avance académico.",
        "Puedes mostrarla u ocultarla desde Mostrar Mi trayectoria.",
        "Nuevo icono de MI SAES en la cabecera.",
        "Mejoras en Arma tu Horario."
      ]),
      releaseUrl: "https://github.com/LeonardSF/MI-SAES-2.0/releases/tag/v0.12.2"
    })
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    hideStudentId: false,
    modules: {
      filters: true,
      schedule: true,
      trajectoryHome: true,
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
    const savedModules = saved.modules || {};
    return {
      enabled: saved.enabled !== false,
      hideStudentId: saved.hideStudentId === true,
      modules: Object.fromEntries(
        Object.entries(defaults.modules).map(([module, enabled]) => [
          module,
          module === "trajectoryHome" ? true : module in savedModules ? savedModules[module] : enabled
        ])
      )
    };
  }

  function releaseNotes(version) {
    const release = RELEASES[String(version || "")];
    if (!release) return null;
    return {
      version: release.version,
      title: release.title,
      items: [...release.items],
      releaseUrl: release.releaseUrl
    };
  }

  function releaseNoticeForInstall({ reason = "", previousVersion = "", currentVersion = "" } = {}) {
    if (reason !== "update" || !previousVersion || !releaseNotes(currentVersion)) return null;
    return { version: String(currentVersion), previousVersion: String(previousVersion) };
  }

  function launcherModel({ authenticated = false } = {}) {
    return authenticated
      ? {
          title: "MI SAES 2.0",
          message: "Arma tu horario sin empalmes",
          ariaLabel: "Abrir MI SAES 2.0: arma tu horario sin empalmes"
        }
      : {
          title: "MI SAES 2.0",
          message: "Inicia sesión para continuar",
          ariaLabel: "MI SAES 2.0: inicia sesión en SAES para continuar"
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

  function applyBannerBranding(root) {
    const banner = root?.querySelector?.("#banner");
    if (!banner) return false;
    if (banner.querySelector?.("[data-misaes-banner-brand]")) return true;

    const firstContentNode = Array.from(banner.childNodes || []).find(
      (node) => node.nodeType !== 3 || String(node.textContent || "").trim()
    );
    if (firstContentNode?.nodeName === "BR") banner.removeChild(firstContentNode);

    const documentRef = banner.ownerDocument || root;
    const lineBreak = documentRef.createElement("br");
    const brand = documentRef.createElement("span");
    brand.dataset.misaesBannerBrand = "true";
    brand.textContent = "MI SAES 2.0";
    banner.append(lineBreak, brand);
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

  function scheduleCatalogMatches(catalog = {}, selection = {}) {
    const expectedCareer = normalizeText(selection.careerLabel);
    const expectedPlan = normalizeText(selection.planLabel);
    const expectedMode = normalizeText(selection.modeLabel);
    const catalogCareer = normalizeText(catalog.career);
    const catalogPlan = normalizeText(catalog.plan || catalog.offerings?.[0]?.source?.plan);
    const catalogMode = normalizeText(catalog.mode || catalog.offerings?.[0]?.source?.mode);
    return (!expectedCareer || expectedCareer === catalogCareer)
      && (!expectedPlan || expectedPlan === catalogPlan)
      && (!expectedMode || expectedMode === catalogMode);
  }

  function shouldRenderSchedulePlanner({ authenticated = false, offeringsPage = false, context = "" } = {}) {
    return context !== "login" && (offeringsPage || authenticated);
  }

  async function clearScannedScheduleData(storage, { catalogKey, plannerKey, occupancyKey } = {}) {
    if (!storage?.remove) throw new Error("No se pudo acceder al almacenamiento de MI SAES.");
    const keys = [catalogKey, plannerKey, occupancyKey].filter(Boolean);
    await storage.remove(keys);
    return {
      scanCatalog: null,
      occupancyCatalog: null,
      plannerSelection: [],
      generatedSchedules: [],
      activeGeneratedSchedule: 0
    };
  }

  function shouldShowTrajectoryHome({ url = "", enabled = false, authenticated = false } = {}) {
    if (!enabled || !authenticated) return false;
    try {
      return /\/alumnos\/default\.aspx$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  function shouldEnhanceStudentHome({ url = "", enabled = false, authenticated = false } = {}) {
    if (!enabled || !authenticated) return false;
    try {
      return /\/alumnos\/default\.aspx$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  function officialStudentPhotoUrl(candidates = [], pageUrl = "") {
    let page;
    try {
      page = new URL(pageUrl);
    } catch {
      return null;
    }

    const ranked = candidates.flatMap((candidate, index) => {
      const source = String(candidate?.src || "").trim();
      if (!source) return [];
      const descriptor = normalizeText(`${candidate.id || ""} ${candidate.name || ""} ${candidate.alt || ""} ${candidate.className || ""} ${source}`);
      if (/(captcha|logo|slider|aviso|banner|correo|email|mapa|webresource|icon)/.test(descriptor)) return [];
      const hasPhotoSignal = /(foto|fotografia|alumno|perfil|credencial|pase[_\s/-]*digital)/.test(descriptor);
      if (!hasPhotoSignal) return [];

      try {
        const resolved = new URL(source, page);
        if (!/^https?:$/.test(resolved.protocol) || resolved.origin !== page.origin) return [];
        const score = /(foto|fotografia)/.test(descriptor) ? 3 : 2;
        return [{ url: resolved.href, score, index }];
      } catch {
        return [];
      }
    });

    ranked.sort((left, right) => right.score - left.score || left.index - right.index);
    return ranked[0]?.url || null;
  }

  function isSameOriginUrl(url, expectedOrigin) {
    try {
      return new URL(url).origin === new URL(expectedOrigin).origin;
    } catch {
      return false;
    }
  }

  function studentPhotoPageUrl(origin) {
    try {
      return new URL("/Alumnos/info_alumnos/Datos_Alumno.aspx", origin).href;
    } catch {
      return null;
    }
  }

  function studentGreetingModel(lines = []) {
    const values = lines.map((line) => String(line || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const greetingIndex = values.findIndex((line) => /^(buenos d[ií]as|buenas tardes|buenas noches)\b/i.test(line));
    const rawGreeting = greetingIndex >= 0 ? values[greetingIndex] : "";
    const name = values.slice(greetingIndex + 1).find((line) => !/men[uú] principal de alumnos/i.test(line)) || "Estudiante";
    const greeting = rawGreeting
      ? `${rawGreeting.charAt(0).toUpperCase()}${rawGreeting.slice(1).toLocaleLowerCase("es-MX")}`
      : "Bienvenido a tu espacio académico";
    return { greeting, name };
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

  function plannerSubjectGroups(offerings = [], selectedIds = new Set()) {
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    const groups = new Map();
    offerings.forEach((offering) => {
      const key = normalizeText(offering.subject);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, subject: offering.subject, selected: false, acceptedCount: 0, offerings: [] });
      const group = groups.get(key);
      group.offerings.push(offering);
      if (selected.has(offering.id)) group.acceptedCount += 1;
      group.selected = group.acceptedCount > 0;
    });
    return [...groups.values()];
  }

  function setPlannerSubjectSelected(offerings = [], selectedIds = new Set(), subject = "", enabled = true) {
    const selected = new Set(selectedIds || []);
    const key = normalizeText(subject);
    offerings.forEach((offering) => {
      if (normalizeText(offering.subject) !== key) return;
      if (enabled) selected.add(offering.id);
      else selected.delete(offering.id);
    });
    return selected;
  }

  function scheduleMetrics(entries = []) {
    const days = new Map();
    entries.forEach((entry) => {
      const day = String(entry?.day || "").trim();
      const start = Number(entry?.start);
      const end = Number(entry?.end);
      if (!day || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      if (!days.has(day)) days.set(day, []);
      days.get(day).push({ start, end });
    });

    let classMinutes = 0;
    let idleMinutes = 0;
    let earliestStart = null;
    let latestEnd = null;
    let longestDaySpan = 0;
    days.forEach((periods) => {
      periods.sort((left, right) => left.start - right.start || left.end - right.end);
      classMinutes += periods.reduce((total, period) => total + period.end - period.start, 0);
      const dayStart = periods[0].start;
      let previousEnd = periods[0].end;
      periods.slice(1).forEach((period) => {
        idleMinutes += Math.max(0, period.start - previousEnd);
        previousEnd = Math.max(previousEnd, period.end);
      });
      const dayEnd = Math.max(...periods.map((period) => period.end));
      earliestStart = earliestStart === null ? dayStart : Math.min(earliestStart, dayStart);
      latestEnd = latestEnd === null ? dayEnd : Math.max(latestEnd, dayEnd);
      longestDaySpan = Math.max(longestDaySpan, dayEnd - dayStart);
    });

    return {
      attendanceDays: days.size,
      classMinutes,
      idleMinutes,
      earliestStart,
      latestEnd,
      longestDaySpan
    };
  }

  function sortScheduleCombinations(schedules = [], criterion = "balanced") {
    const enriched = schedules.map((schedule, index) => ({
      ...schedule,
      metrics: scheduleMetrics(schedule.entries),
      __originalIndex: Number.isInteger(schedule.generationIndex) ? schedule.generationIndex : index
    }));
    const sortKeys = {
      balanced(metrics) {
        return [metrics.attendanceDays, metrics.idleMinutes, -(metrics.earliestStart ?? -Infinity), metrics.latestEnd ?? Infinity, metrics.longestDaySpan];
      },
      days(metrics) {
        return [metrics.attendanceDays, metrics.idleMinutes, -(metrics.earliestStart ?? -Infinity), metrics.latestEnd ?? Infinity];
      },
      gaps(metrics) {
        return [metrics.idleMinutes, metrics.attendanceDays, -(metrics.earliestStart ?? -Infinity), metrics.latestEnd ?? Infinity];
      },
      "late-start"(metrics) {
        return [-(metrics.earliestStart ?? -Infinity), metrics.attendanceDays, metrics.idleMinutes, metrics.latestEnd ?? Infinity];
      },
      "early-end"(metrics) {
        return [metrics.latestEnd ?? Infinity, metrics.attendanceDays, metrics.idleMinutes, -(metrics.earliestStart ?? -Infinity)];
      }
    };
    const keyFor = sortKeys[criterion] || sortKeys.balanced;
    enriched.sort((left, right) => {
      const leftKeys = keyFor(left.metrics);
      const rightKeys = keyFor(right.metrics);
      for (let index = 0; index < Math.max(leftKeys.length, rightKeys.length); index += 1) {
        if (leftKeys[index] !== rightKeys[index]) return leftKeys[index] - rightKeys[index];
      }
      return left.__originalIndex - right.__originalIndex;
    });
    return enriched.map(({ __originalIndex, ...schedule }) => schedule);
  }

  function plannerDiagnostics(selected = [], { blockedSubjects = [] } = {}) {
    if (!selected.length) {
      return {
        state: "empty",
        title: "Selecciona las materias que quieres cursar",
        detail: "Al elegir una materia aceptaremos inicialmente todos sus grupos.",
        conflicts: [],
        blockedSubjects: []
      };
    }

    const blocked = [...new Set(blockedSubjects.map(normalizeText).filter(Boolean))];
    const conflicts = findScheduleConflicts(selected.flatMap((offering) => offering.entries || []))
      .map((conflict) => ({
        ...conflict,
        leftOffering: selected.find((offering) => (offering.entries || []).includes(conflict.left)) || null,
        rightOffering: selected.find((offering) => (offering.entries || []).includes(conflict.right)) || null
      }))
      .filter((conflict) => !conflict.leftOffering || !conflict.rightOffering
        || normalizeText(conflict.leftOffering.subject) !== normalizeText(conflict.rightOffering.subject));

    if (blocked.length) {
      return {
        state: "blocked",
        title: blocked.length === 1 ? "Falta una alternativa con lugares" : `Faltan alternativas con lugares para ${blocked.length} materias`,
        detail: "Los grupos llenos no se incluirán. Elige al menos una alternativa disponible por materia.",
        conflicts,
        blockedSubjects: blocked
      };
    }

    if (conflicts.length) {
      return {
        state: "conflict",
        title: `${conflicts.length} traslape${conflicts.length === 1 ? "" : "s"} por resolver`,
        detail: "Quita un grupo o agrega otra alternativa; el generador intentará evitar estos cruces.",
        conflicts,
        blockedSubjects: []
      };
    }

    return {
      state: "ready",
      title: "Selección lista para generar",
      detail: "No detectamos traslapes entre tus candidatos.",
      conflicts: [],
      blockedSubjects: []
    };
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

  function generatedScheduleCopy(count, index = 0) {
    const total = Math.max(0, Number(count) || 0);
    return {
      title: `${total} horario${total === 1 ? "" : "s"} sin empalmes`,
      option: `Horario ${Math.max(0, Number(index) || 0) + 1}`
    };
  }

  function countLabel(count, singular, plural) {
    const total = Math.max(0, Number(count) || 0);
    return `${total} ${total === 1 ? singular : plural}`;
  }

  const api = Object.freeze({
    DEFAULT_SETTINGS,
    OCCUPANCY_REFRESH_MINUTES,
    normalizeText,
    cloneDefaults,
    mergeSettings,
    releaseNotes,
    releaseNoticeForInstall,
    launcherModel,
    normalizeOccupancyRefreshMinutes,
    applyStudentIdPrivacy,
    applyBannerBranding,
    misProfesoresSearchUrl,
    schedulePageUrl,
    scheduleCatalogMatches,
    shouldRenderSchedulePlanner,
    clearScannedScheduleData,
    shouldShowTrajectoryHome,
    shouldEnhanceStudentHome,
    officialStudentPhotoUrl,
    isSameOriginUrl,
    studentPhotoPageUrl,
    studentGreetingModel,
    detectContext,
    parseTimeRange,
    formatMinutes,
    canonicalDay,
    deriveScheduleEntries,
    deriveCourseOfferings,
    generateScheduleCombinations,
    plannerSubjectGroups,
    setPlannerSubjectSelected,
    scheduleMetrics,
    sortScheduleCombinations,
    plannerDiagnostics,
    findScheduleConflicts,
    scheduleToIcs,
    filterRowIndexes,
    filterPlannerOfferings,
    tableToCsv,
    calculateAverage,
    countLabel,
    generatedScheduleCopy
  });

  globalScope.MISaesCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
