/* Impeccable direction contract
 * THESIS: convertir el mapa en un visor académico, no en una tabla panorámica.
 * OWN-WORLD: mesa de trabajo clara de MI SAES, guinda para selección y estados académicos explícitos.
 * STORY: avance general → estado → periodo → materias del periodo activo.
 * FIRST VIEWPORT: avance, filtros cuantificados, periodos 1–8 y un único semestre protagonista.
 * FORM: Focused Workbench, code-led, surface seed a9b879bd.
 */
(function initMiSaesCurriculumView(globalScope) {
  "use strict";

  const STATE_META = Object.freeze({
    approved: { label: "Aprobada" },
    current: { label: "Cursando" },
    failed: { label: "No aprobada" },
    pending: { label: "Pendiente" }
  });

  function requirementsForPeriod(period = {}) {
    if (Array.isArray(period.requirements)) return period.requirements;
    const requirements = [];
    const electives = new Map();
    (period.subjects || []).forEach((subject) => {
      if (!subject.electiveSlot) {
        requirements.push({ type: "subject", key: subject.key || subject.name, state: subject.state, subject });
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
      if (requirement.type !== "elective") return;
      requirement.state = requirement.subjects.some((subject) => subject.state === "approved") ? "approved"
        : requirement.subjects.some((subject) => subject.state === "current") ? "current"
          : requirement.subjects.some((subject) => subject.state === "failed") ? "failed" : "pending";
    });
    return requirements;
  }

  function stateCounts(periods = []) {
    const counts = { all: 0, approved: 0, current: 0, failed: 0, pending: 0 };
    periods.forEach((period) => requirementsForPeriod(period).forEach((requirement) => {
      counts.all += 1;
      if (counts[requirement.state] !== undefined) counts[requirement.state] += 1;
    }));
    return counts;
  }

  function buildViewModel(snapshot = {}) {
    const stale = (snapshot.periods || []).filter((period) => period.state === "stale").map((period) => period.period);
    const failed = (snapshot.periods || []).filter((period) => period.state === "error").map((period) => period.period);
    const unavailable = [...stale, ...failed];
    const periodLabel = unavailable.length === 1 ? `El periodo ${unavailable[0]}` : `Los periodos ${unavailable.join(", ")}`;
    const notice = unavailable.length
      ? `${periodLabel} ${unavailable.length === 1 ? "conserva" : "conservan"} su última lectura porque no se ${unavailable.length === 1 ? "pudo" : "pudieron"} actualizar.`
      : "";
    const summary = snapshot.summary || {};
    const counts = stateCounts(snapshot.periods);
    const official = summary.officialCreditProgress;
    const progressPercent = official?.progressPercent ?? summary.progressPercent ?? 0;
    return {
      notice,
      counts,
      legend: Object.entries(STATE_META).map(([state, meta]) => ({ state, label: state === "failed" ? "Último resultado no aprobado" : meta.label })),
      progressPercent,
      progressLabel: official ? "por créditos" : "de avance",
      progressDetail: official
        ? `${official.earnedCredits} de ${official.totalCredits} créditos obtenidos · faltan ${official.remainingCredits}`
        : summary.totalCredits
          ? `${summary.approvedCredits} de ${summary.totalCredits} créditos aprobados`
          : `${summary.approved || 0} de ${summary.subjects || 0} ${summary.electiveSlots ? "materias requeridas cubiertas" : "materias aprobadas"}`,
      subjectDetail: official
        ? `${summary.approved || 0} de ${summary.subjects || 0} materias aprobadas${counts.current ? ` · ${counts.current} cursando` : ""}`
        : ""
    };
  }

  function buildPeriodPanels(periods = [], filter = "all") {
    return periods.map((period) => {
      const requirements = requirementsForPeriod(period);
      const visibleRequirements = filter === "all" ? requirements : requirements.filter((requirement) => requirement.state === filter);
      return {
        ...period,
        requirements: visibleRequirements,
        subjects: visibleRequirements.flatMap((requirement) => requirement.type === "elective" ? requirement.subjects : [requirement.subject])
      };
    });
  }

  function nextPeriodIndex(index, direction, length) {
    if (!length) return -1;
    return Math.max(0, Math.min(length - 1, index + direction));
  }

  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function arrowIcon(document, direction) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", direction < 0 ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5");
    svg.append(path);
    return svg;
  }

  function appendSubject(document, list, subject) {
    const item = element(document, "li", "ms-curriculum-subject");
    item.dataset.state = subject.state;
    const heading = element(document, "div", "ms-curriculum-subject__heading");
    const identity = element(document, "div", "ms-curriculum-subject__identity");
    identity.append(element(document, "strong", "ms-curriculum-subject__name", subject.name));
    if (subject.key) identity.append(element(document, "span", "ms-curriculum-subject__key", subject.key));
    const state = element(document, "span", "ms-curriculum-subject__state", STATE_META[subject.state]?.label || "Pendiente");
    heading.append(identity, state);
    item.append(heading);

    const factsData = [["Créditos", subject.credits], ["Teoría", subject.theoryHours], ["Práctica", subject.practiceHours]]
      .filter(([, value]) => Number.isFinite(value));
    if (factsData.length) {
      const facts = element(document, "dl", "ms-curriculum-subject__facts");
      factsData.forEach(([label, value]) => {
        const pair = element(document, "div", "ms-curriculum-subject__fact");
        pair.append(element(document, "dt", "", label), element(document, "dd", "", String(value)));
        facts.append(pair);
      });
      item.append(facts);
    }
    list.append(item);
  }

  function appendElective(document, list, requirement) {
    const item = element(document, "li", "ms-curriculum-elective");
    item.dataset.state = requirement.state;
    const alternatives = requirement.subjects.filter((subject) => !subject.isElectivePlaceholder);
    const heading = element(document, "div", "ms-curriculum-elective__heading");
    const copy = element(document, "div", "ms-curriculum-elective__copy");
    copy.append(
      element(document, "strong", "ms-curriculum-elective__title", requirement.label),
      element(document, "span", "ms-curriculum-elective__hint", alternatives.length
        ? `Elige ${requirement.selectionCount || 1} · ${alternatives.length} alternativas disponibles`
        : "1 requisito · sin alternativas publicadas en Horarios")
    );
    heading.append(copy, element(document, "span", "ms-curriculum-subject__state", STATE_META[requirement.state]?.label || "Pendiente"));
    const options = element(document, "ul", "ms-curriculum-elective__options");
    alternatives.forEach((subject) => {
      const option = element(document, "li", "ms-curriculum-elective__option");
      option.dataset.state = subject.state;
      const optionName = element(document, "span", "ms-curriculum-elective__option-name", subject.name);
      option.append(optionName);
      if (subject.state !== "pending") {
        option.append(element(document, "span", "ms-curriculum-elective__option-state", STATE_META[subject.state]?.label));
      }
      options.append(option);
    });
    item.append(heading);
    if (alternatives.length) item.append(options);
    else item.append(element(document, "p", "ms-curriculum-elective__empty", "El requisito forma parte del plan oficial aunque SAES no tenga grupos disponibles ahora."));
    list.append(item);
  }

  function render(parent, {
    snapshot,
    filter = "all",
    activePeriod = 1,
    onFilter = () => {},
    onPeriod = () => {},
    onRefresh = () => {},
    loading = false,
    configurationReady = false
  } = {}) {
    const document = parent.ownerDocument;
    const section = element(document, "section", "ms-curriculum");
    const header = element(document, "header", "ms-curriculum__header");
    const copy = element(document, "div", "ms-curriculum__intro");
    copy.append(
      element(document, "h2", "ms-title", "Mapa curricular"),
      element(document, "p", "ms-helper", "Consulta tu avance y explora las materias de cada periodo.")
    );
    const refresh = element(document, "button", "ms-button ms-button--primary", loading ? "Actualizando…" : "Actualizar mapa");
    refresh.type = "button";
    refresh.disabled = loading || !configurationReady;
    refresh.addEventListener("click", onRefresh);
    header.append(copy, refresh);
    section.append(header);

    if (!configurationReady) {
      section.append(element(document, "section", "ms-notice", "Selecciona Carrera y Plan de estudio en Horario antes de consultar el mapa curricular."));
      return section;
    }
    if (!snapshot) {
      section.append(element(document, "section", "ms-empty", "Aún no hay una lectura curricular. Pulsa “Actualizar mapa” para consultar los ocho periodos."));
      return section;
    }

    const viewModel = buildViewModel(snapshot);
    const overview = element(document, "section", "ms-curriculum-overview");
    const progress = element(document, "div", "ms-curriculum-progress");
    const progressCopy = element(document, "div", "ms-curriculum-progress__copy");
    progressCopy.append(
      element(document, "strong", "ms-curriculum-progress__value", `${viewModel.progressPercent}%`),
      element(document, "span", "ms-curriculum-progress__label", viewModel.progressLabel),
      element(document, "span", "ms-curriculum-progress__detail", viewModel.progressDetail)
    );
    if (viewModel.subjectDetail) progressCopy.append(element(document, "span", "ms-curriculum-progress__subjects", viewModel.subjectDetail));
    const track = element(document, "span", "ms-progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(viewModel.progressPercent));
    track.setAttribute("aria-label", "Avance curricular");
    track.setAttribute("aria-valuetext", `${viewModel.progressPercent}%, ${viewModel.progressDetail}${viewModel.subjectDetail ? `, ${viewModel.subjectDetail}` : ""}`);
    const bar = element(document, "span", "ms-progress-track__bar");
    bar.style.setProperty("--ms-progress-scale", String(viewModel.progressPercent / 100));
    track.append(bar);
    progress.append(progressCopy, track);

    const toolbar = element(document, "div", "ms-curriculum-toolbar");
    toolbar.setAttribute("aria-label", "Filtrar materias por estado");
    [["all", "Todas"], ["approved", "Aprobadas"], ["current", "Cursando"], ["pending", "Pendientes"], ["failed", "No aprobadas"]].forEach(([value, label]) => {
      const button = element(document, "button", "ms-curriculum-filter");
      button.type = "button";
      button.dataset.filter = value;
      button.dataset.active = String(filter === value);
      button.setAttribute("aria-pressed", String(filter === value));
      button.append(
        element(document, "span", "ms-curriculum-filter__label", label),
        element(document, "span", "ms-curriculum-filter__count", String(viewModel.counts[value] || 0))
      );
      button.addEventListener("click", () => onFilter(value));
      toolbar.append(button);
    });
    overview.append(progress, toolbar);
    section.append(overview);

    if (viewModel.notice) section.append(element(document, "section", "ms-notice ms-notice--error", viewModel.notice));

    const periods = buildPeriodPanels(snapshot.periods || [], filter);
    const foundIndex = periods.findIndex((period) => period.period === activePeriod);
    const activeIndex = foundIndex < 0 ? 0 : foundIndex;
    const active = periods[activeIndex];
    const browser = element(document, "section", "ms-curriculum-browser");
    browser.setAttribute("aria-label", "Materias por periodo");
    const navigator = element(document, "div", "ms-curriculum-navigator");
    const previous = element(document, "button", "ms-curriculum-navigator__arrow");
    const next = element(document, "button", "ms-curriculum-navigator__arrow");
    previous.type = next.type = "button";
    previous.setAttribute("aria-label", "Periodo anterior");
    next.setAttribute("aria-label", "Periodo siguiente");
    previous.append(arrowIcon(document, -1));
    next.append(arrowIcon(document, 1));
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === periods.length - 1;
    previous.addEventListener("click", () => onPeriod(periods[nextPeriodIndex(activeIndex, -1, periods.length)]?.period));
    next.addEventListener("click", () => onPeriod(periods[nextPeriodIndex(activeIndex, 1, periods.length)]?.period));

    const periodPicker = element(document, "div", "ms-curriculum-navigator__periods");
    periodPicker.setAttribute("aria-label", "Elegir periodo");
    periods.forEach((period, index) => {
      const button = element(document, "button", "ms-curriculum-navigator__period", String(period.period));
      button.type = "button";
      button.dataset.period = String(period.period);
      button.dataset.active = String(index === activeIndex);
      button.setAttribute("aria-label", `Ir al periodo ${period.period}`);
      if (index === activeIndex) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => onPeriod(period.period));
      periodPicker.append(button);
    });
    navigator.append(previous, periodPicker, next);
    browser.append(navigator);
    const activePeriodButton = periodPicker.querySelector('[aria-current="true"]');
    globalScope.requestAnimationFrame?.(() => {
      if (!activePeriodButton) return;
      const targetLeft = activePeriodButton.offsetLeft - Math.max(0, (periodPicker.clientWidth - activePeriodButton.offsetWidth) / 2);
      periodPicker.scrollTo({ left: targetLeft, behavior: "auto" });
    });

    if (active) {
      const panel = element(document, "section", "ms-curriculum-period-panel");
      panel.dataset.state = active.state;
      const panelHeader = element(document, "header", "ms-curriculum-period-panel__header");
      const panelTitle = element(document, "div", "ms-curriculum-period-panel__title");
      const requirementCount = active.requirements.length;
      const electiveCount = active.requirements.filter((requirement) => requirement.type === "elective").length;
      panelTitle.append(
        element(document, "h3", "ms-curriculum-period-panel__number", `Periodo ${active.period}`),
        element(document, "p", "ms-curriculum-period-panel__summary", `${requirementCount} ${requirementCount === 1 ? "materia requerida" : "materias requeridas"}${filter === "all" && electiveCount ? ` · ${electiveCount} ${electiveCount === 1 ? "optativa" : "optativas"}` : filter === "all" ? "" : " con este filtro"}`)
      );
      panelHeader.append(panelTitle);
      if (active.state === "stale" || active.state === "error") {
        panelHeader.append(element(document, "span", "ms-curriculum-period__warning", active.state === "stale" ? "Lectura anterior" : "Sin datos actualizados"));
      }
      panel.append(panelHeader);

      const list = element(document, "ul", "ms-curriculum-subjects");
      active.requirements.forEach((requirement) => {
        if (requirement.type === "elective") appendElective(document, list, requirement);
        else appendSubject(document, list, requirement.subject);
      });
      if (!active.requirements.length) {
        const empty = element(document, "li", "ms-curriculum-period__empty");
        empty.append(
          element(document, "strong", "ms-curriculum-period__empty-title", filter === "all" ? "Sin materias registradas" : "No hay coincidencias"),
          element(document, "span", "", filter === "all" ? "SAES no reportó materias para este periodo." : "Prueba otro estado o cambia de periodo.")
        );
        list.append(empty);
      }
      panel.append(list);
      browser.append(panel);
    }
    section.append(browser);
    return section;
  }

  const api = Object.freeze({ buildPeriodPanels, buildViewModel, nextPeriodIndex, render });
  globalScope.MISaesCurriculumView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
