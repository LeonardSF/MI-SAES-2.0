(function initMiSaesScanner(globalScope) {
  "use strict";

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function markUrl(doc, url) {
    Object.defineProperty(doc, "__misaesUrl", { value: url, configurable: true });
    return doc;
  }

  function parseDocument(html, url) {
    return markUrl(new DOMParser().parseFromString(html, "text/html"), url);
  }

  function formActionUrl(doc, form, fallbackUrl = "") {
    const baseUrl = doc?.__misaesUrl || fallbackUrl || globalScope.location?.href || "";
    return new URL(form?.getAttribute("action") || baseUrl, baseUrl).href;
  }

  function usefulOptions(select) {
    if (!select) return [];
    return [...select.options].filter((option) => {
      const text = normalize(option.textContent);
      return !option.disabled && option.value !== "" && !/^(-+|seleccione|todo)$/.test(text);
    });
  }

  function optionRecords(select) {
    return usefulOptions(select).map((option) => ({
      value: option.value,
      label: option.textContent.trim()
    }));
  }

  function requestedOptions(select, requestedValue = "") {
    const options = usefulOptions(select);
    return requestedValue ? options.filter((option) => option.value === requestedValue) : options;
  }

  function discoverControls(doc) {
    const selects = [...doc.querySelectorAll("select")];
    const bySignal = (pattern, fallbackIndex) => selects.find((select) => pattern.test(normalize(`${select.id} ${select.name}`))) || selects[fallbackIndex] || null;
    const career = bySignal(/carrera|programa/, 0);
    const shift = bySignal(/turno/, 1);
    const plan = bySignal(/plan/, 2);
    const period = selects.find((select) => select !== plan && /periodo|semestre|nivel/.test(normalize(`${select.id} ${select.name}`))) || selects[3] || null;
    const group = bySignal(/grupo/, 4);
    const allRadios = [...doc.querySelectorAll('input[type="radio"]')];
    const periodRadios = allRadios.filter((radio) => /periodo|actual|proximo/.test(normalize(`${radio.id} ${radio.name} ${radio.value}`)));
    const radios = periodRadios.length ? periodRadios : allRadios;
    return { career, shift, plan, period, group, radios };
  }

  function selectedLabel(control) {
    if (!control) return "";
    if (control.tagName === "SELECT") return control.selectedOptions[0]?.textContent?.trim() || "";
    const wrappingLabel = control.closest?.("label");
    if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
    const escapedId = globalScope.CSS?.escape ? globalScope.CSS.escape(control.id) : String(control.id || "").replace(/["\\]/g, "\\$&");
    const label = control.id ? control.ownerDocument.querySelector(`label[for="${escapedId}"]`) : null;
    return label?.textContent?.trim() || control.value || "";
  }

  function configurationModel(doc, { plans } = {}) {
    const controls = discoverControls(doc);
    const modes = controls.radios.map((radio, index) => ({
      value: String(index),
      label: selectedLabel(radio)
    }));
    return {
      careers: optionRecords(controls.career),
      plans: plans || optionRecords(controls.plan),
      modes,
      selectedCareer: controls.career?.value || "",
      selectedPlan: controls.plan?.value || "",
      selectedMode: String(Math.max(0, controls.radios.findIndex((radio) => radio.checked)))
    };
  }

  function postbackTarget(control) {
    const script = control?.getAttribute("onchange") || control?.getAttribute("onclick") || "";
    const match = script.match(/__doPostBack\(\s*\\?['\"]([^'\"]+)/i);
    return match?.[1] || control?.name || "";
  }

  function formBody(doc, control, value) {
    const form = doc.querySelector("form");
    if (!form) throw new Error("SAES no expuso el formulario de horarios.");
    const params = new URLSearchParams();
    new FormData(form).forEach((entryValue, key) => {
      if (typeof entryValue === "string") params.append(key, entryValue);
    });
    params.set("__EVENTTARGET", postbackTarget(control));
    params.set("__EVENTARGUMENT", "");
    if (control?.name) params.set(control.name, value);
    return { form, params };
  }

  async function postback(doc, control, value, { signal, onRequest, requestDelay = 220 } = {}) {
    if (!control) throw new Error("Falta un selector requerido de SAES.");
    const { form, params } = formBody(doc, control, value);
    onRequest?.();
    const baseUrl = doc.__misaesUrl || globalScope.location?.href;
    const response = await fetch(formActionUrl(doc, form, baseUrl), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      redirect: "follow",
      signal
    });
    if (!response.ok) throw new Error(`SAES respondió con código ${response.status}.`);
    const html = await response.text();
    const parsed = parseDocument(html, response.url || baseUrl);
    if (!parsed.querySelector("#ctl00_mainCopy_dbgHorarios") && /iniciar sesion|captcha/i.test(parsed.body?.innerText || "")) {
      throw new Error("La sesión de SAES terminó. Inicia sesión y vuelve a escanear.");
    }
    await sleep(requestDelay);
    return parsed;
  }

  async function selectDocument(baseDoc, key, value, options) {
    const control = discoverControls(baseDoc)[key];
    if (!control || control.value === value) return baseDoc;
    return postback(baseDoc, control, value, options);
  }

  async function radioDocument(baseDoc, radioIndex, options) {
    const radios = discoverControls(baseDoc).radios;
    const radio = radios[radioIndex];
    if (!radio || radio.checked) return baseDoc;
    return postback(baseDoc, radio, radio.value, options);
  }

  function tableModel(doc) {
    const table = doc.querySelector("#ctl00_mainCopy_dbgHorarios") || [...doc.querySelectorAll("table")].find((candidate) => {
      const text = normalize(candidate.rows?.[0]?.innerText);
      return /grupo/.test(text) && /(asignatura|materia)/.test(text) && /(lun|lunes)/.test(text);
    });
    if (!table) return null;
    const matrix = [...table.rows].map((row) => [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()));
    if (matrix.length < 2) return null;
    return { headers: matrix[0], rows: matrix.slice(1) };
  }

  function addOfferings(doc, metadata, offeringMap, core) {
    const model = tableModel(doc);
    if (!model) return 0;
    const parsed = core.deriveCourseOfferings([model]);
    parsed.forEach((offering) => {
      const id = [metadata.career, metadata.shift, metadata.plan, metadata.period, offering.group, offering.subject].map(normalize).join(":");
      const existing = offeringMap.get(id);
      const enriched = { ...offering, id, source: { ...metadata } };
      if (!existing) {
        offeringMap.set(id, enriched);
        return;
      }
      const teacherSet = new Set([...(existing.teachers || []), ...(enriched.teachers || [])]);
      existing.teachers = [...teacherSet];
      existing.teacher = existing.teachers.join(" / ");
      const entrySet = new Set(existing.entries.map((entry) => `${entry.day}:${entry.start}:${entry.end}`));
      enriched.entries.forEach((entry) => {
        const key = `${entry.day}:${entry.start}:${entry.end}`;
        if (!entrySet.has(key)) existing.entries.push(entry);
      });
    });
    return parsed.length;
  }

  async function loadConfiguration({ rootDocument, url, careerValue = "", signal, maxRequests = 20 } = {}) {
    let requests = 0;
    const requestOptions = {
      signal,
      onRequest() {
        requests += 1;
        if (requests > maxRequests) throw new Error(`La configuración superó el límite seguro de ${maxRequests} consultas.`);
      }
    };
    let initial;
    if (rootDocument) {
      const sourceUrl = url || rootDocument.__misaesUrl || rootDocument.URL || globalScope.location?.href;
      initial = parseDocument(rootDocument.documentElement.outerHTML, sourceUrl);
    } else {
      if (!url) throw new Error("Falta la dirección de Horarios de SAES.");
      requestOptions.onRequest();
      const response = await fetch(url, { credentials: "include", redirect: "follow", signal });
      if (!response.ok) throw new Error(`SAES respondió con código ${response.status} al abrir Horarios.`);
      initial = parseDocument(await response.text(), response.url || url);
    }
    const initialControls = discoverControls(initial);
    if (!initialControls.career || !initialControls.shift || !initialControls.plan) {
      throw new Error("No pude identificar Carrera, Turno y Plan de estudio en esta versión de SAES.");
    }
    if (careerValue && !requestedOptions(initialControls.career, careerValue).length) {
      throw new Error("La carrera seleccionada ya no está disponible en SAES.");
    }
    const careerDoc = careerValue ? await selectDocument(initial, "career", careerValue, requestOptions) : initial;
    const controls = discoverControls(careerDoc);
    const plans = new Map(optionRecords(controls.plan).map((option) => [option.value, option]));
    const shifts = usefulOptions(controls.shift);
    for (const shift of shifts) {
      if (signal?.aborted) throw new DOMException("Configuración cancelada", "AbortError");
      const shiftDoc = await selectDocument(careerDoc, "shift", shift.value, requestOptions);
      optionRecords(discoverControls(shiftDoc).plan).forEach((option) => plans.set(option.value, option));
    }
    const model = configurationModel(careerDoc, { plans: [...plans.values()] });
    model.selectedCareer = careerValue || model.selectedCareer;
    if (!plans.has(model.selectedPlan)) model.selectedPlan = "";
    return model;
  }

  async function scan({ rootDocument, url, core = globalScope.MISaesCore, signal, onProgress, includeNext = true, careerValue = "", planValue = "", modeIndex, maxRequests = 90 } = {}) {
    if (!core) throw new Error("No se cargó el lector de horarios de MI SAES.");
    let requests = 0;
    let leaves = 0;
    const requestOptions = {
      signal,
      onRequest() {
        requests += 1;
        if (requests > maxRequests) throw new Error(`El escaneo superó el límite seguro de ${maxRequests} consultas.`);
      }
    };
    let initial;
    if (rootDocument) {
      const sourceUrl = url || rootDocument.__misaesUrl || rootDocument.URL || globalScope.location?.href;
      initial = parseDocument(rootDocument.documentElement.outerHTML, sourceUrl);
    } else {
      if (!url) throw new Error("Falta la dirección de Horarios de SAES.");
      requestOptions.onRequest();
      const response = await fetch(url, { credentials: "include", redirect: "follow", signal });
      if (!response.ok) throw new Error(`SAES respondió con código ${response.status} al abrir Horarios.`);
      initial = parseDocument(await response.text(), response.url || url);
      if (/iniciar sesion|captcha/i.test(initial.body?.innerText || "")) {
        throw new Error("La sesión de SAES terminó. Inicia sesión y vuelve a escanear.");
      }
    }
    const initialControls = discoverControls(initial);
    if (!initialControls.career || !initialControls.shift || !initialControls.period) {
      throw new Error("No pude identificar Carrera, Turno y Periodo en esta versión de SAES.");
    }
    if (careerValue && !requestedOptions(initialControls.career, careerValue).length) {
      throw new Error("La carrera seleccionada ya no está disponible en SAES.");
    }
    const careerDoc = careerValue ? await selectDocument(initial, "career", careerValue, requestOptions) : initial;
    const careerControls = discoverControls(careerDoc);
    const career = selectedLabel(careerControls.career);
    const requestedModeIndex = Number(modeIndex);
    const hasRequestedMode = modeIndex !== undefined && Number.isInteger(requestedModeIndex) && requestedModeIndex >= 0;
    const modeIndexes = hasRequestedMode
      ? [requestedModeIndex]
      : includeNext && careerControls.radios.length > 1
      ? [0, 1]
      : [careerControls.radios.findIndex((radio) => radio.checked)].filter((index) => index >= 0);
    if (!modeIndexes.length) modeIndexes.push(0);
    const offeringMap = new Map();
    let selectedPlan = "";
    let selectedMode = "";

    for (const modeIndex of modeIndexes) {
      if (signal?.aborted) throw new DOMException("Escaneo cancelado", "AbortError");
      const modeDoc = await radioDocument(careerDoc, modeIndex, requestOptions);
      const modeControls = discoverControls(modeDoc);
      const modeLabel = selectedLabel(modeControls.radios.find((radio) => radio.checked)) || (modeIndex === 0 ? "Periodo actual" : "Próximo periodo");
      selectedMode ||= modeLabel;
      const shifts = usefulOptions(modeControls.shift);
      const shiftOptions = shifts.length ? shifts : [{ value: modeControls.shift?.value || "", textContent: selectedLabel(modeControls.shift) }];
      for (const shiftOption of shiftOptions) {
        const shiftDoc = shiftOption.value ? await selectDocument(modeDoc, "shift", shiftOption.value, requestOptions) : modeDoc;
        const shiftControls = discoverControls(shiftDoc);
        const plans = requestedOptions(shiftControls.plan, planValue);
        const planOptions = plans.length ? plans : planValue ? [] : [{ value: shiftControls.plan?.value || "", textContent: selectedLabel(shiftControls.plan) }];
        for (const planOption of planOptions) {
          const planDoc = planOption.value ? await selectDocument(shiftDoc, "plan", planOption.value, requestOptions) : shiftDoc;
          const planControls = discoverControls(planDoc);
          selectedPlan ||= selectedLabel(planControls.plan) || planOption.textContent.trim();
          const periods = usefulOptions(planControls.period);
          const periodOptions = periods.length ? periods : [{ value: planControls.period?.value || "", textContent: selectedLabel(planControls.period) }];
          for (const periodOption of periodOptions) {
            const periodDoc = periodOption.value ? await selectDocument(planDoc, "period", periodOption.value, requestOptions) : planDoc;
            const finalControls = discoverControls(periodDoc);
            const metadata = {
              career,
              shift: selectedLabel(finalControls.shift) || shiftOption.textContent.trim(),
              plan: selectedLabel(finalControls.plan) || planOption.textContent.trim(),
              period: selectedLabel(finalControls.period) || periodOption.textContent.trim(),
              mode: modeLabel
            };
            addOfferings(periodDoc, metadata, offeringMap, core);
            leaves += 1;
            onProgress?.({ requests, leaves, offerings: offeringMap.size, metadata });
          }
        }
      }
    }

    if (planValue && !selectedPlan) {
      throw new Error("El plan de estudio seleccionado no está disponible para los turnos de esta carrera.");
    }

    return {
      career,
      plan: selectedPlan,
      mode: selectedMode,
      scannedAt: new Date().toISOString(),
      requests,
      combinationsScanned: leaves,
      offerings: [...offeringMap.values()]
    };
  }

  const api = Object.freeze({ discoverControls, usefulOptions, requestedOptions, configurationModel, loadConfiguration, tableModel, formActionUrl, scan });
  globalScope.MISaesScanner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
