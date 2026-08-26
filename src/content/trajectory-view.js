(function initMiSaesTrajectoryView(globalScope) {
  "use strict";

  const SOURCE_META = Object.freeze({
    reenrollment: { label: "Reinscripción", detail: "Promedio, créditos, cargas y periodos" },
    status: { label: "Estado General", detail: "Materias que SAES mantiene en seguimiento" },
    kardex: { label: "Kárdex", detail: "Historial de calificaciones" }
  });

  function finite(value) {
    return Number.isFinite(value) ? value : null;
  }

  function metric(label, value, suffix = "") {
    return finite(value) === null ? null : { label, value: `${value}${suffix}` };
  }

  function sourceModels(sources = {}) {
    return Object.entries(SOURCE_META).map(([id, meta]) => {
      const state = sources[id] || "pending";
      const details = {
        ready: "Datos actualizados",
        error: "No se pudo consultar",
        incompatible: "SAES no mostró la tabla esperada",
        "session-expired": "La sesión terminó",
        pending: meta.detail,
        loading: "Consultando SAES…"
      };
      const statusLabels = {
        ready: "Lista",
        error: "Error",
        incompatible: "Incompatible",
        "session-expired": "Sesión terminada",
        pending: "Pendiente",
        loading: "Leyendo"
      };
      return { id, label: meta.label, state, detail: details[state] || meta.detail, statusLabel: statusLabels[state] || "Pendiente" };
    });
  }

  function partialDescription(sources = {}) {
    // El mensaje se deriva de las fuentes reales; ningún plantel garantiza que falle siempre la misma página.
    const failed = Object.entries(sources)
      .filter(([, state]) => state !== "ready")
      .map(([id]) => SOURCE_META[id]?.label)
      .filter(Boolean);
    const readyCount = Object.values(sources).filter((state) => state === "ready").length;
    const countText = readyCount === 1 ? "una fuente" : readyCount === 2 ? "dos fuentes" : `${readyCount} fuentes`;
    return `Se ${readyCount === 1 ? "actualizó" : "actualizaron"} ${countText}. ${failed.join(" y ")} no ${failed.length === 1 ? "respondió" : "respondieron"}; puedes conservar estos datos y reintentar.`;
  }

  function buildModel(snapshot) {
    if (!snapshot) {
      return {
        state: "empty",
        title: "Mi trayectoria",
        description: "Reúne tu avance académico desde tres páginas de SAES. Los datos se guardan sólo en este navegador.",
        action: "Actualizar mi trayectoria",
        progress: null,
        metrics: [],
        sources: []
      };
    }

    if (snapshot.state === "session-expired") {
      return {
        state: "session-expired",
        title: "Vuelve a iniciar sesión",
        description: "SAES mostró la pantalla de acceso en lugar de tus datos académicos.",
        action: "Reintentar actualización",
        progress: null,
        metrics: [],
        sources: sourceModels(snapshot.sources)
      };
    }

    const reenrollment = snapshot.reenrollment || {};
    const totalCredits = finite(reenrollment.earnedCredits) !== null && finite(reenrollment.remainingCredits) !== null
      ? reenrollment.earnedCredits + reenrollment.remainingCredits
      : null;
    const progress = finite(snapshot.progressPercent) === null ? null : {
      value: snapshot.progressPercent,
      detail: totalCredits === null
        ? "Avance calculado con los créditos reportados"
        : `${reenrollment.earnedCredits} de ${totalCredits} créditos obtenidos`
    };
    const metrics = [
      metric("Promedio reportado", reenrollment.average),
      metric("Materias reprobadas", reenrollment.failedSubjects),
      metric("Periodos cursados", reenrollment.periodsCompleted),
      metric("Periodos disponibles", reenrollment.periodsAvailable),
      metric("Carga autorizada", reenrollment.authorizedLoad, " créditos"),
      metric("Registros en Estado General", snapshot.status?.records)
    ].filter(Boolean);

    return {
      state: snapshot.state,
      title: "Mi trayectoria",
      description: snapshot.state === "partial"
        ? partialDescription(snapshot.sources)
        : snapshot.state === "error"
          ? "SAES no entregó datos académicos compatibles. Revisa tu sesión y vuelve a intentarlo."
        : "Una lectura clara de los datos que SAES ya reporta sobre tu avance.",
      action: "Actualizar datos",
      progress,
      metrics,
      sources: sourceModels(snapshot.sources),
      updatedAt: snapshot.updatedAt || null,
      kardex: snapshot.kardex || null,
      status: snapshot.status || null,
      loads: {
        minimum: finite(reenrollment.minimumLoad),
        medium: finite(reenrollment.mediumLoad),
        maximum: finite(reenrollment.maximumLoad)
      }
    };
  }

  function buildEmbeddedModel(snapshot) {
    const model = buildModel(snapshot);
    const reenrollment = snapshot?.reenrollment || {};
    const periodParts = [];
    if (finite(reenrollment.periodsCompleted) !== null) periodParts.push(`${reenrollment.periodsCompleted} cursados`);
    if (finite(reenrollment.periodsAvailable) !== null) periodParts.push(`${reenrollment.periodsAvailable} disponibles`);
    const primaryMetrics = model.metrics.filter((item) => ["Promedio reportado", "Materias reprobadas"].includes(item.label));
    if (periodParts.length) primaryMetrics.push({ label: "Periodos académicos", value: periodParts.join(" · ") });
    const authorizedLoad = model.metrics.find((item) => item.label === "Carga autorizada");
    if (authorizedLoad) primaryMetrics.push(authorizedLoad);

    const statusRecords = finite(snapshot?.status?.records);
    const repeatedRecords = finite(snapshot?.status?.repeatedRecords) || 0;
    const attention = statusRecords > 0 ? {
      title: "Revisa Estado General",
      detail: `${statusRecords} ${statusRecords === 1 ? "materia figura" : "materias figuran"} en seguimiento${repeatedRecords ? `; ${repeatedRecords} ${repeatedRecords === 1 ? "aparece" : "aparecen"} más de una vez` : ""}.`
    } : null;

    return {
      ...model,
      progress: model.progress && finite(reenrollment.remainingCredits) !== null
        ? { ...model.progress, detail: `${model.progress.detail} · faltan ${reenrollment.remainingCredits}` }
        : model.progress,
      metrics: primaryMetrics,
      attention,
      sources: []
    };
  }

  function embeddedDetailFacts(model = {}) {
    const facts = [];
    if (model.kardex) {
      facts.push(`${model.kardex.records} registros en Kárdex: ${model.kardex.gradesFromSix} con calificación de 6 a 10, ${model.kardex.gradesBelowSix} menores a 6 y ${model.kardex.withoutNumericGrade} sin calificación numérica.`);
    }
    const loads = [
      ["mínima", model.loads?.minimum],
      ["media", model.loads?.medium],
      ["máxima", model.loads?.maximum]
    ].filter(([, value]) => finite(value) !== null).map(([label, value]) => `${label} ${value}`);
    if (loads.length) {
      const ranges = loads.length === 1 ? loads[0] : `${loads.slice(0, -1).join(", ")} y ${loads.at(-1)}`;
      facts.push(`Rangos de carga: ${ranges} créditos.`);
    }
    return facts;
  }

  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderSources(document, parent, sources) {
    const section = element(document, "section", "ms-trajectory-sources");
    section.append(element(document, "h3", "ms-section__title", "Fuentes consultadas"));
    const list = element(document, "ul", "ms-source-list");
    sources.forEach((source) => {
      const item = element(document, "li", "ms-source-row");
      item.dataset.state = source.state;
      const copy = element(document, "span", "ms-source-row__copy");
      copy.append(
        element(document, "strong", "", source.label),
        element(document, "small", "", source.detail)
      );
      const status = element(document, "span", "ms-source-row__status", source.statusLabel);
      item.append(copy, status);
      list.append(item);
    });
    section.append(list);
    parent.append(section);
  }

  function renderProgress(document, parent, progress) {
    if (!progress) return;
    const section = element(document, "section", "ms-trajectory-progress");
    const copy = element(document, "div", "ms-trajectory-progress__copy");
    copy.append(
      element(document, "h3", "ms-section__title", "Avance por créditos"),
      element(document, "p", "ms-helper", progress.detail)
    );
    const value = element(document, "strong", "ms-trajectory-progress__value", `${progress.value}%`);
    const track = element(document, "div", "ms-progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Avance por créditos");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(progress.value));
    const bar = element(document, "span", "ms-progress-track__bar");
    bar.style.setProperty("--ms-progress-scale", String(Math.max(0, Math.min(100, progress.value)) / 100));
    track.append(bar);
    section.append(copy, value, track);
    parent.append(section);
  }

  function renderMetrics(document, parent, metrics) {
    if (!metrics.length) return;
    const list = element(document, "dl", "ms-trajectory-metrics");
    metrics.forEach((item) => {
      const row = element(document, "div", "ms-trajectory-metric");
      row.append(
        element(document, "dt", "", item.label),
        element(document, "dd", "", item.value)
      );
      list.append(row);
    });
    parent.append(list);
  }

  function renderDetails(document, parent, model) {
    if (!model.kardex && !model.status) return;
    const section = element(document, "section", "ms-trajectory-detail");
    section.append(element(document, "h3", "ms-section__title", "Lectura académica"));
    const list = element(document, "ul", "ms-fact-list");
    if (model.kardex) {
      list.append(element(document, "li", "", `${model.kardex.records} registros en Kárdex: ${model.kardex.gradesFromSix} con calificación de 6 a 10 y ${model.kardex.gradesBelowSix} menores a 6.`));
    }
    if (model.status) {
      const repeated = model.status.repeatedRecords
        ? ` ${model.status.repeatedRecords} ${model.status.repeatedRecords === 1 ? "aparece" : "aparecen"} más de una vez.`
        : "";
      list.append(element(document, "li", "", `${model.status.records} ${model.status.records === 1 ? "materia figura" : "materias figuran"} en Estado General.${repeated}`));
    }
    section.append(list);
    parent.append(section);
  }

  function renderAttention(document, parent, attention) {
    if (!attention) return;
    const notice = element(document, "aside", "ms-trajectory-attention");
    notice.append(
      element(document, "strong", "", attention.title),
      element(document, "p", "", attention.detail)
    );
    parent.append(notice);
  }

  function renderEmbeddedDetails(document, parent, model) {
    const facts = embeddedDetailFacts(model);
    if (!facts.length) return;
    const details = element(document, "details", "ms-trajectory-disclosure");
    details.append(element(document, "summary", "ms-trajectory-disclosure__summary", "Ver detalle académico"));
    const list = element(document, "ul", "ms-fact-list");
    facts.forEach((fact) => list.append(element(document, "li", "", fact)));
    details.append(list);
    parent.append(details);
  }

  function render(container, { snapshot = null, activity = null, onRefresh = () => {}, embedded = false } = {}) {
    const document = container.ownerDocument;
    const model = embedded ? buildEmbeddedModel(snapshot) : buildModel(snapshot);
    const loading = activity?.state === "loading";
    const sources = loading
      ? sourceModels({ ...(snapshot?.sources || {}), [activity.source]: "loading" })
      : model.sources;

    container.append(
      element(document, "h2", "ms-heading", model.title),
      element(document, "p", "ms-lede", loading ? activity.message : model.description)
    );

    if (["partial", "session-expired", "error"].includes(model.state)) {
      const notice = element(document, "div", `ms-notice ${model.state === "partial" ? "ms-notice--warning" : "ms-notice--error"}`);
      notice.append(element(document, "strong", "", model.state === "partial" ? "Actualización incompleta" : model.state === "session-expired" ? "Sesión terminada" : "No se obtuvieron datos"));
      container.append(notice);
    }

    renderProgress(document, container, model.progress);
    renderMetrics(document, container, model.metrics);
    if (embedded) {
      renderAttention(document, container, model.attention);
      renderEmbeddedDetails(document, container, model);
    } else {
      renderDetails(document, container, model);
    }
    if (!embedded) renderSources(document, container, sources.length ? sources : sourceModels());

    const actions = element(document, "div", "ms-row ms-trajectory-actions");
    const refresh = element(document, "button", "ms-button ms-button--primary", loading ? "Actualizando…" : model.action);
    refresh.type = "button";
    refresh.disabled = loading;
    if (loading) refresh.dataset.state = "loading";
    refresh.addEventListener("click", onRefresh);
    actions.append(refresh);
    if (model.updatedAt) {
      const updated = new Date(model.updatedAt);
      actions.append(element(document, "span", "ms-helper", `Actualizado ${updated.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`));
    }
    container.append(actions);
  }

  const api = Object.freeze({ buildEmbeddedModel, buildModel, embeddedDetailFacts, render });
  globalScope.MISaesTrajectoryView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
