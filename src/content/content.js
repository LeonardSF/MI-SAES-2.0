(async function bootMiSaes() {
  "use strict";

  const core = globalThis.MISaesCore;
  const trajectory = globalThis.MISaesTrajectory;
  const trajectoryView = globalThis.MISaesTrajectoryView;
  if (!core || !trajectory || !trajectoryView || document.getElementById("misaes-root")) return;

  const pageText = document.body?.innerText?.slice(0, 16000) || "";
  const normalizedPage = core.normalizeText(`${document.title} ${pageText}`);
  const isLocalPreview = ["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).has("misaes-preview");
  const looksLikeSaes = (location.hostname.endsWith(".ipn.mx") || isLocalPreview) && (
    location.hostname.includes("saes") ||
    isLocalPreview ||
    normalizedPage.includes("sistema de administracion escolar") ||
    normalizedPage.includes("saes")
  );
  if (!looksLikeSaes) return;

  const hasAuthenticatedSession = Boolean(
    document.getElementById("ctl00_leftColumn_LoginNameSession") ||
    document.getElementById("ctl00_leftColumn_LoginStatusSession")
  );
  const context = core.detectContext({
    url: location.href,
    title: document.title,
    text: pageText.slice(0, 5000),
    authenticated: hasAuthenticatedSession
  });
  const contextNames = {
    login: "Inicio de sesión",
    schedule: "Horario",
    occupancy: "Ocupabilidad",
    evaluation: "Evaluación docente",
    reenrollment: "Reinscripción",
    grades: "Calificaciones",
    general: "SAES"
  };

  const storage = {
    async get(keys) {
      return chrome.storage.local.get(keys);
    },
    async set(value) {
      return chrome.storage.local.set(value);
    }
  };

  const plannerKey = `planner:${location.origin}:${location.pathname}`;
  const catalogKey = `catalog:${location.origin}:schedule`;
  const preparedKey = `prepared:${location.origin}:schedule`;
  const occupancyKey = `occupancy:${location.origin}:schedule`;
  const occupancyPreferenceKey = `occupancy-enabled:${location.origin}`;
  const occupancyRefreshPreferenceKey = `occupancy-refresh-minutes:${location.origin}`;
  const trajectoryKey = `trajectory:${location.origin}`;
  const storedState = await storage.get(["settings", plannerKey, catalogKey, preparedKey, occupancyKey, occupancyPreferenceKey, occupancyRefreshPreferenceKey, trajectoryKey]);
  const savedSettings = storedState.settings || {};
  let settings = core.mergeSettings(savedSettings);
  let tableModels = [];
  let scheduleEntries = [];
  let courseOfferings = [];
  let scanCatalog = storedState[catalogKey]?.offerings?.length ? storedState[catalogKey] : null;
  let preparedSchedule = storedState[preparedKey]?.offerings?.length ? storedState[preparedKey] : null;
  let occupancyCatalog = storedState[occupancyKey]?.records?.length ? storedState[occupancyKey] : null;
  let occupancyEnabled = storedState[occupancyPreferenceKey] === true;
  let occupancyRefreshMinutes = core.normalizeOccupancyRefreshMinutes(storedState[occupancyRefreshPreferenceKey]);
  let trajectorySnapshot = storedState[trajectoryKey]?.updatedAt ? storedState[trajectoryKey] : null;
  let trajectoryActivity = null;
  let trajectoryController = null;
  let trajectoryHomeHost = null;
  let occupancyController = null;
  let occupancyTimer = 0;
  let refreshOccupancyView = null;
  let visibleCareer = "";
  let visiblePlan = "";
  let catalogMatchesPage = true;
  let scanController = null;
  let conflicts = [];
  let plannerSelection = new Set(Array.isArray(storedState[plannerKey]) ? storedState[plannerKey] : []);
  let generatedSchedules = [];
  let activeGeneratedSchedule = 0;
  const isOfferingsCatalog = /\/academica\/horarios\.aspx$/i.test(location.pathname) || (isLocalPreview && /\/saes-schedule\.html$/i.test(location.pathname));
  const isReenrollmentPage = /\/alumnos\/reinscripciones\//i.test(location.pathname) || context === "reenrollment";
  const extensionVersion = chrome.runtime.getManifest?.().version || "0.9.3";
  let isOpen = false;
  let activeView = "schedule";
  let previousFocus = null;
  const bodyWasInert = document.body.inert;
  let evaluationUndo = [];
  let noteSaveTimer = 0;

  const host = document.createElement("div");
  host.id = "misaes-root";
  host.setAttribute("aria-label", "MI SAES 2.0");
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("src/content/content.css");
  shadow.append(stylesheet);

  const app = document.createElement("div");
  app.className = "ms-app";
  app.dataset.open = "false";
  app.innerHTML = `
    <button class="ms-launcher" type="button" aria-label="Abrir MI SAES 2.0" aria-expanded="false">
      <span class="ms-launcher__mark" aria-hidden="true">MI</span>
      <span class="ms-launcher__dot" aria-hidden="true"></span>
    </button>
    <button class="ms-backdrop" type="button" aria-label="Cerrar panel"></button>
    <section class="ms-panel" role="dialog" aria-modal="true" aria-labelledby="ms-title" aria-hidden="true">
      <header class="ms-panel__header">
        <div class="ms-brand">
          <h1 class="ms-brand__name" id="ms-title">MI SAES 2.0</h1>
          <p class="ms-brand__context"></p>
        </div>
        <button class="ms-icon-button" type="button" data-action="close" aria-label="Cerrar MI SAES 2.0">
          <svg class="ms-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </header>
      <main class="ms-panel__body">
        <div class="ms-view" id="ms-view"></div>
      </main>
      <footer class="ms-panel__footer">
        <span class="ms-panel__privacy">Datos sólo en este navegador</span>
        <a class="ms-panel__credit" href="https://www.facebook.com/Le0nardSF" target="_blank" rel="noopener noreferrer">Creado por LeonardSF</a>
        <span class="ms-panel__shortcut"><kbd class="ms-kbd">Alt</kbd> + <kbd class="ms-kbd">M</kbd></span>
      </footer>
    </section>
    <p class="ms-live" aria-live="polite" aria-atomic="true"></p>
  `;
  shadow.append(app);
  document.documentElement.append(host);

  const launcher = shadow.querySelector(".ms-launcher");
  const backdrop = shadow.querySelector(".ms-backdrop");
  const panel = shadow.querySelector(".ms-panel");
  const panelBody = shadow.querySelector(".ms-panel__body");
  const view = shadow.querySelector(".ms-view");
  const live = shadow.querySelector(".ms-live");
  shadow.querySelector(".ms-brand__context").textContent = `${contextNames[context]} · ${location.hostname} · v${extensionVersion}`;

  function collectTables() {
    syncScheduleAvailabilityColumn();
    document.querySelectorAll("[data-misaes-data-table]").forEach((table) => delete table.dataset.misaesDataTable);
    document.querySelectorAll("[data-misaes-table-viewport]").forEach((container) => delete container.dataset.misaesTableViewport);
    tableModels = [...document.querySelectorAll("table")]
      .filter((table) => !host.contains(table))
      .map((element) => {
        const rowElements = [...element.querySelectorAll("tr")];
        if (rowElements.length < 2) return null;
        const matrix = rowElements.map((row) => [...row.querySelectorAll(":scope > th, :scope > td")]
          .map((cell) => cell.innerText.replace(/\s+/g, " ").trim()));
        const widest = Math.max(0, ...matrix.map((row) => row.length));
        if (widest < 2) return null;
        const hasSemanticHeader = rowElements[0].querySelector("th") !== null;
        const firstRowLooksLikeHeader = matrix[0].some((cell) => /(materia|grupo|profesor|lunes|horario|cupo|calificacion|dia)/i.test(cell));
        const usesHeader = hasSemanticHeader || firstRowLooksLikeHeader;
        const headers = usesHeader ? matrix[0] : matrix[0].map((_, index) => `Columna ${index + 1}`);
        const academicSignals = headers.filter((header) => /(grupo|asignatura|materia|profesor|edificio|sal[oó]n|lun|mar|mi[eé]|jue|vie|s[aá]b|calificaci[oó]n|cupo)/i.test(header));
        if (academicSignals.length >= 3) {
          element.dataset.misaesDataTable = "true";
          if (element.parentElement && element.parentElement !== document.body) {
            element.parentElement.dataset.misaesTableViewport = "true";
          }
        }
        return {
          element,
          headers,
          rows: usesHeader ? matrix.slice(1) : matrix,
          rowElements: usesHeader ? rowElements.slice(1) : rowElements
        };
      })
      .filter(Boolean);
    linkTeacherColumns();
    scheduleEntries = core.deriveScheduleEntries(tableModels);
    const visibleOfferings = core.deriveCourseOfferings(tableModels);
    const pageControls = globalThis.MISaesScanner?.discoverControls(document) || {};
    const careerControl = pageControls.career;
    visibleCareer = careerControl?.selectedOptions?.[0]?.textContent?.trim() || "";
    visiblePlan = pageControls.plan?.selectedOptions?.[0]?.textContent?.trim() || "";
    catalogMatchesPage = !scanCatalog || !visibleCareer || core.normalizeText(scanCatalog.career) === core.normalizeText(visibleCareer);
    courseOfferings = scanCatalog?.offerings?.length && catalogMatchesPage ? scanCatalog.offerings : visibleOfferings;
    conflicts = isOfferingsCatalog ? [] : core.findScheduleConflicts(scheduleEntries);
  }

  function linkTeacherColumns() {
    tableModels.forEach((table) => {
      const teacherIndex = table.headers.findIndex((header) => /profesor|docente/i.test(header));
      if (teacherIndex < 0) return;
      table.rowElements.forEach((row) => {
        const cell = row.cells?.[teacherIndex];
        if (!cell || cell.querySelector("a")) return;
        const teacherName = cell.textContent.replace(/\s+/g, " ").trim();
        const href = core.misProfesoresSearchUrl(teacherName);
        if (!href) return;
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.dataset.misaesTeacherLink = "true";
        link.textContent = teacherName;
        link.setAttribute("aria-label", `Buscar opiniones de ${teacherName} en MisProfesores`);
        cell.replaceChildren(link);
      });
    });
  }

  function applySettings() {
    if (!settings.enabled && isOpen) setOpen(false);
    host.hidden = !settings.enabled;
    core.applyStudentIdPrivacy(document, settings.enabled && settings.hideStudentId);
    syncTrajectoryHome();
  }

  function announce(message) {
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = message; });
  }

  function occupancyFor(offering) {
    if (!occupancyEnabled || !occupancyCatalog?.records?.length) return null;
    return globalThis.MISaesOccupancy?.findRecord(occupancyCatalog.records, offering) || null;
  }

  function syncScheduleAvailabilityColumn() {
    const cells = document.querySelectorAll("[data-misaes-availability-column]");
    if (!isOfferingsCatalog || !occupancyEnabled) {
      cells.forEach((cell) => cell.remove());
      return;
    }

    [...document.querySelectorAll("table")].filter((table) => !host.contains(table)).forEach((table) => {
      const rows = [...table.rows];
      if (rows.length < 2) return;
      const headers = [...rows[0].cells].map((cell) => core.normalizeText(cell.textContent));
      const groupIndex = headers.findIndex((header) => /^grupo$/.test(header));
      const subjectIndex = headers.findIndex((header) => /^(asignatura|materia)$/.test(header));
      const roomIndex = headers.findIndex((header) => /^salon$/.test(header));
      if (groupIndex < 0 || subjectIndex < 0 || roomIndex < 0) return;

      let headerCell = rows[0].querySelector('[data-misaes-availability-column="header"]');
      if (!headerCell) {
        headerCell = document.createElement("th");
        headerCell.dataset.misaesAvailabilityColumn = "header";
        headerCell.scope = "col";
        headerCell.textContent = "Lugares";
        rows[0].insertBefore(headerCell, rows[0].cells[roomIndex + 1] || null);
      }

      rows.slice(1).forEach((row) => {
        const group = row.cells[groupIndex]?.textContent?.trim() || "";
        const subject = row.cells[subjectIndex]?.textContent?.trim() || "";
        let cell = row.querySelector('[data-misaes-availability-column="cell"]');
        if (!cell) {
          cell = document.createElement("td");
          cell.dataset.misaesAvailabilityColumn = "cell";
          row.insertBefore(cell, row.cells[roomIndex + 1] || null);
        }
        const record = occupancyFor({ group, subject });
        cell.textContent = record ? String(record.available) : "—";
        cell.setAttribute("aria-label", record ? `${record.available} lugares disponibles` : "Lugares no disponibles");
      });
    });
  }

  function occupancyUrl() {
    return isLocalPreview
      ? new URL("/tests/fixtures/saes-occupancy.html", location.href).href
      : new URL("/Academica/Ocupabilidad_grupos.aspx", location.origin).href;
  }

  function occupancyRefreshInterval() {
    return occupancyRefreshMinutes * 60 * 1000;
  }

  function scheduleOccupancyRefresh(delay = occupancyRefreshInterval()) {
    clearTimeout(occupancyTimer);
    if (!occupancyEnabled) return;
    occupancyTimer = window.setTimeout(() => refreshOccupancy().catch(() => {}), delay);
  }

  async function refreshOccupancy({ force = false } = {}) {
    if (!occupancyEnabled || occupancyController || !globalThis.MISaesOccupancy) return;
    const age = occupancyCatalog?.updatedAt ? Date.now() - new Date(occupancyCatalog.updatedAt).getTime() : Infinity;
    const interval = occupancyRefreshInterval();
    if (!force && age < interval) {
      scheduleOccupancyRefresh(interval - age);
      return;
    }
    occupancyController = new AbortController();
    refreshOccupancyView?.({ state: "loading" });
    try {
      const result = await globalThis.MISaesOccupancy.scan({
        url: occupancyUrl(),
        career: scanCatalog?.career || visibleCareer,
        plan: visiblePlan || scanCatalog?.offerings?.find((item) => item.source?.plan)?.source?.plan || "",
        signal: occupancyController.signal
      });
      occupancyCatalog = result;
      await storage.set({ [occupancyKey]: result });
      syncScheduleAvailabilityColumn();
      refreshOccupancyView?.({ state: "ready" });
      announce(`Ocupabilidad actualizada: ${result.records.length} grupos`);
    } catch (error) {
      if (error?.name !== "AbortError") {
        refreshOccupancyView?.({ state: "error", message: error?.message || "No fue posible actualizar los lugares." });
        announce(error?.message || "No fue posible actualizar la ocupabilidad");
      }
    } finally {
      occupancyController = null;
      scheduleOccupancyRefresh();
    }
  }

  async function setOccupancyEnabled(nextEnabled) {
    occupancyEnabled = Boolean(nextEnabled);
    syncScheduleAvailabilityColumn();
    await storage.set({ [occupancyPreferenceKey]: occupancyEnabled });
    if (!occupancyEnabled) {
      clearTimeout(occupancyTimer);
      occupancyController?.abort();
      occupancyController = null;
      refreshOccupancyView?.({ state: "disabled" });
      announce("Actualización de lugares desactivada");
      return;
    }
    announce("Actualización de lugares activada");
    refreshOccupancy({ force: true }).catch(() => {});
  }

  async function setOccupancyRefreshMinutes(nextMinutes) {
    occupancyRefreshMinutes = core.normalizeOccupancyRefreshMinutes(nextMinutes);
    await storage.set({ [occupancyRefreshPreferenceKey]: occupancyRefreshMinutes });
    if (occupancyEnabled) refreshOccupancy().catch(() => {});
    announce(`Lugares se actualizarán cada ${occupancyRefreshMinutes} minutos`);
  }

  function setOpen(nextOpen) {
    if (!settings.enabled && nextOpen) return;
    isOpen = Boolean(nextOpen);
    app.dataset.open = String(isOpen);
    launcher.setAttribute("aria-expanded", String(isOpen));
    panel.setAttribute("aria-hidden", String(!isOpen));
    if (isOpen) {
      previousFocus = document.activeElement;
      document.body.inert = true;
      collectTables();
      renderView();
      requestAnimationFrame(() => shadow.querySelector('[data-action="close"]')?.focus());
    } else {
      document.body.inert = bodyWasInert;
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    }
  }

  function stat(label, value) {
    const card = document.createElement("div");
    card.className = "ms-stat";
    const valueElement = document.createElement("strong");
    valueElement.className = "ms-stat__value";
    valueElement.textContent = String(value);
    const labelElement = document.createElement("span");
    labelElement.className = "ms-stat__label";
    labelElement.textContent = label;
    card.append(valueElement, labelElement);
    return card;
  }

  function makeEmpty(title, detail) {
    const empty = document.createElement("div");
    empty.className = "ms-empty";
    empty.innerHTML = `<svg class="ms-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`;
    const strong = document.createElement("strong");
    strong.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.className = "ms-helper";
    paragraph.textContent = detail;
    empty.append(strong, paragraph);
    return empty;
  }

  function renderOverview() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = context === "login" ? "Tu SAES, sin ruido" : "Herramientas para esta página";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = context === "login"
      ? "MI SAES añade herramientas después de que tú inicies sesión. Nunca lee ni guarda tu contraseña o CAPTCHA."
      : "MI SAES trabaja sobre lo que ya está visible y conserva tus preferencias sólo en Chrome.";
    const stats = document.createElement("div");
    stats.className = "ms-stat-grid";
    const rowCount = tableModels.reduce((total, table) => total + table.rows.length, 0);
    stats.append(
      stat("Sección", contextNames[context]),
      stat("Tablas", tableModels.length),
      stat("Registros", rowCount),
      stat("Empalmes", isOfferingsCatalog ? "—" : conflicts.length)
    );
    view.append(heading, lede, stats);

    const section = document.createElement("section");
    section.className = "ms-section";
    const title = document.createElement("h3");
    title.className = "ms-section__title";
    title.textContent = "Acciones rápidas";
    const row = document.createElement("div");
    row.className = "ms-row";
    const available = [
      ["Buscar tablas", "tables", settings.modules.filters],
      [isOfferingsCatalog ? "Armar horario" : isReenrollmentPage ? "Ver horario preparado" : "Revisar horario", "schedule", settings.modules.schedule],
      ["Abrir notas", "notes", settings.modules.notes],
      [context === "evaluation" ? "Asistir evaluación" : "Calcular promedio", "tools", settings.modules.tools || settings.modules.evaluationAssist]
    ];
    available.filter(([, , enabled]) => enabled).forEach(([label, target]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ms-button";
      button.textContent = label;
      button.addEventListener("click", () => setView(target));
      row.append(button);
    });
    section.append(title, row);
    view.append(section);
  }

  function restoreFilteredRows() {
    tableModels.forEach((table) => table.rowElements.forEach((row) => delete row.dataset.misaesFiltered));
  }

  function renderTables() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Encuentra un registro";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Filtra al mismo tiempo por materia, profesor, grupo o cualquier texto visible.";
    view.append(heading, lede);

    if (!tableModels.length) {
      view.append(makeEmpty("No hay tablas útiles en esta vista", "Abre Horario, Ocupabilidad o Calificaciones y vuelve a intentarlo."));
      return;
    }

    const section = document.createElement("section");
    section.className = "ms-section";
    const field = document.createElement("label");
    field.className = "ms-field";
    field.innerHTML = `<span class="ms-label">Buscar en las tablas</span>`;
    const input = document.createElement("input");
    input.className = "ms-input";
    input.type = "search";
    input.placeholder = "Ejemplo: cálculo 3CV2";
    input.autocomplete = "off";
    const helper = document.createElement("span");
    helper.className = "ms-helper";
    helper.textContent = "Escribe dos o más palabras para combinar filtros.";
    field.append(input, helper);

    let debounce = 0;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        let visible = 0;
        tableModels.forEach((table) => {
          const matches = new Set(core.filterRowIndexes(table.rows, input.value));
          table.rowElements.forEach((row, index) => {
            if (matches.has(index)) {
              delete row.dataset.misaesFiltered;
              visible += 1;
            } else {
              row.dataset.misaesFiltered = "true";
            }
          });
        });
        helper.textContent = input.value ? `${visible} registros coinciden.` : "Escribe dos o más palabras para combinar filtros.";
        announce(helper.textContent);
      }, 250);
    });

    const actions = document.createElement("div");
    actions.className = "ms-row";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ms-button";
    clear.textContent = "Limpiar filtro";
    clear.addEventListener("click", () => {
      input.value = "";
      restoreFilteredRows();
      helper.textContent = "Filtro eliminado.";
      input.focus();
      announce("Filtro eliminado");
    });
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ms-button ms-button--primary";
    exportButton.textContent = "Exportar CSV";
    exportButton.addEventListener("click", () => exportLargestTable(exportButton));
    actions.append(clear, exportButton);
    section.append(field, actions);
    view.append(section);
  }

  function exportLargestTable(button) {
    const table = [...tableModels].sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!table) return;
    button.dataset.state = "loading";
    button.textContent = "Preparando";
    const blob = new Blob([core.tableToCsv(table)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mi-saes-${context}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    delete button.dataset.state;
    button.dataset.state = "success";
    button.textContent = "CSV exportado ✓";
    announce("Tabla exportada como CSV");
    setTimeout(() => {
      delete button.dataset.state;
      button.textContent = "Exportar CSV";
    }, 2500);
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function defaultMonday() {
    const date = new Date();
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatOfferingTimes(offering) {
    const shortDays = { Lunes: "Lun", Martes: "Mar", "Miércoles": "Mié", Jueves: "Jue", Viernes: "Vie", "Sábado": "Sáb", Domingo: "Dom" };
    return (offering.entries || [])
      .map((entry) => `${shortDays[entry.day]} ${core.formatMinutes(entry.start)}–${core.formatMinutes(entry.end)}`)
      .join(" · ");
  }

  function conflictWindow(conflict) {
    return {
      day: conflict.left.day,
      start: Math.max(conflict.left.start, conflict.right.start),
      end: Math.min(conflict.left.end, conflict.right.end)
    };
  }

  function formatConflictWindow(conflict, { compact = false } = {}) {
    const window = conflictWindow(conflict);
    const day = compact ? window.day.slice(0, 3) : window.day;
    return `${day} ${core.formatMinutes(window.start)}–${core.formatMinutes(window.end)}`;
  }

  function calendarLanes(entries, days) {
    const layouts = new Map();
    const laneCounts = new Map();
    days.forEach((day) => {
      const dayEntries = entries
        .filter((entry) => entry.day === day)
        .sort((left, right) => left.start - right.start || left.end - right.end);
      const laneEnds = [];
      dayEntries.forEach((entry) => {
        let lane = laneEnds.findIndex((end) => end <= entry.start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = entry.end;
        layouts.set(entry, { lane, overlaps: dayEntries.some((other) => other !== entry && entry.start < other.end && other.start < entry.end) });
      });
      laneCounts.set(day, Math.max(1, laneEnds.length));
    });
    return { layouts, laneCounts };
  }

  function buildCalendarGrid(entries, conflictingEntries = new Set()) {
    const wrapper = document.createElement("div");
    wrapper.className = "ms-calendar-scroll";
    const grid = document.createElement("div");
    grid.className = "ms-calendar";
    const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const days = dayOrder.filter((day) => entries.some((entry) => entry.day === day));
    const { layouts, laneCounts } = calendarLanes(entries, days);
    const dayStarts = new Map();
    let nextColumn = 2;
    days.forEach((day) => {
      dayStarts.set(day, nextColumn);
      nextColumn += laneCounts.get(day);
    });
    const earliest = Math.floor(Math.min(...entries.map((entry) => entry.start)) / 30) * 30;
    const latest = Math.ceil(Math.max(...entries.map((entry) => entry.end)) / 30) * 30;
    const slots = Math.max(1, (latest - earliest) / 30);
    const laneTotal = [...laneCounts.values()].reduce((total, count) => total + count, 0);
    grid.style.gridTemplateColumns = `3.5rem repeat(${laneTotal}, minmax(6.5rem, 1fr))`;
    grid.style.gridTemplateRows = `2rem repeat(${slots}, 1.75rem)`;

    const corner = document.createElement("span");
    corner.className = "ms-calendar__corner";
    grid.append(corner);
    days.forEach((day) => {
      const header = document.createElement("strong");
      header.className = "ms-calendar__day";
      const start = dayStarts.get(day);
      header.style.gridColumn = `${start} / ${start + laneCounts.get(day)}`;
      header.textContent = day.slice(0, 3);
      grid.append(header);
    });
    for (let slot = 0; slot < slots; slot += 2) {
      const time = document.createElement("span");
      time.className = "ms-calendar__time";
      time.style.gridRow = String(slot + 2);
      time.textContent = core.formatMinutes(earliest + slot * 30);
      grid.append(time);
    }
    days.forEach((day) => {
      const column = document.createElement("span");
      column.className = "ms-calendar__column";
      const start = dayStarts.get(day);
      column.style.gridColumn = `${start} / ${start + laneCounts.get(day)}`;
      column.style.gridRow = `2 / ${slots + 2}`;
      grid.append(column);
    });
    entries.forEach((entry) => {
      if (!dayStarts.has(entry.day)) return;
      const block = document.createElement("div");
      block.className = "ms-calendar__event";
      const isConflict = conflictingEntries.has(entry);
      block.dataset.state = isConflict ? "conflict" : "compatible";
      const layout = layouts.get(entry);
      const dayStart = dayStarts.get(entry.day);
      block.style.gridColumn = layout?.overlaps ? String(dayStart + layout.lane) : `${dayStart} / ${dayStart + laneCounts.get(entry.day)}`;
      block.style.gridRow = `${2 + (entry.start - earliest) / 30} / ${2 + (entry.end - earliest) / 30}`;
      const subject = document.createElement("strong");
      subject.textContent = entry.label;
      const time = document.createElement("span");
      time.textContent = `${core.formatMinutes(entry.start)}–${core.formatMinutes(entry.end)}`;
      block.append(subject, time);
      block.setAttribute("aria-label", `${entry.label}, ${time.textContent}, ${isConflict ? "con traslape" : "compatible"}`);
      grid.append(block);
    });
    wrapper.append(grid);
    return wrapper;
  }

  function renderCalendarExport(entries, parent, label = "propuesta") {
    const exportSection = document.createElement("section");
    exportSection.className = "ms-export-strip";
    const dateField = document.createElement("label");
    dateField.className = "ms-compact-field";
    const dateLabel = document.createElement("span");
    dateLabel.textContent = "Lunes de inicio";
    const dateInput = document.createElement("input");
    dateInput.className = "ms-input";
    dateInput.type = "date";
    dateInput.value = defaultMonday();
    dateField.append(dateLabel, dateInput);
    const weeksField = document.createElement("label");
    weeksField.className = "ms-compact-field ms-compact-field--small";
    const weeksLabel = document.createElement("span");
    weeksLabel.textContent = "Semanas";
    const weeksInput = document.createElement("input");
    weeksInput.className = "ms-input";
    weeksInput.type = "number";
    weeksInput.min = "1";
    weeksInput.max = "30";
    weeksInput.value = "18";
    weeksField.append(weeksLabel, weeksInput);
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "ms-button ms-button--primary";
    exportButton.textContent = "Exportar calendario";
    exportButton.disabled = !entries.length;
    exportButton.addEventListener("click", () => {
      const ics = core.scheduleToIcs(entries, { startDate: dateInput.value, weeks: weeksInput.value, calendarName: "MI SAES 2.0" });
      if (!ics) {
        dateInput.setAttribute("aria-invalid", "true");
        announce("Selecciona una fecha de inicio válida");
        return;
      }
      dateInput.removeAttribute("aria-invalid");
      downloadText(`mi-saes-${label}-${new Date().toISOString().slice(0, 10)}.ics`, ics, "text/calendar;charset=utf-8");
      exportButton.dataset.state = "success";
      exportButton.textContent = "Calendario exportado ✓";
      announce("Calendario exportado");
      setTimeout(() => {
        delete exportButton.dataset.state;
        exportButton.textContent = "Exportar calendario";
      }, 2200);
    });
    exportSection.append(dateField, weeksField, exportButton);
    parent.append(exportSection);
  }

  function renderPlanner() {
    const intro = document.createElement("div");
    intro.className = "ms-planner-intro";
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Arma tu Horario";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Compara grupos, guarda alternativas y genera un horario sin empalmes. Nada se envía a SAES.";
    intro.append(heading, lede);
    view.append(intro);

    const scanSection = document.createElement("section");
    scanSection.className = "ms-scan";
    const scanCopy = document.createElement("div");
    scanCopy.className = "ms-scan__copy";
    const scanTitle = document.createElement("strong");
    scanTitle.textContent = scanCatalog && catalogMatchesPage ? `Oferta escaneada · ${scanCatalog.career}` : "Escanea la oferta completa de tu carrera";
    const scanDetail = document.createElement("p");
    scanDetail.className = "ms-helper";
    if (scanCatalog && catalogMatchesPage) {
      const periods = new Set(scanCatalog.offerings.map((item) => item.source?.period).filter(Boolean));
      const shifts = new Set(scanCatalog.offerings.map((item) => item.source?.shift).filter(Boolean));
      const updated = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(scanCatalog.scannedAt));
      scanDetail.textContent = `${scanCatalog.offerings.length} grupos · ${periods.size} periodos · ${shifts.size} turnos · ${updated}`;
    } else if (scanCatalog && !catalogMatchesPage) {
      scanDetail.textContent = `El catálogo guardado pertenece a ${scanCatalog.career}, pero SAES muestra ${visibleCareer}. Actualiza el escaneo para evitar mezclar carreras.`;
    } else {
      scanDetail.textContent = "Recorre todos los turnos, planes y periodos de la carrera y del modo Actual/Próximo seleccionado en SAES. Las consultas son secuenciales y de sólo lectura.";
    }
    scanCopy.append(scanTitle, scanDetail);
    const scanActions = document.createElement("div");
    scanActions.className = "ms-row";
    const scanButton = document.createElement("button");
    scanButton.type = "button";
    scanButton.className = "ms-button ms-button--primary";
    function scanButtonLabel() {
      if (occupancyEnabled) return scanCatalog ? "Actualizar todo" : "Escanear todo";
      return scanCatalog ? "Actualizar oferta" : "Escanear oferta";
    }
    scanButton.textContent = scanButtonLabel();
    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "ms-button";
    stopButton.textContent = "Detener";
    stopButton.hidden = true;
    scanActions.append(scanButton, stopButton);
    const scanProgress = document.createElement("progress");
    scanProgress.className = "ms-scan__progress";
    scanProgress.hidden = true;
    const scanStatus = document.createElement("p");
    scanStatus.className = "ms-helper";
    scanStatus.setAttribute("aria-live", "polite");
    const occupancyTools = document.createElement("div");
    occupancyTools.className = "ms-occupancy-tools";
    const occupancyToggle = document.createElement("label");
    occupancyToggle.className = "ms-toggle-row";
    const occupancyCheckbox = document.createElement("input");
    occupancyCheckbox.type = "checkbox";
    occupancyCheckbox.checked = occupancyEnabled;
    occupancyCheckbox.setAttribute("role", "switch");
    occupancyCheckbox.setAttribute("aria-describedby", "ms-occupancy-status");
    const occupancyToggleCopy = document.createElement("span");
    occupancyToggleCopy.innerHTML = "<strong>Mostrar lugares disponibles</strong>";
    occupancyToggle.append(occupancyCheckbox, occupancyToggleCopy);
    const occupancyIntervalField = document.createElement("label");
    occupancyIntervalField.className = "ms-occupancy-interval";
    const occupancyIntervalLabel = document.createElement("span");
    occupancyIntervalLabel.textContent = "Actualizar cada";
    const occupancyIntervalSelect = document.createElement("select");
    occupancyIntervalSelect.className = "ms-select";
    occupancyIntervalSelect.disabled = !occupancyEnabled;
    core.OCCUPANCY_REFRESH_MINUTES.forEach((minutes) => {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = `${minutes} minuto${minutes === 1 ? "" : "s"}`;
      option.selected = minutes === occupancyRefreshMinutes;
      occupancyIntervalSelect.append(option);
    });
    occupancyIntervalField.append(occupancyIntervalLabel, occupancyIntervalSelect);
    const occupancyStatus = document.createElement("p");
    occupancyStatus.id = "ms-occupancy-status";
    occupancyStatus.className = "ms-helper";
    occupancyStatus.setAttribute("aria-live", "polite");
    function updateOccupancyStatus({ state, message } = {}) {
      scanButton.textContent = scanButtonLabel();
      if (!occupancyEnabled || state === "disabled") {
        occupancyStatus.textContent = "Lugares disponibles desactivados.";
        return;
      }
      if (state === "error") {
        occupancyStatus.textContent = `${message} Se conservaron los últimos datos disponibles.`;
        occupancyStatus.dataset.state = "error";
        return;
      }
      delete occupancyStatus.dataset.state;
      if (state === "loading") {
        occupancyStatus.textContent = "Consultando Cupo, Inscritos y Disponibles en SAES…";
        return;
      }
      if (occupancyCatalog?.updatedAt) {
        const updated = new Intl.DateTimeFormat("es-MX", { timeStyle: "short" }).format(new Date(occupancyCatalog.updatedAt));
        occupancyStatus.textContent = `${occupancyCatalog.records.length} grupos · actualizado a las ${updated}`;
      } else {
        occupancyStatus.textContent = "Aún no hay datos de lugares disponibles.";
      }
    }
    updateOccupancyStatus({ state: occupancyController ? "loading" : "ready" });
    occupancyCheckbox.addEventListener("change", () => {
      occupancyIntervalSelect.disabled = !occupancyCheckbox.checked;
      setOccupancyEnabled(occupancyCheckbox.checked);
    });
    occupancyIntervalSelect.addEventListener("change", () => setOccupancyRefreshMinutes(occupancyIntervalSelect.value));
    occupancyTools.append(occupancyToggle, occupancyIntervalField, occupancyStatus);
    scanSection.append(scanCopy, scanActions, scanProgress, scanStatus, occupancyTools);
    view.append(scanSection);
    refreshOccupancyView = updateOccupancyStatus;

    if (preparedSchedule) {
      const prepared = document.createElement("section");
      prepared.className = "ms-prepared";
      const preparedCopy = document.createElement("div");
      const preparedTitle = document.createElement("strong");
      preparedTitle.textContent = "Horario preparado para reinscripción";
      const preparedDetail = document.createElement("p");
      preparedDetail.className = "ms-helper";
      const savedAt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(preparedSchedule.savedAt));
      preparedDetail.textContent = `${preparedSchedule.offerings.length} materias · guardado ${savedAt}. No se ha enviado a SAES.`;
      preparedCopy.append(preparedTitle, preparedDetail);
      const loadPrepared = document.createElement("button");
      loadPrepared.type = "button";
      loadPrepared.className = "ms-button";
      loadPrepared.textContent = "Cargar como candidatos";
      loadPrepared.addEventListener("click", async () => {
        const knownIds = new Set(courseOfferings.map((offering) => offering.id));
        const missing = preparedSchedule.offerings.filter((offering) => !knownIds.has(offering.id));
        if (missing.length) courseOfferings = missing.concat(courseOfferings);
        const ids = preparedSchedule.offerings.map((offering) => offering.id);
        plannerSelection = new Set(ids);
        generatedSchedules = [];
        await storage.set({ [plannerKey]: ids });
        renderView();
        announce("Horario preparado cargado como candidatos");
      });
      prepared.append(preparedCopy, loadPrepared);
      view.append(prepared);
    }

    scanButton.addEventListener("click", async () => {
      if (!globalThis.MISaesScanner || scanController) return;
      scanController = new AbortController();
      scanButton.disabled = true;
      scanButton.dataset.state = "loading";
      scanButton.textContent = "Escaneando oferta";
      stopButton.hidden = false;
      scanProgress.hidden = false;
      scanStatus.textContent = "Preparando los selectores de SAES…";
      const previousSelected = courseOfferings.filter((offering) => plannerSelection.has(offering.id));
      try {
        const result = await globalThis.MISaesScanner.scan({
          rootDocument: document,
          core,
          signal: scanController.signal,
          includeNext: false,
          onProgress(progress) {
            const source = progress.metadata;
            scanStatus.textContent = `${progress.offerings} grupos encontrados · ${source.shift} · periodo ${source.period}`;
            announce(`${progress.offerings} grupos encontrados`);
          }
        });
        scanCatalog = result;
        courseOfferings = result.offerings;
        const remapped = new Set();
        previousSelected.forEach((previous) => {
          const match = courseOfferings.find((offering) => core.normalizeText(offering.group) === core.normalizeText(previous.group) && core.normalizeText(offering.subject) === core.normalizeText(previous.subject));
          if (match) remapped.add(match.id);
        });
        plannerSelection = remapped;
        generatedSchedules = [];
        await storage.set({ [catalogKey]: result, [plannerKey]: [...plannerSelection] });
        announce(`Escaneo completo: ${result.offerings.length} grupos disponibles`);
        if (isOpen && activeView === "schedule") renderView();
        if (occupancyEnabled) refreshOccupancy({ force: true }).catch(() => {});
      } catch (error) {
        if (error?.name === "AbortError") {
          scanStatus.textContent = "Escaneo detenido. Se conserva el catálogo anterior.";
          announce("Escaneo detenido");
        } else {
          scanStatus.textContent = error?.message || "No fue posible completar el escaneo.";
          scanButton.dataset.state = "error";
          announce(scanStatus.textContent);
        }
      } finally {
        scanController = null;
        scanButton.disabled = false;
        if (scanButton.dataset.state !== "error") delete scanButton.dataset.state;
        scanButton.textContent = scanButtonLabel();
        stopButton.hidden = true;
        scanProgress.hidden = true;
      }
    });
    stopButton.addEventListener("click", () => scanController?.abort());

    if (!courseOfferings.length) {
      view.append(makeEmpty("Aún no hay grupos para planear", "Selecciona tu carrera en SAES y pulsa “Escanear periodos y turnos”."));
      return;
    }

    const workspace = document.createElement("div");
    workspace.className = "ms-planner";
    const browser = document.createElement("section");
    browser.className = "ms-planner__browser";
    const browserHeader = document.createElement("div");
    browserHeader.className = "ms-browser-header";
    const browserTitle = document.createElement("h3");
    browserTitle.className = "ms-section__title";
    browserTitle.textContent = "Oferta disponible";
    const search = document.createElement("input");
    search.className = "ms-input";
    search.type = "search";
    search.placeholder = "Materia, grupo o profesor";
    search.setAttribute("aria-label", "Buscar grupo candidato");
    const resultCount = document.createElement("p");
    resultCount.className = "ms-helper";
    const detectedPeriods = [...new Set(courseOfferings.map((offering) => String(offering.source?.period || "")).filter(Boolean))]
      .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right, "es"));
    const selectedPeriods = new Set();
    const semesterFilter = document.createElement("details");
    semesterFilter.className = "ms-filter-disclosure";
    semesterFilter.setAttribute("aria-label", "Filtrar por semestres");
    const semesterSummary = document.createElement("summary");
    semesterSummary.className = "ms-filter-disclosure__summary";
    const semesterSummaryText = document.createElement("span");
    const semesterChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    semesterChevron.classList.add("ms-filter-disclosure__chevron");
    semesterChevron.setAttribute("viewBox", "0 0 24 24");
    semesterChevron.setAttribute("aria-hidden", "true");
    semesterChevron.innerHTML = '<path d="m7 10 5 5 5-5"/>';
    semesterSummary.append(semesterSummaryText, semesterChevron);
    const semesterMenu = document.createElement("div");
    semesterMenu.className = "ms-filter-disclosure__menu";
    semesterMenu.setAttribute("role", "group");
    semesterMenu.setAttribute("aria-label", "Semestres a mostrar");
    const allPeriods = document.createElement("input");
    allPeriods.type = "checkbox";
    allPeriods.checked = true;
    const allPeriodsLabel = document.createElement("label");
    allPeriodsLabel.className = "ms-filter-check";
    allPeriodsLabel.append(allPeriods, document.createTextNode("Todos"));
    semesterMenu.append(allPeriodsLabel);
    const periodButtons = detectedPeriods.map((period) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const label = document.createElement("label");
      label.className = "ms-filter-check";
      label.append(checkbox, document.createTextNode(period));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedPeriods.add(period);
        else selectedPeriods.delete(period);
        renderOptions();
      });
      semesterMenu.append(label);
      return { period, checkbox };
    });
    allPeriods.addEventListener("change", () => {
      selectedPeriods.clear();
      renderOptions();
    });
    semesterFilter.append(semesterSummary, semesterMenu);
    semesterFilter.hidden = !detectedPeriods.length;
    const filterBar = document.createElement("details");
    filterBar.className = "ms-filter-disclosure";
    filterBar.setAttribute("aria-label", "Filtros de oferta");
    let compatibleOnly = false;
    let availableOnly = false;
    const filterSummary = document.createElement("summary");
    filterSummary.className = "ms-filter-disclosure__summary";
    const filterSummaryText = document.createElement("span");
    const filterChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    filterChevron.classList.add("ms-filter-disclosure__chevron");
    filterChevron.setAttribute("viewBox", "0 0 24 24");
    filterChevron.setAttribute("aria-hidden", "true");
    filterChevron.innerHTML = '<path d="m7 10 5 5 5-5"/>';
    filterSummary.append(filterSummaryText, filterChevron);
    const filterMenu = document.createElement("div");
    filterMenu.className = "ms-filter-disclosure__menu";
    filterMenu.setAttribute("role", "group");
    filterMenu.setAttribute("aria-label", "Reglas de filtrado");
    const compatibleFilter = document.createElement("input");
    compatibleFilter.type = "checkbox";
    const compatibleLabel = document.createElement("label");
    compatibleLabel.className = "ms-filter-check";
    compatibleLabel.append(compatibleFilter, document.createTextNode("Sin traslape"));
    const availableFilter = document.createElement("input");
    availableFilter.type = "checkbox";
    availableFilter.disabled = !occupancyEnabled || !occupancyCatalog?.records?.length;
    const availableLabel = document.createElement("label");
    availableLabel.className = "ms-filter-check";
    availableLabel.append(availableFilter, document.createTextNode("Con lugares"));
    filterMenu.append(compatibleLabel, availableLabel);
    filterBar.append(filterSummary, filterMenu);
    const optionList = document.createElement("div");
    optionList.className = "ms-option-list";
    browserHeader.append(browserTitle, resultCount);
    browser.append(browserHeader, search, semesterFilter, filterBar, optionList);

    const plan = document.createElement("section");
    plan.className = "ms-planner__plan";
    const planHeader = document.createElement("div");
    planHeader.className = "ms-plan-header";
    const planTitle = document.createElement("h3");
    planTitle.className = "ms-section__title";
    planTitle.textContent = "Tu selección";
    const selectionCount = document.createElement("span");
    selectionCount.className = "ms-count";
    planHeader.append(planTitle, selectionCount);
    const selectionSummary = document.createElement("div");
    selectionSummary.className = "ms-selection-summary";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "ms-button ms-button--primary";
    generate.textContent = "Generar propuestas";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ms-button";
    clear.textContent = "Borrar selección";
    const actions = document.createElement("div");
    actions.className = "ms-row ms-plan-actions";
    actions.append(generate, clear);
    const proposals = document.createElement("div");
    proposals.className = "ms-proposals";
    plan.append(planHeader, selectionSummary, actions);
    workspace.append(browser, plan, proposals);
    view.append(workspace);

    function selectedOfferings() {
      return courseOfferings.filter((offering) => plannerSelection.has(offering.id));
    }

    function availableAlternatives(fullOffering, selected) {
      const comparisonEntries = selected
        .filter((candidate) => candidate.id !== fullOffering.id && core.normalizeText(candidate.subject) !== core.normalizeText(fullOffering.subject))
        .flatMap((candidate) => candidate.entries || []);
      return courseOfferings
        .filter((candidate) => candidate.id !== fullOffering.id && core.normalizeText(candidate.subject) === core.normalizeText(fullOffering.subject))
        .map((candidate) => {
          const occupancy = occupancyFor(candidate);
          if (!occupancy || occupancy.available <= 0) return null;
          const conflicts = core.findScheduleConflicts(comparisonEntries.concat(candidate.entries || []))
            .filter((conflict) => (candidate.entries || []).includes(conflict.left) || (candidate.entries || []).includes(conflict.right));
          return { candidate, occupancy, conflicts };
        })
        .filter(Boolean)
        .sort((left, right) => left.conflicts.length - right.conflicts.length || right.occupancy.available - left.occupancy.available)
        .slice(0, 3);
    }

    function generationCandidates(selected = selectedOfferings()) {
      if (!occupancyEnabled) return { offerings: selected, blockedSubjects: [] };
      const subjects = [...new Set(selected.map((offering) => core.normalizeText(offering.subject)))];
      const offerings = selected.filter((offering) => occupancyFor(offering)?.available !== 0);
      const availableSubjects = new Set(offerings.map((offering) => core.normalizeText(offering.subject)));
      return { offerings, blockedSubjects: subjects.filter((subject) => !availableSubjects.has(subject)) };
    }

    function conflictsForOffering(offering, selected) {
      const comparison = plannerSelection.has(offering.id)
        ? selected.filter((candidate) => candidate.id !== offering.id)
        : selected.filter((candidate) => core.normalizeText(candidate.subject) !== core.normalizeText(offering.subject));
      const candidateEntries = offering.entries || [];
      return core.findScheduleConflicts(comparison.flatMap((candidate) => candidate.entries || []).concat(candidateEntries))
        .filter((conflict) => candidateEntries.includes(conflict.left) || candidateEntries.includes(conflict.right));
    }

    function renderOptions() {
      const selected = selectedOfferings();
      const compatibleIds = new Set();
      const availableIds = new Set();
      courseOfferings.forEach((offering) => {
        if (!conflictsForOffering(offering, selected).length) compatibleIds.add(offering.id);
        if ((occupancyFor(offering)?.available ?? 0) > 0) availableIds.add(offering.id);
      });
      const filtered = core.filterPlannerOfferings(courseOfferings, {
        query: search.value,
        periods: selectedPeriods,
        compatibleOnly,
        compatibleIds,
        availableOnly,
        availableIds
      });
      resultCount.textContent = `${filtered.length} de ${courseOfferings.length} grupos`;
      optionList.replaceChildren();
      compatibleFilter.checked = compatibleOnly;
      availableFilter.checked = availableOnly;
      allPeriods.checked = !selectedPeriods.size;
      periodButtons.forEach(({ period, checkbox }) => { checkbox.checked = selectedPeriods.has(period); });
      semesterSummaryText.textContent = !selectedPeriods.size
        ? "Semestres · Todos"
        : `Semestres · ${[...selectedPeriods].sort((left, right) => Number(left) - Number(right)).join(", ")}`;
      const activeFilters = [compatibleOnly && "Sin traslape", availableOnly && "Con lugares"].filter(Boolean);
      filterSummaryText.textContent = activeFilters.length ? `Filtros · ${activeFilters.join(", ")}` : "Filtros · Ninguno";
      availableFilter.disabled = !occupancyEnabled || !occupancyCatalog?.records?.length;
      if (!filtered.length) {
        optionList.append(makeEmpty("No hay grupos con estos filtros", "Prueba otra búsqueda o desactiva un filtro."));
        return;
      }
      filtered.forEach((offering) => {
        const occupancy = occupancyFor(offering);
        const checked = plannerSelection.has(offering.id);
        const candidateEntries = offering.entries || [];
        const fitConflicts = conflictsForOffering(offering, selected);
        const conflictDetails = [...new Set(fitConflicts.map((conflict) => {
          const other = candidateEntries.includes(conflict.left) ? conflict.right.label : conflict.left.label;
          return `${formatConflictWindow(conflict, { compact: true })} con ${other}`;
        }))];
        const option = document.createElement("article");
        option.className = "ms-option";
        option.dataset.fit = fitConflicts.length ? "conflict" : "compatible";
        if (occupancy) option.dataset.capacity = occupancy.available === 0 ? "full" : occupancy.available <= 3 ? "low" : "available";
        const lead = document.createElement("label");
        lead.className = "ms-option__lead";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.setAttribute("aria-label", `Agregar ${offering.subject}, grupo ${offering.group}`);
        const copy = document.createElement("span");
        copy.className = "ms-option__copy";
        const top = document.createElement("span");
        top.className = "ms-option__top";
        const subject = document.createElement("strong");
        subject.textContent = offering.subject;
        const group = document.createElement("span");
        group.className = "ms-group-tag";
        group.textContent = offering.group;
        const tags = document.createElement("span");
        tags.className = "ms-option__tags";
        tags.append(group);
        if (occupancy) {
          const capacity = document.createElement("span");
          capacity.className = "ms-capacity-tag";
          capacity.dataset.state = occupancy.available === 0 ? "full" : occupancy.available <= 3 ? "low" : "available";
          capacity.textContent = occupancy.available === 0 ? "Lleno" : `${occupancy.available} lugar${occupancy.available === 1 ? "" : "es"}`;
          capacity.title = `Cupo ${occupancy.capacity ?? "—"} · Inscritos ${occupancy.enrolled ?? "—"} · Disponibles ${occupancy.available}`;
          tags.append(capacity);
        }
        top.append(subject, tags);
        const teacher = document.createElement("span");
        teacher.className = "ms-option__teacher";
        teacher.textContent = offering.teacher || "Profesor no indicado";
        const source = document.createElement("span");
        source.className = "ms-option__source";
        source.textContent = offering.source ? `Periodo ${offering.source.period} · ${offering.source.shift}` : "Periodo no indicado";
        const times = document.createElement("span");
        times.className = "ms-option__times";
        times.textContent = formatOfferingTimes(offering) || "Horario no indicado";
        copy.append(top, teacher, source, times);
        if (conflictDetails.length) {
          const conflictDetail = document.createElement("span");
          conflictDetail.className = "ms-option__conflict-detail";
          conflictDetail.textContent = `Traslape · ${conflictDetails.slice(0, 1).join(" · ")}`;
          copy.append(conflictDetail);
        }
        lead.append(checkbox, copy);
        option.append(lead);
        checkbox.addEventListener("change", async () => {
          if (checkbox.checked) plannerSelection.add(offering.id);
          else plannerSelection.delete(offering.id);
          generatedSchedules = [];
          activeGeneratedSchedule = 0;
          await storage.set({ [plannerKey]: [...plannerSelection] });
          renderOptions();
          updatePlan();
        });
        optionList.append(option);
      });
    }

    function renderProposals() {
      proposals.replaceChildren();
      if (!generatedSchedules.length) {
        const selected = selectedOfferings();
        if (!selected.length) return;
        const entries = selected.flatMap((offering) => offering.entries || []);
        const draftConflicts = core.findScheduleConflicts(entries);
        const conflictEntries = new Set(draftConflicts.flatMap((conflict) => [conflict.left, conflict.right]));
        const proposalHeader = document.createElement("div");
        proposalHeader.className = "ms-proposal-header";
        const title = document.createElement("strong");
        title.textContent = "Calendario de candidatos";
        const legend = document.createElement("div");
        legend.className = "ms-calendar-legend";
        legend.innerHTML = `<span data-state="compatible">Compatible</span><span data-state="conflict">Traslape</span>`;
        proposalHeader.append(title, legend);
        proposals.append(proposalHeader, buildCalendarGrid(entries, conflictEntries));
        if (draftConflicts.length) {
          const conflictList = document.createElement("ul");
          conflictList.className = "ms-conflict-list";
          draftConflicts.slice(0, 8).forEach((conflict) => {
            const item = document.createElement("li");
            item.textContent = `${formatConflictWindow(conflict)}: ${conflict.left.label} ↔ ${conflict.right.label}`;
            conflictList.append(item);
          });
          proposals.append(conflictList);
        }
        return;
      }
      const proposalHeader = document.createElement("div");
      proposalHeader.className = "ms-proposal-header";
      const title = document.createElement("strong");
      title.textContent = `${generatedSchedules.length} propuesta${generatedSchedules.length === 1 ? "" : "s"} sin empalmes`;
      const picker = document.createElement("select");
      picker.className = "ms-select ms-proposal-picker";
      picker.setAttribute("aria-label", "Elegir propuesta de horario");
      generatedSchedules.forEach((_schedule, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `Propuesta ${index + 1}`;
        picker.append(option);
      });
      picker.value = String(activeGeneratedSchedule);
      proposalHeader.append(title, picker);
      const preview = document.createElement("div");
      preview.className = "ms-proposal-preview";

      function drawProposal() {
        activeGeneratedSchedule = Number(picker.value);
        const selected = generatedSchedules[activeGeneratedSchedule];
        preview.replaceChildren();
        preview.append(buildCalendarGrid(selected.entries));
        selected.offerings.forEach((offering) => {
          const row = document.createElement("div");
          row.className = "ms-proposal-row";
          const name = document.createElement("strong");
          name.textContent = offering.subject;
          const meta = document.createElement("span");
          meta.textContent = `${offering.group} · ${offering.teacher || "Profesor no indicado"}`;
          row.append(name, meta);
          preview.append(row);
        });
        const oldExport = proposals.querySelector(".ms-export-strip");
        if (oldExport) oldExport.remove();
        const oldPrepared = proposals.querySelector(".ms-prepared-actions");
        if (oldPrepared) oldPrepared.remove();
        const preparedActions = document.createElement("div");
        preparedActions.className = "ms-prepared-actions";
        const savePrepared = document.createElement("button");
        savePrepared.type = "button";
        savePrepared.className = "ms-button ms-button--primary";
        savePrepared.textContent = "Guardar para reinscripción";
        const preparedHelp = document.createElement("p");
        preparedHelp.className = "ms-helper";
        preparedHelp.textContent = "Guarda esta propuesta en Chrome. No inscribe materias ni envía información.";
        savePrepared.addEventListener("click", async () => {
          preparedSchedule = {
            savedAt: new Date().toISOString(),
            career: scanCatalog?.career || "",
            offerings: selected.offerings,
            entries: selected.entries
          };
          await storage.set({ [preparedKey]: preparedSchedule });
          savePrepared.dataset.state = "success";
          savePrepared.textContent = "Horario guardado ✓";
          preparedHelp.textContent = "Listo para consultarlo cuando llegue tu cita. Aún no se ha enviado a SAES.";
          announce("Horario preparado guardado localmente");
        });
        preparedActions.append(savePrepared, preparedHelp);
        proposals.append(preparedActions);
        renderCalendarExport(selected.entries, proposals, `propuesta-${activeGeneratedSchedule + 1}`);
      }
      picker.addEventListener("change", drawProposal);
      proposals.append(proposalHeader, preview);
      drawProposal();
    }

    function updatePlan() {
      const selected = selectedOfferings();
      const fullSelected = occupancyEnabled ? selected.filter((offering) => occupancyFor(offering)?.available === 0) : [];
      const generation = generationCandidates(selected);
      const directConflicts = core.findScheduleConflicts(selected.flatMap((offering) => offering.entries));
      selectionCount.textContent = `${selected.length} grupo${selected.length === 1 ? "" : "s"}`;
      generate.disabled = !selected.length || generation.blockedSubjects.length > 0;
      generate.title = generation.blockedSubjects.length ? "Falta una alternativa con lugares para una o más materias." : "";
      clear.disabled = !selected.length;
      selectionSummary.replaceChildren();
      if (!selected.length) {
        selectionSummary.append(makeEmpty("Empieza con tus materias", "Marca todos los grupos que considerarías. Puedes incluir varias alternativas de la misma materia."));
      } else {
        const summary = document.createElement("p");
        summary.className = "ms-helper";
        summary.textContent = directConflicts.length ? `${directConflicts.length} cruce${directConflicts.length === 1 ? "" : "s"} entre candidatos` : "Sin cruces entre candidatos";
        const selectionList = document.createElement("div");
        selectionList.className = "ms-selection-list";
        const selectionHeader = document.createElement("div");
        selectionHeader.className = "ms-selection-list__header";
        ["Materia · grupo", "Profesor", "Horario", ""].forEach((label) => {
          const cell = document.createElement("span");
          cell.textContent = label;
          selectionHeader.append(cell);
        });
        selectionList.append(selectionHeader);
        selected.forEach((offering) => {
          const occupancy = occupancyFor(offering);
          const offeringConflicts = conflictsForOffering(offering, selected);
          const row = document.createElement("div");
          row.className = "ms-selection-item";
          row.dataset.state = offeringConflicts.length ? "conflict" : occupancy?.available === 0 ? "full" : "compatible";
          const copy = document.createElement("div");
          copy.className = "ms-selection-item__copy";
          const name = document.createElement("strong");
          name.textContent = offering.subject;
          const meta = document.createElement("span");
          meta.textContent = `${offering.group}${offering.source ? ` · P${offering.source.period} ${offering.source.shift}` : ""}${occupancy ? ` · ${occupancy.available} lugares` : ""}`;
          copy.append(name, meta);
          const teacher = document.createElement("span");
          teacher.className = "ms-selection-item__teacher";
          teacher.textContent = offering.teacher || "Profesor no indicado";
          const times = document.createElement("span");
          times.className = "ms-selection-item__times";
          times.textContent = formatOfferingTimes(offering) || "Horario no indicado";
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "ms-button ms-button--quiet ms-selection-item__remove";
          remove.textContent = "Quitar";
          remove.setAttribute("aria-label", `Quitar ${offering.subject}, grupo ${offering.group}`);
          remove.addEventListener("click", async () => {
            plannerSelection.delete(offering.id);
            generatedSchedules = [];
            await storage.set({ [plannerKey]: [...plannerSelection] });
            renderOptions();
            updatePlan();
            announce(`${offering.subject}, grupo ${offering.group}, quitado`);
          });
          row.append(copy, teacher, times, remove);
          selectionList.append(row);
        });
        selectionSummary.append(summary, selectionList);
        if (fullSelected.length) {
          const alerts = document.createElement("div");
          alerts.className = "ms-capacity-alerts";
          fullSelected.forEach((offering) => {
            const alert = document.createElement("section");
            alert.className = "ms-capacity-alert";
            const title = document.createElement("strong");
            title.textContent = `${offering.group} está lleno`;
            const detail = document.createElement("p");
            detail.className = "ms-helper";
            const alternatives = availableAlternatives(offering, selected);
            const hasSelectedAlternative = selected.some((candidate) => candidate.id !== offering.id
              && core.normalizeText(candidate.subject) === core.normalizeText(offering.subject)
              && occupancyFor(candidate)?.available > 0);
            detail.textContent = hasSelectedAlternative
              ? `Se excluirá ${offering.group}; ya seleccionaste otra alternativa con lugares.`
              : alternatives.length
              ? `Hay ${alternatives.length} alternativa${alternatives.length === 1 ? "" : "s"} con lugares para ${offering.subject}.`
              : `SAES no reporta otra alternativa con lugares para ${offering.subject}.`;
            alert.append(title, detail);
            if (alternatives.length) {
              const alternativeActions = document.createElement("div");
              alternativeActions.className = "ms-alternative-list";
              alternatives.forEach(({ candidate, occupancy, conflicts: alternativeConflicts }) => {
                const replace = document.createElement("button");
                replace.type = "button";
                replace.className = "ms-alternative";
                replace.dataset.fit = alternativeConflicts.length ? "conflict" : "compatible";
                replace.textContent = `Cambiar a ${candidate.group} · ${occupancy.available} lugar${occupancy.available === 1 ? "" : "es"} · ${alternativeConflicts.length ? "revisar traslape" : "sin traslape"}`;
                replace.addEventListener("click", async () => {
                  plannerSelection.delete(offering.id);
                  plannerSelection.add(candidate.id);
                  generatedSchedules = [];
                  await storage.set({ [plannerKey]: [...plannerSelection] });
                  renderOptions();
                  updatePlan();
                  announce(`${offering.group} reemplazado por ${candidate.group}`);
                });
                alternativeActions.append(replace);
              });
              alert.append(alternativeActions);
            }
            alerts.append(alert);
          });
          selectionSummary.append(alerts);
        }
      }
      renderProposals();
    }

    search.addEventListener("input", renderOptions);
    compatibleFilter.addEventListener("change", () => {
      compatibleOnly = compatibleFilter.checked;
      renderOptions();
    });
    availableFilter.addEventListener("change", () => {
      availableOnly = availableFilter.checked;
      renderOptions();
    });
    generate.addEventListener("click", () => {
      const generation = generationCandidates();
      if (generation.blockedSubjects.length) {
        announce("Falta una alternativa con lugares para una o más materias");
        return;
      }
      generatedSchedules = core.generateScheduleCombinations(generation.offerings, 30);
      activeGeneratedSchedule = 0;
      updatePlan();
      if (!generatedSchedules.length) {
        const notice = document.createElement("div");
        notice.className = "ms-notice ms-notice--error";
        const copy = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = "No existe una combinación completa sin empalmes";
        const detail = document.createElement("p");
        detail.className = "ms-helper";
        detail.textContent = "Agrega otra alternativa para alguna materia o quita un grupo candidato.";
        copy.append(strong, detail);
        notice.append(copy);
        proposals.append(notice);
        announce("No existe una combinación completa sin empalmes");
        return;
      }
      announce(`${generatedSchedules.length} propuestas sin empalmes generadas`);
      proposals.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    clear.addEventListener("click", async () => {
      plannerSelection.clear();
      generatedSchedules = [];
      await storage.set({ [plannerKey]: [] });
      renderOptions();
      updatePlan();
      announce("Selección del planificador borrada");
    });

    renderOptions();
    updatePlan();
    refreshOccupancyView = ({ state, message } = {}) => {
      updateOccupancyStatus({ state, message });
      if (state !== "ready" && state !== "disabled") return;
      generatedSchedules = [];
      activeGeneratedSchedule = 0;
      const searchValue = search.value;
      const listScroll = optionList.scrollTop;
      renderOptions();
      search.value = searchValue;
      optionList.scrollTop = listScroll;
      updatePlan();
    };
  }

  function renderPersonalSchedule() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Tu horario";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Revisa los bloques detectados y expórtalos a tu calendario sin modificar SAES.";
    view.append(heading, lede);
    if (!scheduleEntries.length) {
      view.append(makeEmpty("Aún no detecto bloques de horario", "Abre tu horario o una tabla con días y rangos como 07:00–08:30."));
      return;
    }
    if (conflicts.length) {
      const notice = document.createElement("div");
      notice.className = "ms-notice ms-notice--error";
      const copy = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = `${conflicts.length} posible${conflicts.length === 1 ? "" : "s"} empalme${conflicts.length === 1 ? "" : "s"}`;
      const detail = document.createElement("p");
      detail.className = "ms-helper";
      detail.textContent = "Confirma los rangos directamente en SAES.";
      copy.append(strong, detail);
      notice.append(copy);
      view.append(notice);
    }
    const list = document.createElement("ul");
    list.className = "ms-list ms-section";
    const dayOrder = new Map(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((day, index) => [day, index]));
    scheduleEntries.slice().sort((a, b) => (dayOrder.get(a.day) ?? 99) - (dayOrder.get(b.day) ?? 99) || a.start - b.start).slice(0, 80).forEach((entry) => {
      const item = document.createElement("li");
      item.className = "ms-list__item";
      const title = document.createElement("strong");
      title.textContent = entry.label;
      const meta = document.createElement("span");
      meta.className = "ms-list__meta";
      meta.textContent = `${entry.day} · ${core.formatMinutes(entry.start)}–${core.formatMinutes(entry.end)}`;
      item.append(title, meta);
      list.append(item);
    });
    view.append(list);
    renderCalendarExport(scheduleEntries, view, "horario");
  }

  function scheduleDestination() {
    if (isLocalPreview) return new URL("/tests/fixtures/saes-schedule.html?misaes-preview=1", location.href).href;
    return core.schedulePageUrl(location.origin);
  }

  function renderScheduleShortcut() {
    const hasCatalog = Boolean(scanCatalog?.offerings?.length);
    const empty = makeEmpty(
      hasCatalog ? "Tu oferta escaneada está lista" : "Abre Horarios de clase para comenzar",
      hasCatalog
        ? `${scanCatalog.offerings.length} grupos guardados. Puedes seguir navegando por SAES y volver aquí cuando quieras actualizar o comparar tu oferta.`
        : "Desde Horarios podrás escanear la oferta de tu carrera y armar una propuesta sin empalmes."
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ms-button ms-button--primary";
    button.textContent = "Ir a Horarios";
    button.addEventListener("click", () => {
      const destination = scheduleDestination();
      if (destination) location.assign(destination);
    });
    empty.append(button);
    view.append(empty);
  }

  function renderLoginRequired() {
    view.append(makeEmpty(
      "Inicia sesión para usar MI SAES",
      "Cuando entres a SAES, vuelve a abrir el panel para consultar tus herramientas y tu oferta."
    ));
  }

  function renderPreparedForEnrollment() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Tu horario preparado";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Consulta la propuesta que guardaste y captura sus grupos en SAES durante tu cita.";
    view.append(heading, lede);
    if (!preparedSchedule) {
      view.append(makeEmpty("No has guardado una propuesta", "Ve a Horarios de clase, escanea la oferta, genera una propuesta y pulsa “Guardar para reinscripción”."));
      return;
    }
    const notice = document.createElement("div");
    notice.className = "ms-notice ms-notice--success";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = "Guía de captura, no inscripción automática";
    const detail = document.createElement("p");
    detail.className = "ms-helper";
    detail.textContent = "MI SAES no marca materias ni pulsa Enviar. Confirma grupo, profesor y cupo antes de cada alta.";
    copy.append(strong, detail);
    notice.append(copy);
    view.append(notice, buildCalendarGrid(preparedSchedule.entries || []));
    const list = document.createElement("div");
    list.className = "ms-prepared-list";
    preparedSchedule.offerings.forEach((offering) => {
      const row = document.createElement("div");
      row.className = "ms-proposal-row";
      const name = document.createElement("strong");
      name.textContent = `${offering.group} · ${offering.subject}`;
      const meta = document.createElement("span");
      meta.textContent = `${offering.teacher || "Profesor no indicado"}${offering.source ? ` · periodo ${offering.source.period} · ${offering.source.shift}` : ""}`;
      row.append(name, meta);
      list.append(row);
    });
    const actions = document.createElement("div");
    actions.className = "ms-row ms-section";
    const copyGroups = document.createElement("button");
    copyGroups.type = "button";
    copyGroups.className = "ms-button ms-button--primary";
    copyGroups.textContent = "Copiar grupos";
    copyGroups.addEventListener("click", async () => {
      const groups = preparedSchedule.offerings.map((offering) => offering.group).join(", ");
      try {
        await navigator.clipboard.writeText(groups);
        copyGroups.dataset.state = "success";
        copyGroups.textContent = "Grupos copiados ✓";
        announce("Grupos del horario preparado copiados");
      } catch {
        copyGroups.dataset.state = "error";
        copyGroups.textContent = "No se pudieron copiar";
        announce("Chrome no permitió copiar los grupos");
      }
    });
    actions.append(copyGroups);
    view.append(list, actions);
    renderCalendarExport(preparedSchedule.entries || [], view, "horario-preparado");
  }

  function renderSchedule() {
    if (context === "login") renderLoginRequired();
    else if (isOfferingsCatalog) renderPlanner();
    else if (isReenrollmentPage) renderPreparedForEnrollment();
    else renderScheduleShortcut();
  }

  async function renderNotes() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Notas de esta sección";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Anota pendientes o grupos candidatos. El texto se guarda localmente y no se envía al IPN.";
    const section = document.createElement("section");
    section.className = "ms-section";
    const field = document.createElement("label");
    field.className = "ms-field";
    field.innerHTML = `<span class="ms-label">Nota para ${contextNames[context]}</span>`;
    const textarea = document.createElement("textarea");
    textarea.className = "ms-textarea";
    textarea.placeholder = "Ejemplo: comparar 3CV1 y 3CV2 antes del viernes";
    const helper = document.createElement("span");
    helper.className = "ms-helper";
    helper.textContent = "Guardado automático en Chrome.";
    const noteKey = `note:${location.origin}:${location.pathname}`;
    const stored = await storage.get([noteKey]);
    textarea.value = stored[noteKey] || "";
    textarea.addEventListener("input", () => {
      clearTimeout(noteSaveTimer);
      textarea.removeAttribute("aria-invalid");
      textarea.dataset.state = "loading";
      helper.textContent = "Guardando…";
      noteSaveTimer = setTimeout(async () => {
        try {
          await storage.set({ [noteKey]: textarea.value });
          textarea.dataset.state = "success";
          helper.textContent = "Guardado localmente ✓";
          announce("Nota guardada localmente");
        } catch {
          textarea.setAttribute("aria-invalid", "true");
          delete textarea.dataset.state;
          helper.textContent = "No fue posible guardar la nota.";
          announce("No fue posible guardar la nota");
        }
      }, 350);
    });
    field.append(textarea, helper);
    section.append(field);
    view.append(heading, lede, section);
  }

  function renderTools() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Herramientas";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Ajustes locales para hacer más cómoda tu sesión en SAES.";
    view.append(heading, lede);

    renderTrajectoryHomeTool();
    renderStudentIdTool();
    if (context === "evaluation" && settings.modules.evaluationAssist) renderEvaluationTool();
  }

  function renderTrajectoryHomeTool() {
    const section = document.createElement("section");
    section.className = "ms-section";
    const title = document.createElement("h3");
    title.className = "ms-section__title";
    title.textContent = "Inicio de SAES";
    const control = document.createElement("label");
    control.className = "ms-tool-toggle";
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = "Mostrar Mi trayectoria";
    const detail = document.createElement("small");
    detail.textContent = "Añade un resumen local debajo del saludo en la página principal de alumnos.";
    copy.append(strong, detail);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.role = "switch";
    input.checked = settings.modules.trajectoryHome;
    input.addEventListener("change", async () => {
      const previous = settings;
      settings = core.mergeSettings({
        ...settings,
        modules: { ...settings.modules, trajectoryHome: input.checked }
      });
      syncTrajectoryHome();
      try {
        await storage.set({ settings });
        announce(input.checked ? "Mi trayectoria visible en Inicio" : "Mi trayectoria oculta de Inicio");
      } catch {
        settings = previous;
        input.checked = settings.modules.trajectoryHome;
        syncTrajectoryHome();
        announce("No fue posible guardar la preferencia");
      }
    });
    control.append(copy, input);
    section.append(title, control);
    view.append(section);
  }

  const trajectoryPaths = Object.freeze({
    reenrollment: "/Alumnos/Reinscripciones/fichas_reinscripcion.aspx",
    status: "/Alumnos/boleta/Estado_Alumno.aspx",
    kardex: "/Alumnos/boleta/kardex.aspx"
  });

  async function fetchTrajectoryDocument(source) {
    // La petición reutiliza la sesión activa y sólo consulta páginas del mismo plantel.
    // DOMParser permite analizar la respuesta sin navegar ni ejecutar scripts de la página recibida.
    const path = trajectoryPaths[source];
    if (!path) throw new Error("Fuente de trayectoria desconocida");
    const response = await fetch(new URL(path, location.origin), {
      credentials: "same-origin",
      cache: "no-store",
      signal: trajectoryController?.signal
    });
    if (!response.ok) throw new Error(`SAES respondió con código ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }

  async function refreshTrajectory() {
    if (trajectoryController || !hasAuthenticatedSession) {
      if (!hasAuthenticatedSession) announce("Inicia sesión en SAES para actualizar tu trayectoria");
      return;
    }
    trajectoryController = new AbortController();
    const sourceNames = { reenrollment: "Reinscripción", status: "Estado General", kardex: "Kárdex" };
    trajectoryActivity = { state: "loading", source: "reenrollment", message: "Preparando la lectura de SAES…" };
    renderTrajectoryHomeSnapshot();
    try {
      const result = await trajectory.collectTrajectory({
        fetchPage: fetchTrajectoryDocument,
        onProgress({ source, index, total }) {
          trajectoryActivity = {
            state: "loading",
            source,
            message: `Consultando ${sourceNames[source]} · ${index + 1} de ${total}`
          };
          renderTrajectoryHomeSnapshot();
        }
      });
      trajectorySnapshot = result;
      // Una sesión expirada o un fallo total no reemplazan la última fotografía útil guardada.
      if (result.updatedAt) await storage.set({ [trajectoryKey]: result });
      announce(result.state === "ready" ? "Trayectoria actualizada" : result.state === "partial" ? "Trayectoria actualizada parcialmente" : "No fue posible actualizar la trayectoria");
    } catch (error) {
      if (error?.name !== "AbortError") announce("No fue posible actualizar la trayectoria");
    } finally {
      trajectoryController = null;
      trajectoryActivity = null;
      renderTrajectoryHomeSnapshot();
    }
  }

  function renderTrajectoryHomeSnapshot() {
    const homeView = trajectoryHomeHost?.shadowRoot?.querySelector(".ms-trajectory-home__view");
    if (!homeView) return;
    homeView.replaceChildren();
    trajectoryView.render(homeView, {
      snapshot: trajectorySnapshot,
      activity: trajectoryActivity,
      onRefresh: refreshTrajectory,
      embedded: true
    });
  }

  function unmountTrajectoryHome() {
    trajectoryHomeHost?.remove();
    trajectoryHomeHost = null;
  }

  function syncTrajectoryHome() {
    const shouldShow = settings.enabled && core.shouldShowTrajectoryHome({
      url: location.href,
      enabled: settings.modules.trajectoryHome,
      authenticated: hasAuthenticatedSession
    });
    if (!shouldShow) {
      unmountTrajectoryHome();
      return;
    }
    if (trajectoryHomeHost?.isConnected) {
      renderTrajectoryHomeSnapshot();
      return;
    }

    const anchor = document.getElementById("ctl00_mainCopy_FormView1");
    if (!anchor?.parentElement) return;
    trajectoryHomeHost = document.createElement("section");
    trajectoryHomeHost.id = "misaes-trajectory-home";
    trajectoryHomeHost.setAttribute("aria-label", "Mi trayectoria");
    const homeShadow = trajectoryHomeHost.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("src/content/trajectory-home.css");
    const surface = document.createElement("section");
    surface.className = "ms-trajectory-home-surface";
    const homeView = document.createElement("div");
    homeView.className = "ms-view ms-trajectory-home__view";
    surface.append(homeView);
    homeShadow.append(stylesheet, surface);

    // El FormView es el bloque estable del saludo en las versiones SAES verificadas.
    // Insertamos un host aislado justo después para no modificar tablas ni estilos del portal.
    anchor.insertAdjacentElement("afterend", trajectoryHomeHost);
    renderTrajectoryHomeSnapshot();
  }

  function renderStudentIdTool() {
    const section = document.createElement("section");
    section.className = "ms-section";
    const title = document.createElement("h3");
    title.className = "ms-section__title";
    title.textContent = "Privacidad visual";
    const control = document.createElement("label");
    control.className = "ms-tool-toggle";
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = "Ocultar boleta";
    const detail = document.createElement("small");
    detail.textContent = "Sustituye sólo tu número por “MI SAES 2.0”.";
    copy.append(strong, detail);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.role = "switch";
    input.checked = settings.hideStudentId;
    input.addEventListener("change", async () => {
      const previous = settings;
      settings = core.mergeSettings({ ...settings, hideStudentId: input.checked });
      applySettings();
      try {
        await storage.set({ settings });
        announce(input.checked ? "Boleta oculta" : "Boleta visible");
      } catch {
        settings = previous;
        input.checked = settings.hideStudentId;
        applySettings();
        announce("No fue posible guardar la preferencia");
      }
    });
    control.append(copy, input);
    section.append(title, control);
    view.append(section);
  }

  function renderAverageTool() {
    const section = document.createElement("section");
    section.className = "ms-section";
    const title = document.createElement("h3");
    title.className = "ms-section__title";
    title.textContent = "Promedio simple";
    const field = document.createElement("label");
    field.className = "ms-field";
    field.innerHTML = `<span class="ms-label">Calificaciones</span>`;
    const input = document.createElement("input");
    input.className = "ms-input";
    input.inputMode = "decimal";
    input.placeholder = "8, 9.5, 7, 10";
    const helper = document.createElement("span");
    helper.className = "ms-helper";
    helper.textContent = "Acepta valores de 0 a 10 separados por comas o espacios.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ms-button ms-button--primary";
    button.textContent = "Calcular";
    button.addEventListener("click", () => {
      const result = core.calculateAverage([input.value]);
      if (!result) {
        delete input.dataset.state;
        input.setAttribute("aria-invalid", "true");
        helper.textContent = "No encontré calificaciones válidas. Usa números de 0 a 10.";
        helper.style.color = "var(--color-error)";
        announce(helper.textContent);
        return;
      }
      input.removeAttribute("aria-invalid");
      input.dataset.state = "success";
      helper.removeAttribute("style");
      helper.textContent = `Promedio ${result.average} · ${result.count} valores · rango ${result.minimum}–${result.maximum}`;
      announce(helper.textContent);
    });
    input.addEventListener("input", () => {
      delete input.dataset.state;
      if (!input.hasAttribute("aria-invalid")) return;
      input.removeAttribute("aria-invalid");
      helper.removeAttribute("style");
      helper.textContent = "Acepta valores de 0 a 10 separados por comas o espacios.";
    });
    field.append(input, helper);
    section.append(title, field, button);
    view.append(section);
  }

  function evaluationControls() {
    const radioGroups = new Map();
    [...document.querySelectorAll('input[type="radio"][name]')]
      .filter((input) => !host.contains(input) && !input.disabled)
      .forEach((input) => {
        if (!radioGroups.has(input.name)) radioGroups.set(input.name, []);
        radioGroups.get(input.name).push(input);
      });
    const groups = [...radioGroups.values()].filter((group) => group.length >= 2);
    const selects = [...document.querySelectorAll("select")]
      .filter((select) => !host.contains(select) && !select.disabled && select.options.length >= 3);
    return { groups, selects };
  }

  function renderEvaluationTool() {
    const { groups, selects } = evaluationControls();
    const section = document.createElement("section");
    section.className = "ms-section";
    const title = document.createElement("h3");
    title.className = "ms-section__title";
    title.textContent = "Asistente de evaluación";
    const notice = document.createElement("div");
    notice.className = "ms-notice";
    notice.innerHTML = `<svg class="ms-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4M12 16h.01M4 4h16v16H4z"/></svg>`;
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${groups.length + selects.length} preguntas detectadas`;
    const detail = document.createElement("p");
    detail.className = "ms-helper";
    detail.textContent = "Verifica si la escala va de menor a mayor. MI SAES nunca pulsa Enviar.";
    copy.append(strong, detail);
    notice.append(copy);

    const field = document.createElement("label");
    field.className = "ms-field";
    const label = document.createElement("span");
    label.className = "ms-label";
    label.textContent = "Posición de respuesta";
    const select = document.createElement("select");
    select.className = "ms-select";
    select.innerHTML = `
      <option value="first">Primera opción</option>
      <option value="middle" selected>Opción intermedia</option>
      <option value="last">Última opción</option>
    `;
    const helper = document.createElement("span");
    helper.className = "ms-helper";
    helper.textContent = "La extensión no interpreta si una opción es positiva o negativa.";
    field.append(label, select, helper);

    const actions = document.createElement("div");
    actions.className = "ms-row";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "ms-button ms-button--primary";
    apply.textContent = "Aplicar para revisar";
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "ms-button";
    undo.textContent = "Deshacer";
    undo.disabled = true;

    apply.addEventListener("click", () => {
      evaluationUndo = [];
      const chooseIndex = (length) => {
        if (select.value === "first") return 0;
        if (select.value === "last") return length - 1;
        return Math.floor((length - 1) / 2);
      };
      groups.forEach((group) => {
        group.forEach((radio) => evaluationUndo.push({ element: radio, checked: radio.checked }));
        const chosen = group[chooseIndex(group.length)];
        chosen.click();
      });
      selects.forEach((pageSelect) => {
        evaluationUndo.push({ element: pageSelect, value: pageSelect.value });
        const options = [...pageSelect.options].filter((option) => !option.disabled && option.value !== "");
        if (!options.length) return;
        pageSelect.value = options[chooseIndex(options.length)].value;
        pageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      apply.dataset.state = "success";
      apply.textContent = "Aplicado para revisar ✓";
      undo.disabled = false;
      helper.textContent = "Revisa cada respuesta en SAES antes de enviar el formulario.";
      announce("Respuestas aplicadas. Revisa antes de enviar.");
      setTimeout(() => {
        delete apply.dataset.state;
        apply.textContent = "Aplicar para revisar";
      }, 2500);
    });

    undo.addEventListener("click", () => {
      evaluationUndo.forEach((snapshot) => {
        if ("checked" in snapshot) snapshot.element.checked = snapshot.checked;
        if ("value" in snapshot) {
          snapshot.element.value = snapshot.value;
          snapshot.element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      evaluationUndo = [];
      undo.disabled = true;
      helper.textContent = "Cambios deshechos.";
      announce("Cambios de evaluación deshechos");
    });

    actions.append(apply, undo);
    section.append(title, notice, field, actions);
    view.append(section);
  }

  function renderView() {
    refreshOccupancyView = null;
    view.replaceChildren();
    restoreFilteredRows();
    const navigation = document.createElement("nav");
    navigation.className = "ms-view-nav";
    navigation.setAttribute("aria-label", "Apartados de MI SAES");
    [["Horario", "schedule"], ["Herramientas", "tools"]].forEach(([label, target]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.active = String(activeView === target);
      button.setAttribute("aria-current", activeView === target ? "page" : "false");
      button.addEventListener("click", () => {
        activeView = target;
        renderView();
      });
      navigation.append(button);
    });
    view.append(navigation);
    if (activeView === "tools") renderTools();
    else renderSchedule();
  }

  launcher.addEventListener("click", () => setOpen(!isOpen));
  backdrop.addEventListener("click", () => setOpen(false));
  shadow.querySelector('[data-action="close"]').addEventListener("click", () => setOpen(false));

  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      setOpen(!isOpen);
      return;
    }
    if (event.key === "Escape" && isOpen) setOpen(false);
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "MI_SAES_TOGGLE_PANEL") setOpen(!isOpen);
    if (message?.type === "MI_SAES_OPEN_PANEL") setOpen(true);
    if (message?.type === "MI_SAES_GET_STATUS") {
      collectTables();
      sendResponse({
        available: true,
        enabled: settings.enabled,
        context,
        contextName: contextNames[context],
        open: isOpen,
        tables: tableModels.length,
        hostname: location.hostname
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[trajectoryKey]) {
      trajectorySnapshot = changes[trajectoryKey].newValue || trajectorySnapshot;
      renderTrajectoryHomeSnapshot();
    }
    if (changes.settings) {
      settings = core.mergeSettings(changes.settings.newValue || {});
      applySettings();
      if (isOpen) renderView();
    }
  });

  collectTables();
  applySettings();
  if (occupancyEnabled && (isOfferingsCatalog || isReenrollmentPage)) scheduleOccupancyRefresh(1000);
  window.addEventListener("pagehide", () => {
    clearTimeout(occupancyTimer);
    occupancyController?.abort();
    trajectoryController?.abort();
    unmountTrajectoryHome();
  }, { once: true });
})();
