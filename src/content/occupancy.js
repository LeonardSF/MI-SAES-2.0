(function initMiSaesOccupancy(globalScope) {
  "use strict";

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function integer(value) {
    const match = String(value ?? "").replace(/,/g, "").match(/-?\d+/);
    return match ? Number(match[0]) : null;
  }

  function findRecord(records, offering) {
    const group = normalize(offering?.group);
    const subject = normalize(offering?.subject);
    if (!group || !subject || !Array.isArray(records)) return null;
    return records.find((record) => normalize(record.group) === group && normalize(record.subject) === subject) || null;
  }

  function markUrl(doc, url) {
    Object.defineProperty(doc, "__misaesUrl", { value: url, configurable: true });
    return doc;
  }

  function parseDocument(html, url) {
    return markUrl(new DOMParser().parseFromString(html, "text/html"), url);
  }

  function postbackTarget(control) {
    const script = control?.getAttribute("onchange") || control?.getAttribute("onclick") || "";
    const match = script.match(/__doPostBack\(\s*\\?['\"]([^'\"]+)/i);
    return match?.[1] || control?.name || "";
  }

  async function requestDocument(doc, control, value, { signal, onRequest } = {}) {
    const form = doc.querySelector("form");
    if (!form || !control) throw new Error("SAES no expuso los filtros de ocupabilidad.");
    const params = new URLSearchParams();
    new FormData(form).forEach((entryValue, key) => {
      if (typeof entryValue === "string") params.append(key, entryValue);
    });
    params.set("__EVENTTARGET", postbackTarget(control));
    params.set("__EVENTARGUMENT", "");
    if (control.name) params.set(control.name, value);
    onRequest?.();
    const baseUrl = doc.__misaesUrl || location.href;
    const response = await fetch(new URL(form.getAttribute("action") || baseUrl, baseUrl), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      redirect: "follow",
      signal
    });
    if (!response.ok) throw new Error(`SAES respondió con código ${response.status} al consultar ocupabilidad.`);
    const html = await response.text();
    const parsed = parseDocument(html, response.url || baseUrl);
    if (/iniciar sesion|captcha/i.test(parsed.body?.innerText || "")) {
      throw new Error("La sesión de SAES terminó. Inicia sesión para actualizar los lugares.");
    }
    return parsed;
  }

  function findControl(doc, pattern, selector = "select") {
    return [...doc.querySelectorAll(selector)].find((control) => pattern.test(normalize(`${control.id} ${control.name}`))) || null;
  }

  function matchingOption(select, wanted) {
    const target = normalize(wanted);
    if (!select || !target) return null;
    return [...select.options].find((option) => normalize(option.textContent) === target)
      || [...select.options].find((option) => normalize(option.textContent).includes(target) || target.includes(normalize(option.textContent)))
      || null;
  }

  async function selectValue(doc, pattern, wanted, options) {
    const select = findControl(doc, pattern);
    const option = matchingOption(select, wanted);
    if (!select || !option || select.value === option.value) return doc;
    return requestDocument(doc, select, option.value, options);
  }

  function parseTable(doc) {
    const tables = [...doc.querySelectorAll("table")];
    for (const table of tables) {
      const rows = [...table.rows];
      if (rows.length < 2) continue;
      const matrix = rows.map((row) => [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));
      const headers = matrix[0].map(normalize);
      const groupIndex = headers.findIndex((header) => /^grupo$/.test(header));
      const subjectIndex = headers.findIndex((header) => /nombre de la materia|asignatura/.test(header));
      const termIndex = headers.findIndex((header) => /semestre|periodo/.test(header));
      const capacityIndex = headers.findIndex((header) => /^cupo$|capacidad/.test(header));
      const enrolledIndex = headers.findIndex((header) => /inscritos|ocupados/.test(header));
      const availableIndex = headers.findIndex((header) => /disponibles|vacantes/.test(header));
      if (groupIndex < 0 || subjectIndex < 0 || (availableIndex < 0 && (capacityIndex < 0 || enrolledIndex < 0))) continue;
      return matrix.slice(1).flatMap((row) => {
        const group = String(row[groupIndex] || "").trim();
        const subject = String(row[subjectIndex] || "").trim();
        const capacity = capacityIndex >= 0 ? integer(row[capacityIndex]) : null;
        const enrolled = enrolledIndex >= 0 ? integer(row[enrolledIndex]) : null;
        const explicitAvailable = availableIndex >= 0 ? integer(row[availableIndex]) : null;
        const available = explicitAvailable ?? (capacity !== null && enrolled !== null ? Math.max(0, capacity - enrolled) : null);
        if (!group || !subject || available === null) return [];
        return [{
          group,
          subject,
          period: termIndex >= 0 ? String(row[termIndex] || "").trim() : "",
          capacity,
          enrolled,
          available: Math.max(0, available)
        }];
      });
    }
    return [];
  }

  async function scan({ url, career, plan, signal, onProgress, maxRequests = 8 } = {}) {
    if (!url) throw new Error("Falta la dirección de Ocupabilidad de SAES.");
    let requests = 0;
    const requestOptions = {
      signal,
      onRequest() {
        requests += 1;
        if (requests > maxRequests) throw new Error("La actualización de ocupabilidad superó el límite seguro de consultas.");
      }
    };
    requestOptions.onRequest();
    const response = await fetch(url, { credentials: "include", redirect: "follow", signal });
    if (!response.ok) throw new Error(`SAES respondió con código ${response.status} al abrir Ocupabilidad.`);
    let doc = parseDocument(await response.text(), response.url || url);
    if (/iniciar sesion|captcha/i.test(doc.body?.innerText || "")) {
      throw new Error("La sesión de SAES terminó. Inicia sesión para actualizar los lugares.");
    }
    const currentRadio = [...doc.querySelectorAll('input[type="radio"]')].find((radio) => {
      const label = radio.id ? doc.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent : "";
      return /actual/.test(normalize(`${radio.id} ${radio.name} ${radio.value} ${label}`)) || radio.value === "1";
    });
    if (currentRadio && !currentRadio.checked) doc = await requestDocument(doc, currentRadio, currentRadio.value, requestOptions);
    doc = await selectValue(doc, /carrera|especialidad/, career, requestOptions);
    doc = await selectValue(doc, /plan/, plan, requestOptions);
    const records = parseTable(doc);
    if (!records.length) throw new Error("SAES no devolvió grupos con columnas de cupo, inscritos y disponibles.");
    onProgress?.({ records: records.length, requests });
    return {
      career,
      plan,
      periodMode: "Periodo Escolar Actual",
      updatedAt: new Date().toISOString(),
      requests,
      records
    };
  }

  const api = Object.freeze({ findRecord, integer, parseTable, scan });
  globalScope.MISaesOccupancy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
