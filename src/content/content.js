(async function bootMiSaes() {
  "use strict";

  const core = globalThis.MISaesCore;
  const trajectory = globalThis.MISaesTrajectory;
  const trajectoryView = globalThis.MISaesTrajectoryView;
  const studentHome = globalThis.MISaesStudentHome;
  if (!core || !trajectory || !trajectoryView || !studentHome || document.getElementById("misaes-root")) return;

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
    },
    async remove(keys) {
      return chrome.storage.local.remove(keys);
    }
  };

  const plannerKey = `planner:${location.origin}:${location.pathname}`;
  const plannerConfigKey = `planner-config:${location.origin}:schedule`;
  const catalogKey = `catalog:${location.origin}:schedule`;
  const preparedKey = `prepared:${location.origin}:schedule`;
  const occupancyKey = `occupancy:${location.origin}:schedule`;
  const occupancyPreferenceKey = `occupancy-enabled:${location.origin}`;
  const occupancyRefreshPreferenceKey = `occupancy-refresh-minutes:${location.origin}`;
  const trajectoryKey = `trajectory:${location.origin}`;
  const releaseNoticeKey = "releaseNotice";
  const storedState = await storage.get(["settings", plannerKey, plannerConfigKey, catalogKey, preparedKey, occupancyKey, occupancyPreferenceKey, occupancyRefreshPreferenceKey, trajectoryKey, releaseNoticeKey]);
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
  let studentHomeHost = null;
  let studentHomeView = null;
  let studentPhotoController = null;
  let occupancyController = null;
  let occupancyTimer = 0;
  let refreshOccupancyView = null;
  let visibleCareer = "";
  let visiblePlan = "";
  let catalogMatchesPage = true;
  let scanController = null;
  let conflicts = [];
  let plannerSelection = new Set(Array.isArray(storedState[plannerKey]) ? storedState[plannerKey] : []);
  let plannerConfigSelection = storedState[plannerConfigKey] || {};
  let plannerConfiguration = null;
  let plannerConfigurationPromise = null;
  let plannerConfigurationController = null;
  let plannerConfigurationError = "";
  let generatedSchedules = [];
  let activeGeneratedSchedule = 0;
  let showCalendarAvailability = false;
  const scheduleSortCriterion = "balanced";
  const isOfferingsCatalog = /\/academica\/horarios\.aspx$/i.test(location.pathname) || (isLocalPreview && /\/saes-schedule\.html$/i.test(location.pathname));
  const isReenrollmentPage = /\/alumnos\/reinscripciones\//i.test(location.pathname) || context === "reenrollment";
  const extensionVersion = chrome.runtime.getManifest?.().version || "0.13.0";
  const launcherCopy = core.launcherModel({ authenticated: hasAuthenticatedSession });
  let releaseNotice = storedState[releaseNoticeKey] || null;
  let isOpen = false;
  let activeView = "schedule";
  let previousFocus = null;
  const bodyWasInert = document.body.inert;
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
    <button class="ms-launcher" type="button" aria-label="${launcherCopy.ariaLabel}" aria-expanded="false">
      <span class="ms-launcher__mark" aria-hidden="true">
        <img class="ms-launcher__icon" src="${chrome.runtime.getURL("assets/icon-misaes-calendar-candidate.png")}" alt="" width="44" height="44">
        <span class="ms-launcher__dot"></span>
      </span>
      <span class="ms-launcher__copy">
        <strong class="ms-launcher__title">${launcherCopy.title}</strong>
        <span class="ms-launcher__message">${launcherCopy.message}</span>
      </span>
    </button>
    <section class="ms-panel" role="dialog" aria-modal="true" aria-labelledby="ms-title" aria-hidden="true">
      <header class="ms-panel__header">
        <div class="ms-brand">
          <img class="ms-brand__icon" src="${chrome.runtime.getURL("assets/icon-misaes-calendar-candidate.png")}" alt="" width="32" height="32">
          <h1 class="ms-brand__name" id="ms-title">MI SAES 2.0</h1>
          <p class="ms-brand__context"></p>
        </div>
        <nav class="ms-surface-switch" aria-label="Cambiar entre SAES y MI SAES">
          <button type="button" data-action="show-saes" aria-pressed="false">SAES</button>
          <button type="button" data-action="show-misaes" aria-pressed="true">MI SAES</button>
        </nav>
      </header>
      <aside class="ms-release-banner" aria-labelledby="ms-release-title" hidden>
        <div class="ms-release-banner__copy">
          <span class="ms-release-banner__version"></span>
          <h2 id="ms-release-title"></h2>
          <ul class="ms-release-banner__items"></ul>
        </div>
        <div class="ms-release-banner__actions">
          <a class="ms-button ms-button--quiet" data-release-link target="_blank" rel="noopener noreferrer">Ver todos los cambios</a>
          <button class="ms-button ms-button--primary" type="button" data-action="dismiss-release">Entendido</button>
        </div>
      </aside>
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
  const panel = shadow.querySelector(".ms-panel");
  const panelBody = shadow.querySelector(".ms-panel__body");
  const releaseBanner = shadow.querySelector(".ms-release-banner");
  const view = shadow.querySelector(".ms-view");
  const live = shadow.querySelector(".ms-live");
  shadow.querySelector(".ms-brand__context").textContent = `${contextNames[context]} · ${location.hostname} · v${extensionVersion}`;

  function renderReleaseBanner() {
    const release = releaseNotice?.version === extensionVersion ? core.releaseNotes(releaseNotice.version) : null;
    releaseBanner.hidden = !release;
    if (!release) return;
    releaseBanner.querySelector(".ms-release-banner__version").textContent = `Versión ${release.version}`;
    releaseBanner.querySelector("#ms-release-title").textContent = release.title;
    const items = releaseBanner.querySelector(".ms-release-banner__items");
    items.replaceChildren(...release.items.map((item) => {
      const entry = document.createElement("li");
      entry.textContent = item;
      return entry;
    }));
    releaseBanner.querySelector("[data-release-link]").href = release.releaseUrl;
  }

  renderReleaseBanner();

  function collectTables() {
    syncScheduleAvailabilityColumn();
    document.querySelectorAll("[data-misaes-data-table]").forEach((table) => delete table.dataset.misaesDataTable);
    document.querySelectorAll("[data-misaes-table-viewport]").forEach((container) => delete container.dataset.misaesTableViewport);
    tableModels = [...document.querySelectorAll("table")]
      .filter((table) => !host.contains(table))
      .map((element) => {
        const rowElements = [...element.rows];
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
    const visibleOfferings = isOfferingsCatalog ? core.deriveCourseOfferings(tableModels) : [];
    const pageControls = isOfferingsCatalog ? globalThis.MISaesScanner?.discoverControls(document) || {} : {};
    const careerControl = pageControls.career;
    visibleCareer = careerControl?.selectedOptions?.[0]?.textContent?.trim() || (!isOfferingsCatalog ? scanCatalog?.career || "" : "");
    visiblePlan = pageControls.plan?.selectedOptions?.[0]?.textContent?.trim()
      || (!isOfferingsCatalog ? scanCatalog?.offerings?.find((item) => item.source?.plan)?.source?.plan || "" : "");
    catalogMatchesPage = !scanCatalog || core.scheduleCatalogMatches(scanCatalog, {
      careerLabel: plannerConfigSelection.careerLabel || visibleCareer,
      planLabel: plannerConfigSelection.planLabel || visiblePlan
    });
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
    syncStudentHome();
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
    launcher.tabIndex = isOpen ? -1 : 0;
    panel.setAttribute("aria-hidden", String(!isOpen));
    if (isOpen) {
      previousFocus = shadow.activeElement || document.activeElement;
      document.body.inert = true;
      collectTables();
      renderView();
      requestAnimationFrame(() => shadow.querySelector('[data-action="show-saes"]')?.focus());
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
      ["Calcular promedio", "tools", settings.modules.tools]
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

  function formatDuration(minutes) {
    const total = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    if (!hours) return `${remainder} min`;
    if (!remainder) return `${hours} h`;
    return `${hours} h ${remainder} min`;
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

  function downloadSchedulePng(rows, days, showAvailability = false) {
    const scale = 2;
    const width = 1200;
    const headerHeight = 48;
    const rowHeight = 52;
    const footerHeight = 58;
    const height = headerHeight + rows.length * rowHeight + footerHeight;
    const groupWidth = 104;
    const subjectWidth = 340;
    const availabilityWidth = showAvailability ? 104 : 0;
    const dayWidth = (width - groupWidth - subjectWidth - availabilityWidth) / Math.max(1, days.length);
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("El navegador no pudo preparar la imagen."));
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    function fillText(text, x, y, maxWidth, { align = "left", weight = 400, color = "#292529", size = 14 } = {}) {
      context.font = `${weight} ${size}px "IBM Plex Sans", Arial, sans-serif`;
      context.fillStyle = color;
      context.textAlign = align;
      context.textBaseline = "middle";
      let value = String(text || "");
      if (context.measureText(value).width > maxWidth) {
        while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
        value = `${value}…`;
      }
      context.fillText(value, x, y, maxWidth);
    }

    context.fillStyle = "#750946";
    context.fillRect(0, 0, width, headerHeight);
    const columns = [
      { label: "Grupo", x: 0, width: groupWidth, align: "center" },
      { label: "Materia", x: groupWidth, width: subjectWidth, align: "left" },
      ...(showAvailability ? [{ label: "Lugares", x: groupWidth + subjectWidth, width: availabilityWidth, align: "center" }] : []),
      ...days.map((day, index) => ({ label: day.slice(0, 3), x: groupWidth + subjectWidth + availabilityWidth + index * dayWidth, width: dayWidth, align: "center" }))
    ];
    columns.forEach((column) => fillText(column.label, column.align === "center" ? column.x + column.width / 2 : column.x + 14, headerHeight / 2, column.width - 28, { align: column.align, weight: 700, color: "#ffffff", size: 14 }));

    rows.forEach((course, rowIndex) => {
      const top = headerHeight + rowIndex * rowHeight;
      context.fillStyle = rowIndex % 2 ? "#f5f1f3" : "#ffffff";
      context.fillRect(0, top, width, rowHeight);
      const separator = course.label.lastIndexOf(" · ");
      const subject = separator >= 0 ? course.label.slice(0, separator) : course.label;
      const group = separator >= 0 ? course.label.slice(separator + 3) : "—";
      fillText(group, groupWidth / 2, top + rowHeight / 2, groupWidth - 20, { align: "center", weight: 700, color: "#750946", size: 14 });
      fillText(subject, groupWidth + 14, top + rowHeight / 2, subjectWidth - 28, { weight: 700, size: 14 });
      if (showAvailability) {
        const availability = Number.isFinite(course.available) ? String(course.available) : "—";
        const availabilityColor = course.available === 0 ? "#a61b1b" : course.available <= 3 ? "#8a5300" : "#17633a";
        fillText(availability, groupWidth + subjectWidth + availabilityWidth / 2, top + rowHeight / 2, availabilityWidth - 20, { align: "center", weight: 700, color: Number.isFinite(course.available) ? availabilityColor : "#aaa1a7", size: 14 });
      }
      days.forEach((day, dayIndex) => {
        const dayEntries = course.entries.filter((entry) => entry.day === day).sort((left, right) => left.start - right.start || left.end - right.end);
        const value = dayEntries.length
          ? dayEntries.map((entry) => `${core.formatMinutes(entry.start)}–${core.formatMinutes(entry.end)}`).join(" / ")
          : "—";
        fillText(value, groupWidth + subjectWidth + availabilityWidth + dayIndex * dayWidth + dayWidth / 2, top + rowHeight / 2, dayWidth - 16, { align: "center", color: dayEntries.length ? "#292529" : "#aaa1a7", size: 13 });
      });
      context.strokeStyle = "#ded7db";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, top + rowHeight - 0.5);
      context.lineTo(width, top + rowHeight - 0.5);
      context.stroke();
    });

    const footerTop = headerHeight + rows.length * rowHeight;
    context.fillStyle = "#f5f1f3";
    context.fillRect(0, footerTop, width, footerHeight);
    context.fillStyle = "#750946";
    context.beginPath();
    context.arc(width / 2 - 132, footerTop + footerHeight / 2, 4, 0, Math.PI * 2);
    context.fill();
    fillText("Horario generado por", width / 2 - 118, footerTop + footerHeight / 2, 160, { color: "#6d6369", size: 13 });
    fillText("MI SAES 2.0", width / 2 + 32, footerTop + footerHeight / 2, 180, { weight: 700, color: "#750946", size: 14 });

    const dataUrl = canvas.toDataURL("image/png");
    const binary = atob(dataUrl.split(",")[1] || "");
    if (!binary) return Promise.reject(new Error("El navegador no pudo generar el PNG."));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mi-saes-horario-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Promise.resolve();
  }

  function buildCalendarGrid(entries, conflictingEntries = new Set(), options = {}) {
    const offerings = Array.isArray(options.offerings) ? options.offerings : [];
    const availabilityEnabled = options.availabilityEnabled === true;
    const displayAvailability = availabilityEnabled && showCalendarAvailability;
    const availabilityByLabel = new Map();
    offerings.forEach((offering) => {
      const label = String(offering.entries?.[0]?.label || `${offering.subject || "Materia sin nombre"} · ${offering.group || "—"}`).trim();
      const record = occupancyFor(offering);
      availabilityByLabel.set(label, Number.isFinite(record?.available) ? record.available : null);
    });
    const frame = document.createElement("figure");
    frame.className = "ms-calendar-frame";
    const wrapper = document.createElement("div");
    wrapper.className = "ms-calendar-scroll";
    const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const days = dayOrder.filter((day) => entries.some((entry) => entry.day === day));
    const courses = new Map();
    entries.forEach((entry) => {
      const label = String(entry.label || "Materia sin nombre").trim();
      if (!courses.has(label)) courses.set(label, { label, entries: [], available: availabilityByLabel.get(label) });
      courses.get(label).entries.push(entry);
    });
    const rows = [...courses.values()].sort((left, right) => {
      const leftStart = Math.min(...left.entries.map((entry) => entry.start));
      const rightStart = Math.min(...right.entries.map((entry) => entry.start));
      return leftStart - rightStart || left.label.localeCompare(right.label, "es-MX");
    });

    const table = document.createElement("table");
    table.className = "ms-calendar-table";
    table.setAttribute("aria-label", "Horario semanal generado");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Grupo", "Materia", ...(displayAvailability ? ["Lugares"] : []), ...days.map((day) => day.slice(0, 3))].forEach((label, index) => {
      const header = document.createElement("th");
      header.scope = "col";
      header.textContent = label;
      const dayIndex = index - 2 - (displayAvailability ? 1 : 0);
      if (dayIndex >= 0) header.title = days[dayIndex];
      headerRow.append(header);
    });
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((course) => {
      const row = document.createElement("tr");
      const separator = course.label.lastIndexOf(" · ");
      const subject = separator >= 0 ? course.label.slice(0, separator) : course.label;
      const group = separator >= 0 ? course.label.slice(separator + 3) : "—";
      const groupCell = document.createElement("th");
      groupCell.scope = "row";
      groupCell.className = "ms-calendar-table__group";
      groupCell.textContent = group;
      const subjectCell = document.createElement("td");
      subjectCell.className = "ms-calendar-table__subject";
      subjectCell.textContent = subject;
      subjectCell.title = subject;
      row.append(groupCell, subjectCell);
      if (displayAvailability) {
        const availabilityCell = document.createElement("td");
        availabilityCell.className = "ms-calendar-table__availability";
        availabilityCell.dataset.state = !Number.isFinite(course.available) ? "unknown" : course.available === 0 ? "full" : course.available <= 3 ? "low" : "available";
        availabilityCell.textContent = Number.isFinite(course.available) ? String(course.available) : "—";
        availabilityCell.title = Number.isFinite(course.available)
          ? `${course.available} lugar${course.available === 1 ? "" : "es"} disponible${course.available === 1 ? "" : "s"}`
          : "Sin información actual de lugares";
        row.append(availabilityCell);
      }
      days.forEach((day) => {
        const cell = document.createElement("td");
        const dayEntries = course.entries
          .filter((entry) => entry.day === day)
          .sort((left, right) => left.start - right.start || left.end - right.end);
        if (!dayEntries.length) {
          cell.className = "ms-calendar-table__empty";
          cell.textContent = "—";
        } else {
          dayEntries.forEach((entry) => {
            const time = document.createElement("span");
            time.className = "ms-calendar-table__time";
            time.dataset.calendarEntry = "true";
            time.dataset.state = conflictingEntries.has(entry) ? "conflict" : "compatible";
            time.textContent = `${core.formatMinutes(entry.start)}–${core.formatMinutes(entry.end)}`;
            cell.append(time);
          });
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    wrapper.append(table);
    const signature = document.createElement("figcaption");
    signature.className = "ms-calendar-signature";
    if (options.showAvailabilityControl) {
      const availabilityControl = document.createElement("label");
      availabilityControl.className = "ms-calendar-availability";
      const availabilityCheckbox = document.createElement("input");
      availabilityCheckbox.type = "checkbox";
      availabilityCheckbox.dataset.calendarAvailability = "true";
      availabilityCheckbox.checked = displayAvailability;
      availabilityCheckbox.disabled = !availabilityEnabled;
      availabilityCheckbox.setAttribute("aria-label", "Mostrar lugares actuales");
      if (!availabilityEnabled) availabilityControl.title = "Activa Mostrar lugares disponibles y consulta SAES para ver los cupos actuales.";
      availabilityCheckbox.addEventListener("change", () => {
        showCalendarAvailability = availabilityCheckbox.checked;
        options.onAvailabilityChange?.(showCalendarAvailability);
      });
      availabilityControl.append(availabilityCheckbox, document.createTextNode("Mostrar lugares actuales"));
      signature.append(availabilityControl);
    }
    const signatureCopy = document.createElement("span");
    signatureCopy.className = "ms-calendar-signature__copy";
    signatureCopy.append(document.createTextNode("Horario generado por "));
    const brand = document.createElement("strong");
    brand.textContent = "MI SAES 2.0";
    signatureCopy.append(brand);
    const pngButton = document.createElement("button");
    pngButton.type = "button";
    pngButton.className = "ms-button ms-button--quiet ms-calendar-signature__download";
    pngButton.dataset.downloadSchedulePng = "true";
    pngButton.textContent = "Descargar PNG";
    pngButton.addEventListener("click", async () => {
      pngButton.disabled = true;
      pngButton.textContent = "Generando PNG";
      try {
        await downloadSchedulePng(rows, days, displayAvailability);
        pngButton.dataset.state = "success";
        pngButton.textContent = "PNG descargado";
        announce("Horario descargado como PNG");
      } catch (error) {
        pngButton.dataset.state = "error";
        pngButton.textContent = "Reintentar PNG";
        announce(error?.message || "No fue posible generar el PNG");
      } finally {
        pngButton.disabled = false;
        setTimeout(() => {
          delete pngButton.dataset.state;
          pngButton.textContent = "Descargar PNG";
        }, 2200);
      }
    });
    signature.append(signatureCopy, pngButton);
    frame.append(wrapper, signature);
    return frame;
  }

  function renderCalendarExport(entries, parent, label = "horario") {
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
    lede.textContent = "Elige las materias que quieres cursar, descarta los grupos que no aceptarías y genera horarios sin empalmes. Nada se envía a SAES.";
    const workflow = document.createElement("ol");
    workflow.className = "ms-planner-steps";
    const workflowSteps = [
      ["Escanea", "Carga todas las materias"],
      ["Materias", "Elige qué quieres cursar"],
      ["Grupos", "Ajusta alternativas y genera"]
    ].map(([title, detail], index) => {
      const item = document.createElement("li");
      item.className = "ms-planner-step";
      const number = document.createElement("span");
      number.className = "ms-planner-step__number";
      number.textContent = String(index + 1);
      const copy = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = title;
      const small = document.createElement("small");
      small.textContent = detail;
      copy.append(strong, small);
      item.append(number, copy);
      workflow.append(item);
      return item;
    });
    intro.append(heading, lede, workflow);
    view.append(intro);

    async function ensurePlannerConfiguration({ careerValue = plannerConfigSelection.careerValue || "", force = false } = {}) {
      if (!globalThis.MISaesScanner?.loadConfiguration) return;
      if (plannerConfigurationPromise && !force) return plannerConfigurationPromise;
      if (force) plannerConfigurationController?.abort();
      plannerConfigurationController = new AbortController();
      plannerConfigurationError = "";
      const controller = plannerConfigurationController;
      plannerConfigurationPromise = globalThis.MISaesScanner.loadConfiguration({
        rootDocument: isOfferingsCatalog ? document : undefined,
        url: scheduleDestination(),
        careerValue,
        signal: controller.signal
      }).then(async (configuration) => {
        plannerConfiguration = configuration;
        const selectedCareer = configuration.careers.find((option) => option.value === (careerValue || plannerConfigSelection.careerValue))
          || configuration.careers.find((option) => option.value === configuration.selectedCareer)
          || configuration.careers[0];
        const selectedPlan = configuration.plans.find((option) => option.value === plannerConfigSelection.planValue)
          || configuration.plans.find((option) => option.value === configuration.selectedPlan)
          || configuration.plans[0];
        const selectedMode = configuration.modes.find((option) => option.value === String(plannerConfigSelection.modeIndex ?? configuration.selectedMode))
          || configuration.modes[0];
        plannerConfigSelection = {
          careerValue: selectedCareer?.value || "",
          careerLabel: selectedCareer?.label || "",
          planValue: selectedPlan?.value || "",
          planLabel: selectedPlan?.label || "",
          modeIndex: selectedMode?.value || "0",
          modeLabel: selectedMode?.label || "Periodo actual"
        };
        await storage.set({ [plannerConfigKey]: plannerConfigSelection });
      }).catch((error) => {
        if (error?.name !== "AbortError") plannerConfigurationError = error?.message || "No pudimos cargar Carrera y Plan de estudio.";
      }).finally(() => {
        if (plannerConfigurationController === controller) plannerConfigurationController = null;
        plannerConfigurationPromise = null;
        if (isOpen && activeView === "schedule") renderView();
      });
      return plannerConfigurationPromise;
    }

    if (!plannerConfiguration && !plannerConfigurationPromise) void ensurePlannerConfiguration();

    const scanSection = document.createElement("section");
    scanSection.className = "ms-scan";
    const scanCopy = document.createElement("div");
    scanCopy.className = "ms-scan__copy";
    const scanTitle = document.createElement("strong");
    const catalogMatchesConfiguration = !scanCatalog || core.scheduleCatalogMatches(scanCatalog, plannerConfigSelection);
    scanTitle.textContent = scanCatalog && catalogMatchesConfiguration ? `Materias escaneadas · ${scanCatalog.career}` : "Configura y escanea tus materias";
    const scanDetail = document.createElement("p");
    scanDetail.className = "ms-helper";
    if (scanCatalog && catalogMatchesConfiguration) {
      const periods = new Set(scanCatalog.offerings.map((item) => item.source?.period).filter(Boolean));
      const shifts = new Set(scanCatalog.offerings.map((item) => item.source?.shift).filter(Boolean));
      const updated = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(scanCatalog.scannedAt));
      scanDetail.textContent = `${core.countLabel(scanCatalog.offerings.length, "grupo", "grupos")} · ${core.countLabel(periods.size, "periodo", "periodos")} · ${core.countLabel(shifts.size, "turno", "turnos")} · ${updated}`;
    } else if (scanCatalog && !catalogMatchesConfiguration) {
      scanDetail.textContent = `El catálogo guardado pertenece a ${scanCatalog.career} · ${scanCatalog.plan || scanCatalog.offerings?.[0]?.source?.plan || "plan no indicado"}. Escanea la nueva configuración para no mezclar planes.`;
    } else {
      scanDetail.textContent = "Elige Carrera y Plan de estudio. Después recorreremos todos sus turnos y periodos mediante consultas secuenciales de sólo lectura.";
    }
    scanCopy.append(scanTitle, scanDetail);
    const configurationFields = document.createElement("div");
    configurationFields.className = "ms-scan-config";
    function makeConfigurationField(labelText, options, value, { disabled = false } = {}) {
      const field = document.createElement("label");
      field.className = "ms-field";
      const label = document.createElement("span");
      label.className = "ms-label";
      label.textContent = labelText;
      const select = document.createElement("select");
      select.className = "ms-select";
      select.disabled = disabled;
      if (!options?.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = plannerConfigurationPromise ? "Cargando…" : "No disponible";
        select.append(option);
      } else {
        options.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.label;
          option.selected = item.value === value;
          select.append(option);
        });
      }
      field.append(label, select);
      return { field, select };
    }
    const careerField = makeConfigurationField("Carrera", plannerConfiguration?.careers, plannerConfigSelection.careerValue, { disabled: !plannerConfiguration || Boolean(plannerConfigurationPromise) });
    const planField = makeConfigurationField("Plan de estudio", plannerConfiguration?.plans, plannerConfigSelection.planValue, { disabled: !plannerConfiguration || !plannerConfigSelection.careerValue || Boolean(plannerConfigurationPromise) });
    const modeField = makeConfigurationField("Periodo escolar", plannerConfiguration?.modes, String(plannerConfigSelection.modeIndex ?? "0"), { disabled: !plannerConfiguration || Boolean(plannerConfigurationPromise) });
    configurationFields.append(careerField.field, planField.field, modeField.field);
    const configurationStatus = document.createElement("p");
    configurationStatus.className = "ms-helper ms-scan-config__status";
    configurationStatus.setAttribute("role", "status");
    configurationStatus.setAttribute("aria-live", "polite");
    if (plannerConfigurationError) {
      configurationStatus.dataset.state = "error";
      configurationStatus.textContent = `${plannerConfigurationError} Abre Horarios de clase y vuelve a intentarlo.`;
    } else if (plannerConfigurationPromise) {
      configurationStatus.textContent = "Cargando carreras y planes disponibles en SAES…";
    } else {
      configurationStatus.textContent = "El plan depende de la carrera. El escaneo incluirá todos sus turnos y periodos.";
    }
    const scanActions = document.createElement("div");
    scanActions.className = "ms-row";
    const scanButton = document.createElement("button");
    scanButton.type = "button";
    scanButton.className = "ms-button ms-button--primary";
    function scanButtonLabel() {
      if (occupancyEnabled) return scanCatalog ? "Actualizar todo" : "Escanear todo";
      return scanCatalog ? "Actualizar materias" : "Escanear materias";
    }
    scanButton.textContent = scanButtonLabel();
    const configurationReady = Boolean(plannerConfiguration && plannerConfigSelection.careerValue && plannerConfigSelection.planValue);
    scanButton.disabled = !configurationReady;
    const clearScanButton = document.createElement("button");
    clearScanButton.type = "button";
    clearScanButton.className = "ms-button ms-button--clear";
    clearScanButton.textContent = "Limpiar";
    clearScanButton.hidden = !scanCatalog;
    clearScanButton.setAttribute("aria-label", "Limpiar materias escaneadas");
    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "ms-button";
    stopButton.textContent = "Detener";
    stopButton.hidden = true;
    scanActions.append(scanButton, clearScanButton, stopButton);
    const scanProgress = document.createElement("progress");
    scanProgress.className = "ms-scan__progress";
    scanProgress.hidden = true;
    const scanStatus = document.createElement("p");
    scanStatus.className = "ms-helper ms-scan__status";
    scanStatus.setAttribute("role", "status");
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
        occupancyStatus.textContent = occupancyCatalog?.records?.length
          ? `${message} Se conservaron los últimos datos disponibles.`
          : `${message} No se mostrarán lugares hasta que SAES responda.`;
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
    scanSection.append(scanCopy, configurationFields, configurationStatus, scanActions, scanProgress, scanStatus, occupancyTools);
    view.append(scanSection);
    refreshOccupancyView = updateOccupancyStatus;
    workflowSteps[0].dataset.state = courseOfferings.length ? "complete" : "active";
    workflowSteps[1].dataset.state = courseOfferings.length ? "active" : "pending";
    workflowSteps[2].dataset.state = "pending";

    careerField.select.addEventListener("change", async () => {
      const selected = plannerConfiguration?.careers.find((option) => option.value === careerField.select.value);
      plannerConfigSelection = {
        ...plannerConfigSelection,
        careerValue: selected?.value || "",
        careerLabel: selected?.label || "",
        planValue: "",
        planLabel: ""
      };
      plannerConfiguration = null;
      courseOfferings = [];
      plannerSelection.clear();
      generatedSchedules = [];
      await storage.set({ [plannerConfigKey]: plannerConfigSelection, [plannerKey]: [] });
      renderView();
    });
    planField.select.addEventListener("change", async () => {
      const selected = plannerConfiguration?.plans.find((option) => option.value === planField.select.value);
      plannerConfigSelection = { ...plannerConfigSelection, planValue: selected?.value || "", planLabel: selected?.label || "" };
      courseOfferings = [];
      plannerSelection.clear();
      generatedSchedules = [];
      await storage.set({ [plannerConfigKey]: plannerConfigSelection, [plannerKey]: [] });
      renderView();
    });
    modeField.select.addEventListener("change", async () => {
      const selected = plannerConfiguration?.modes.find((option) => option.value === modeField.select.value);
      plannerConfigSelection = { ...plannerConfigSelection, modeIndex: selected?.value || "0", modeLabel: selected?.label || "Periodo actual" };
      courseOfferings = [];
      plannerSelection.clear();
      generatedSchedules = [];
      await storage.set({ [plannerConfigKey]: plannerConfigSelection, [plannerKey]: [] });
      renderView();
    });

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
      scanButton.textContent = "Escaneando materias";
      delete scanStatus.dataset.state;
      stopButton.hidden = false;
      scanProgress.hidden = false;
      scanStatus.textContent = "Preparando los selectores de SAES…";
      const previousSelected = courseOfferings.filter((offering) => plannerSelection.has(offering.id));
      try {
        const result = await globalThis.MISaesScanner.scan({
          rootDocument: isOfferingsCatalog ? document : undefined,
          url: scheduleDestination(),
          core,
          signal: scanController.signal,
          includeNext: false,
          careerValue: plannerConfigSelection.careerValue,
          planValue: plannerConfigSelection.planValue,
          modeIndex: plannerConfigSelection.modeIndex,
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
          scanStatus.dataset.state = "warning";
          announce("Escaneo detenido");
        } else {
          const recovery = scanCatalog
            ? "Conservamos las materias escaneadas anteriormente. Corrige el problema y vuelve a intentarlo."
            : "Revisa tu sesión y los filtros visibles de SAES; después vuelve a intentarlo.";
          scanStatus.textContent = `No pudimos actualizar las materias. ${error?.message || "SAES no devolvió una respuesta válida."} ${recovery}`;
          scanStatus.dataset.state = "error";
          scanButton.dataset.state = "error";
          announce(scanStatus.textContent);
        }
      } finally {
        scanController = null;
        scanButton.disabled = !configurationReady;
        if (scanButton.dataset.state !== "error") delete scanButton.dataset.state;
        scanButton.textContent = scanButtonLabel();
        stopButton.hidden = true;
        scanProgress.hidden = true;
      }
    });
    clearScanButton.addEventListener("click", async () => {
      if (scanController || !scanCatalog) return;
      const confirmed = globalThis.confirm("¿Limpiar las materias escaneadas? También se quitará la selección actual.");
      if (!confirmed) return;
      clearScanButton.disabled = true;
      try {
        clearTimeout(occupancyTimer);
        occupancyController?.abort();
        const cleared = await core.clearScannedScheduleData(storage, { catalogKey, plannerKey, occupancyKey });
        scanCatalog = cleared.scanCatalog;
        occupancyCatalog = cleared.occupancyCatalog;
        plannerSelection = new Set(cleared.plannerSelection);
        generatedSchedules = cleared.generatedSchedules;
        activeGeneratedSchedule = cleared.activeGeneratedSchedule;
        courseOfferings = isOfferingsCatalog ? core.deriveCourseOfferings(tableModels) : [];
        announce("Materias escaneadas eliminadas");
        renderView();
      } catch (error) {
        clearScanButton.disabled = false;
        scanStatus.textContent = `No pudimos limpiar las materias escaneadas. ${error?.message || "Vuelve a intentarlo."}`;
        scanStatus.dataset.state = "error";
        announce(scanStatus.textContent);
      }
    });
    stopButton.addEventListener("click", () => scanController?.abort());

    if (!courseOfferings.length) {
      view.append(makeEmpty("Aún no hay grupos para planear", `Selecciona tu carrera en SAES y pulsa “${scanButtonLabel()}”.`));
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
    browserTitle.textContent = "Elige tus materias";
    const search = document.createElement("input");
    search.className = "ms-input";
    search.type = "search";
    search.placeholder = "Buscar materia, grupo o profesor";
    search.setAttribute("aria-label", "Buscar materia disponible");
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
    filterBar.setAttribute("aria-label", "Filtros de materias");
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
    planTitle.textContent = "Materias y grupos aceptables";
    const selectionCount = document.createElement("span");
    selectionCount.className = "ms-count";
    planHeader.append(planTitle, selectionCount);
    const planStatus = document.createElement("section");
    planStatus.className = "ms-plan-status";
    planStatus.setAttribute("role", "status");
    planStatus.setAttribute("aria-live", "polite");
    planStatus.setAttribute("aria-atomic", "true");
    planStatus.tabIndex = -1;
    const selectionSummary = document.createElement("div");
    selectionSummary.className = "ms-selection-summary";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "ms-button ms-button--primary";
    generate.textContent = "Generar horarios";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ms-button";
    clear.textContent = "Quitar materias";
    const actions = document.createElement("div");
    actions.className = "ms-row ms-plan-actions";
    actions.append(generate, clear);
    const generateHelp = document.createElement("p");
    generateHelp.id = "ms-generate-help";
    generateHelp.className = "ms-helper ms-generate-help";
    generate.setAttribute("aria-describedby", generateHelp.id);
    const plannerActionBar = document.createElement("section");
    plannerActionBar.className = "ms-planner-actionbar";
    plannerActionBar.setAttribute("aria-label", "Acciones del generador de horarios");
    plannerActionBar.append(actions, generateHelp);
    const proposals = document.createElement("div");
    proposals.className = "ms-proposals";
    plan.append(planHeader, planStatus, selectionSummary);
    workspace.append(browser, plan, plannerActionBar, proposals);
    view.append(workspace);

    let generationError = "";
    let plannerStorageError = "";

    function selectedOfferings() {
      return courseOfferings.filter((offering) => plannerSelection.has(offering.id));
    }

    async function persistPlannerSelection() {
      plannerStorageError = "";
      try {
        await storage.set({ [plannerKey]: [...plannerSelection] });
        return true;
      } catch {
        plannerStorageError = "No pudimos guardar tu selección en Chrome. Puedes seguir comparando, pero se perderá al cerrar esta pestaña.";
        announce("No fue posible guardar la selección del horario");
        return false;
      }
    }

    async function removeCandidate(offering) {
      plannerSelection.delete(offering.id);
      generatedSchedules = [];
      generationError = "";
      await persistPlannerSelection();
      renderOptions();
      updatePlan();
      announce(`${offering.subject}, grupo ${offering.group}, quitado`);
    }

    function updateWorkflow(diagnostics) {
      const hasOfferings = courseOfferings.length > 0;
      const hasSelection = selectedOfferings().length > 0;
      workflowSteps[0].dataset.state = hasOfferings ? "complete" : "active";
      workflowSteps[1].dataset.state = hasSelection ? "complete" : hasOfferings ? "active" : "pending";
      workflowSteps[2].dataset.state = generatedSchedules.length
        ? "complete"
        : generationError || diagnostics.state === "blocked" || diagnostics.state === "conflict"
        ? "error"
        : hasSelection
        ? "active"
        : "pending";
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
      const comparison = selected.filter((candidate) => core.normalizeText(candidate.subject) !== core.normalizeText(offering.subject));
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
      const filteredSubjects = core.plannerSubjectGroups(filtered, plannerSelection);
      resultCount.textContent = `${filteredSubjects.length} de ${core.plannerSubjectGroups(courseOfferings).length} materias`;
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
      filteredSubjects.forEach((subjectGroup) => {
        const allSubjectOfferings = courseOfferings.filter((offering) => core.normalizeText(offering.subject) === subjectGroup.key);
        const acceptedCount = allSubjectOfferings.filter((offering) => plannerSelection.has(offering.id)).length;
        const subjectCard = document.createElement("article");
        subjectCard.className = "ms-subject-option";
        subjectCard.dataset.selected = acceptedCount ? "true" : "false";
        const subjectLead = document.createElement("label");
        subjectLead.className = "ms-subject-option__lead";
        const subjectCheckbox = document.createElement("input");
        subjectCheckbox.type = "checkbox";
        subjectCheckbox.checked = acceptedCount > 0;
        subjectCheckbox.setAttribute("aria-label", `Seleccionar materia ${subjectGroup.subject}`);
        const subjectCopy = document.createElement("span");
        subjectCopy.className = "ms-subject-option__copy";
        const subjectName = document.createElement("strong");
        subjectName.textContent = subjectGroup.subject;
        const subjectMeta = document.createElement("span");
        subjectMeta.textContent = acceptedCount
          ? `${acceptedCount} de ${allSubjectOfferings.length} grupos aceptados`
          : `${allSubjectOfferings.length} grupo${allSubjectOfferings.length === 1 ? "" : "s"} disponible${allSubjectOfferings.length === 1 ? "" : "s"}`;
        subjectCopy.append(subjectName, subjectMeta);
        subjectLead.append(subjectCheckbox, subjectCopy);
        subjectCard.append(subjectLead);

        if (acceptedCount) {
          const groupList = document.createElement("div");
          groupList.className = "ms-subject-groups";
          allSubjectOfferings.forEach((offering) => {
            const occupancy = occupancyFor(offering);
            const fitConflicts = conflictsForOffering(offering, selected);
            const groupLabel = document.createElement("label");
            groupLabel.className = "ms-subject-group";
            groupLabel.dataset.fit = fitConflicts.length ? "conflict" : "compatible";
            const groupCheckbox = document.createElement("input");
            groupCheckbox.type = "checkbox";
            groupCheckbox.checked = plannerSelection.has(offering.id);
            groupCheckbox.setAttribute("aria-label", `Aceptar grupo ${offering.group} de ${offering.subject}`);
            const groupCopy = document.createElement("span");
            groupCopy.className = "ms-subject-group__copy";
            const groupTop = document.createElement("span");
            groupTop.className = "ms-subject-group__top";
            const groupName = document.createElement("strong");
            groupName.textContent = offering.group;
            const groupSource = document.createElement("span");
            groupSource.textContent = offering.source ? `P${offering.source.period} · ${offering.source.shift}` : "Periodo no indicado";
            groupTop.append(groupName, groupSource);
            const teacher = document.createElement("span");
            teacher.textContent = offering.teacher || "Profesor no indicado";
            const times = document.createElement("span");
            times.textContent = formatOfferingTimes(offering) || "Horario no indicado";
            groupCopy.append(groupTop, teacher, times);
            if (occupancy) {
              const capacity = document.createElement("span");
              capacity.className = "ms-capacity-tag";
              capacity.dataset.state = occupancy.available === 0 ? "full" : occupancy.available <= 3 ? "low" : "available";
              capacity.textContent = occupancy.available === 0 ? "Lleno" : `${occupancy.available} lugar${occupancy.available === 1 ? "" : "es"}`;
              groupTop.append(capacity);
            }
            groupLabel.append(groupCheckbox, groupCopy);
            groupCheckbox.addEventListener("change", async () => {
              if (groupCheckbox.checked) plannerSelection.add(offering.id);
              else plannerSelection.delete(offering.id);
              generatedSchedules = [];
              generationError = "";
              activeGeneratedSchedule = 0;
              await persistPlannerSelection();
              renderOptions();
              updatePlan();
            });
            groupList.append(groupLabel);
          });
          subjectCard.append(groupList);
        }

        subjectCheckbox.addEventListener("change", async () => {
          plannerSelection = core.setPlannerSubjectSelected(courseOfferings, plannerSelection, subjectGroup.subject, subjectCheckbox.checked);
          generatedSchedules = [];
          generationError = "";
          activeGeneratedSchedule = 0;
          await persistPlannerSelection();
          renderOptions();
          updatePlan();
          announce(subjectCheckbox.checked
            ? `${subjectGroup.subject}: todos sus grupos están disponibles para generar`
            : `${subjectGroup.subject} se quitó de tus materias`);
        });
        optionList.append(subjectCard);
      });
    }

    function renderProposals() {
      proposals.replaceChildren();
      if (!generatedSchedules.length) {
        const selected = selectedOfferings();
        if (!selected.length) return;
        const pending = document.createElement("p");
        pending.className = "ms-helper ms-proposals__pending";
        pending.textContent = "Genera horarios para ver una combinación completa. Los grupos de una misma materia son alternativas y no se muestran juntos.";
        proposals.append(pending);
        return;
      }
      const carousel = document.createElement("div");
      carousel.className = "ms-proposal-carousel";
      const carouselLabel = document.createElement("strong");
      carouselLabel.className = "ms-proposal-carousel__label";
      carouselLabel.textContent = "Horarios generados";
      const carouselActions = document.createElement("div");
      carouselActions.className = "ms-proposal-carousel__actions";
      const previous = document.createElement("button");
      previous.type = "button";
      previous.className = "ms-button ms-button--quiet ms-proposal-carousel__nav";
      previous.textContent = "Anterior";
      const next = document.createElement("button");
      next.type = "button";
      next.className = "ms-button ms-button--quiet ms-proposal-carousel__nav";
      next.textContent = "Siguiente";
      carouselActions.append(previous, next);
      const track = document.createElement("div");
      track.className = "ms-proposal-carousel__track";
      track.setAttribute("aria-label", "Horarios generados");
      const cards = [];
      generatedSchedules.forEach((schedule, index) => {
        const metrics = schedule.metrics || core.scheduleMetrics(schedule.entries);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "ms-proposal-card";
        card.dataset.scheduleIndex = String(index);
        card.setAttribute("aria-pressed", String(index === activeGeneratedSchedule));
        card.setAttribute("aria-label", `Ver ${core.generatedScheduleCopy(generatedSchedules.length, index).option}, ${metrics.attendanceDays} días y ${formatDuration(metrics.idleMinutes)} libres`);
        const cardTitle = document.createElement("strong");
        cardTitle.textContent = core.generatedScheduleCopy(generatedSchedules.length, index).option;
        const cardMetrics = document.createElement("span");
        cardMetrics.className = "ms-proposal-card__metrics";
        cardMetrics.textContent = `${metrics.attendanceDays} días · ${formatDuration(metrics.idleMinutes)} libres`;
        const cardGroups = document.createElement("span");
        cardGroups.className = "ms-proposal-card__groups";
        cardGroups.textContent = (schedule.offerings || []).map((offering) => offering.group).filter(Boolean).join(" · ") || "Grupos sin identificar";
        card.append(cardTitle, cardMetrics, cardGroups);
        cards.push(card);
        track.append(card);
      });
      const carouselTop = document.createElement("div");
      carouselTop.className = "ms-proposal-carousel__header";
      carouselTop.append(carouselLabel, carouselActions);
      carousel.append(carouselTop, track);
      const preview = document.createElement("div");
      preview.className = "ms-proposal-preview";

      function drawProposal(index = activeGeneratedSchedule, shouldFocus = false) {
        activeGeneratedSchedule = Math.max(0, Math.min(generatedSchedules.length - 1, Number(index)));
        const selected = generatedSchedules[activeGeneratedSchedule];
        if (!selected) return;
        cards.forEach((card, cardIndex) => {
          const isActive = cardIndex === activeGeneratedSchedule;
          card.setAttribute("aria-pressed", String(isActive));
          card.tabIndex = isActive ? 0 : -1;
        });
        const activeCard = cards[activeGeneratedSchedule];
        activeCard?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        if (shouldFocus) activeCard?.focus({ preventScroll: true });
        const metrics = selected.metrics || core.scheduleMetrics(selected.entries);
        const metricList = document.createElement("dl");
        metricList.className = "ms-schedule-metrics";
        [
          ["Días", String(metrics.attendanceDays)],
          ["Horas de clase", formatDuration(metrics.classMinutes)],
          ["Tiempo libre", formatDuration(metrics.idleMinutes)],
          ["Primera entrada", core.formatMinutes(metrics.earliestStart)],
          ["Última salida", core.formatMinutes(metrics.latestEnd)]
        ].forEach(([label, value]) => {
          const metric = document.createElement("div");
          metric.className = "ms-schedule-metric";
          const term = document.createElement("dt");
          term.textContent = label;
          const detail = document.createElement("dd");
          detail.textContent = value;
          metric.append(term, detail);
          metricList.append(metric);
        });
        preview.replaceChildren();
        preview.append(metricList, buildCalendarGrid(selected.entries, new Set(), {
          offerings: selected.offerings,
          availabilityEnabled: occupancyEnabled && Boolean(occupancyCatalog?.records?.length),
          showAvailabilityControl: true,
          onAvailabilityChange: () => drawProposal(activeGeneratedSchedule)
        }));
      }
      cards.forEach((card, index) => card.addEventListener("click", () => {
        drawProposal(index);
        announce(`${core.generatedScheduleCopy(generatedSchedules.length, index).option} seleccionada`);
      }));
      previous.addEventListener("click", () => drawProposal((activeGeneratedSchedule - 1 + generatedSchedules.length) % generatedSchedules.length, true));
      next.addEventListener("click", () => drawProposal((activeGeneratedSchedule + 1) % generatedSchedules.length, true));
      track.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        drawProposal((activeGeneratedSchedule + offset + generatedSchedules.length) % generatedSchedules.length, true);
      });
      proposals.append(carousel, preview);
      drawProposal();
    }

    function updatePlan() {
      const selected = selectedOfferings();
      const selectedSubjects = core.plannerSubjectGroups(courseOfferings, plannerSelection).filter((subject) => subject.selected);
      const fullSelected = occupancyEnabled ? selected.filter((offering) => occupancyFor(offering)?.available === 0) : [];
      const generation = generationCandidates(selected);
      // Un solo diagnóstico alimenta el resumen, los pasos y las recuperaciones para evitar mensajes contradictorios.
      const diagnostics = core.plannerDiagnostics(selected, { blockedSubjects: generation.blockedSubjects });
      selectionCount.textContent = `${selectedSubjects.length} materia${selectedSubjects.length === 1 ? "" : "s"}`;
      generate.disabled = !selected.length || generation.blockedSubjects.length > 0;
      generate.removeAttribute("title");
      clear.disabled = !selected.length;
      planStatus.replaceChildren();
      const statusCopy = document.createElement("div");
      const statusTitle = document.createElement("strong");
      const statusDetail = document.createElement("p");
      statusDetail.className = "ms-helper";
      if (plannerStorageError) {
        planStatus.dataset.state = "error";
        statusTitle.textContent = "Tu selección no quedó guardada";
        statusDetail.textContent = plannerStorageError;
      } else if (generationError) {
        planStatus.dataset.state = "error";
        statusTitle.textContent = "No encontramos un horario completo";
        statusDetail.textContent = generationError;
      } else {
        planStatus.dataset.state = diagnostics.state;
        statusTitle.textContent = diagnostics.title;
        statusDetail.textContent = diagnostics.detail;
      }
      statusCopy.append(statusTitle, statusDetail);
      const statusMark = document.createElement("span");
      statusMark.className = "ms-plan-status__mark";
      statusMark.setAttribute("aria-hidden", "true");
      planStatus.append(statusMark, statusCopy);
      generateHelp.textContent = generate.disabled
        ? diagnostics.state === "blocked"
          ? "Elige una alternativa con lugares para cada materia antes de generar."
          : "Selecciona al menos una materia."
        : diagnostics.state === "conflict"
        ? "El generador probará tus alternativas para evitar los traslapes señalados."
        : `Usaremos ${selected.length} grupo${selected.length === 1 ? "" : "s"} aceptado${selected.length === 1 ? "" : "s"} para crear hasta 30 horarios.`;
      if (plannerStorageError || generationError) generateHelp.dataset.state = "error";
      else delete generateHelp.dataset.state;
      updateWorkflow(diagnostics);
      selectionSummary.replaceChildren();
      selectionSummary.hidden = !selected.length;
      if (selected.length) {
        if (diagnostics.conflicts.length) {
          const conflictIssues = document.createElement("ul");
          conflictIssues.className = "ms-planner-issues";
          diagnostics.conflicts.slice(0, 8).forEach((conflict) => {
            const issue = document.createElement("li");
            const issueCopy = document.createElement("div");
            const issueTitle = document.createElement("strong");
            issueTitle.textContent = formatConflictWindow(conflict);
            const issueDetail = document.createElement("p");
            issueDetail.className = "ms-helper";
            const left = conflict.leftOffering;
            const right = conflict.rightOffering;
            issueDetail.textContent = left && right
              ? `${left.subject} (${left.group}) coincide con ${right.subject} (${right.group}).`
              : `${conflict.left.label} coincide con ${conflict.right.label}.`;
            issueCopy.append(issueTitle, issueDetail);
            const issueActions = document.createElement("div");
            issueActions.className = "ms-planner-issue__actions";
            [left, right].filter(Boolean).forEach((offering) => {
              const removeIssue = document.createElement("button");
              removeIssue.type = "button";
              removeIssue.className = "ms-button ms-button--quiet";
              removeIssue.textContent = `Quitar ${offering.group}`;
              removeIssue.setAttribute("aria-label", `Resolver traslape quitando ${offering.subject}, grupo ${offering.group}`);
              removeIssue.addEventListener("click", () => removeCandidate(offering));
              issueActions.append(removeIssue);
            });
            issue.append(issueCopy, issueActions);
            conflictIssues.append(issue);
          });
          selectionSummary.append(conflictIssues);
        }
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
          remove.addEventListener("click", () => removeCandidate(offering));
          row.append(copy, teacher, times, remove);
          selectionList.append(row);
        });
        selectionSummary.append(selectionList);
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
                  generationError = "";
                  await persistPlannerSelection();
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
        planStatus.focus({ preventScroll: true });
        return;
      }
      generationError = "";
      generatedSchedules = core.sortScheduleCombinations(
        core.generateScheduleCombinations(generation.offerings, 100)
          .map((schedule, generationIndex) => ({ ...schedule, generationIndex })),
        scheduleSortCriterion
      ).slice(0, 30);
      activeGeneratedSchedule = 0;
      if (!generatedSchedules.length) {
        generationError = "Agrega otra alternativa para una de las materias señaladas o quita uno de los grupos que coinciden.";
        updatePlan();
        planStatus.focus({ preventScroll: true });
        planStatus.scrollIntoView({ block: "nearest", behavior: "smooth" });
        announce("No existe una combinación completa sin empalmes");
        return;
      }
      updatePlan();
      announce(`${generatedSchedules.length} horarios sin empalmes generados`);
      proposals.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    clear.addEventListener("click", async () => {
      plannerSelection.clear();
      generatedSchedules = [];
      generationError = "";
      await persistPlannerSelection();
      renderOptions();
      updatePlan();
      announce("Selección del planificador borrada");
    });

    renderOptions();
    updatePlan();
    refreshOccupancyView = ({ state, message } = {}) => {
      updateOccupancyStatus({ state, message });
      if (state !== "ready" && state !== "disabled") return;
      generationError = "";
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
      hasCatalog ? "Tus materias escaneadas están listas" : "Abre Horarios de clase para comenzar",
      hasCatalog
        ? `${scanCatalog.offerings.length} grupos guardados. Puedes seguir navegando por SAES y volver aquí cuando quieras actualizar o comparar tus materias.`
        : "Desde Horarios podrás escanear las materias de tu carrera y armar un horario sin empalmes."
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
      "Cuando entres a SAES, vuelve a abrir el panel para consultar tus herramientas y materias."
    ));
  }

  function renderPreparedForEnrollment() {
    const heading = document.createElement("h2");
    heading.className = "ms-heading";
    heading.textContent = "Tu horario preparado";
    const lede = document.createElement("p");
    lede.className = "ms-lede";
    lede.textContent = "Consulta el horario que guardaste y captura sus grupos en SAES durante tu cita.";
    view.append(heading, lede);
    if (!preparedSchedule) {
      view.append(makeEmpty("No hay un horario guardado", "MI SAES no encontró un horario preparado anteriormente en este navegador."));
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
    else if (core.shouldRenderSchedulePlanner({ authenticated: hasAuthenticatedSession, offeringsPage: isOfferingsCatalog, context })) renderPlanner();
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
    detail.textContent = "Siempre visible debajo del saludo en la página principal de alumnos.";
    copy.append(strong, detail);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.role = "switch";
    input.checked = true;
    input.disabled = true;
    control.append(copy, input);
    section.append(title, control);
    view.append(section);
  }

  function markStudentHomeClutter(anchor) {
    anchor.dataset.misaesHomeSource = "true";
    [...anchor.parentElement.querySelectorAll("img")].forEach((image) => {
      let path = "";
      try {
        path = new URL(image.currentSrc || image.src, location.href).pathname;
      } catch {
        return;
      }
      if (!/(aviso_seg_2014|sliderDenuncia)/i.test(path)) return;
      // Los avisos ilustrados ocupan casi toda la portada y duplican accesos ya disponibles.
      // Marcamos sólo su contenedor para poder restaurarlo al desactivar la extensión.
      (image.closest("center") || image).dataset.misaesHomeClutter = "true";
    });
  }

  async function loadOfficialStudentPhoto() {
    studentPhotoController?.abort();
    const targetUrl = core.studentPhotoPageUrl(location.origin);
    if (!targetUrl) return;
    studentPhotoController = new AbortController();
    const target = new URL(targetUrl);
    try {
      // La foto se descubre en Datos Personales y se muestra desde su URL oficial.
      // No se guarda una copia ni se envía fuera del dominio del plantel.
      const response = await fetch(target, {
        credentials: "same-origin",
        cache: "no-store",
        signal: studentPhotoController.signal
      });
      if (!response.ok) return;
      if (!core.isSameOriginUrl(response.url, location.origin)) return;
      const documentCopy = new DOMParser().parseFromString(await response.text(), "text/html");
      const photoUrl = studentHome.officialPhotoFromDocument(documentCopy, target.href, core);
      if (photoUrl && studentHomeHost?.isConnected) studentHomeView?.setPhoto(photoUrl);
    } catch (error) {
      if (error?.name !== "AbortError") return;
    } finally {
      studentPhotoController = null;
    }
  }

  function unmountStudentHome() {
    studentPhotoController?.abort();
    studentPhotoController = null;
    studentHomeHost?.remove();
    studentHomeHost = null;
    studentHomeView = null;
    document.querySelectorAll("[data-misaes-home-source]").forEach((element) => delete element.dataset.misaesHomeSource);
    document.querySelectorAll("[data-misaes-home-clutter]").forEach((element) => delete element.dataset.misaesHomeClutter);
  }

  function syncStudentHome() {
    const shouldShow = core.shouldEnhanceStudentHome({
      url: location.href,
      enabled: settings.enabled,
      authenticated: hasAuthenticatedSession
    });
    if (!shouldShow) {
      unmountStudentHome();
      return;
    }
    if (studentHomeHost?.isConnected) return;

    const anchor = document.getElementById("ctl00_mainCopy_FormView1");
    if (!anchor?.parentElement) return;
    const identity = core.studentGreetingModel([...anchor.querySelectorAll("tr")].map((row) => row.textContent));
    studentHomeView = studentHome.create({
      document,
      stylesheetUrl: chrome.runtime.getURL("src/content/student-home.css"),
      identity
    });
    studentHomeHost = studentHomeView.host;
    markStudentHomeClutter(anchor);
    anchor.insertAdjacentElement("afterend", studentHomeHost);
    void loadOfficialStudentPhoto();
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

    const anchor = studentHomeHost?.isConnected
      ? studentHomeHost
      : document.getElementById("ctl00_mainCopy_FormView1");
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
  shadow.querySelector('[data-action="show-saes"]').addEventListener("click", () => setOpen(false));
  shadow.querySelector('[data-action="dismiss-release"]').addEventListener("click", async () => {
    releaseNotice = null;
    renderReleaseBanner();
    await storage.remove([releaseNoticeKey]);
    announce("Novedades cerradas");
  });

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
  if (occupancyEnabled && scanCatalog?.offerings?.length
    && core.shouldRenderSchedulePlanner({ authenticated: hasAuthenticatedSession, offeringsPage: isOfferingsCatalog, context })) {
    scheduleOccupancyRefresh(1000);
  }
  window.addEventListener("pagehide", () => {
    clearTimeout(occupancyTimer);
    occupancyController?.abort();
    trajectoryController?.abort();
    unmountStudentHome();
    unmountTrajectoryHome();
  }, { once: true });
})();
