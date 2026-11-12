(function initMiSaesEvaluation(globalScope) {
  "use strict";

  const presets = [
    ["Malo", "nunca", 0, /muestra conocimiento|da a conocer el temario|nivel de dificultad/u, "a veces"],
    ["Bueno", "a veces", 1, /muestra conocimiento|explica los contenidos|clima de cordialidad|no realiza y no permite/u, "siempre"],
    ["Excelente", "siempre", 2, /promueve el analisis|retroalimenta y revisa junto/u, "a veces"]
  ];
  const attentionPrompt = /la forma en la que leo este cuestionario.*debo seleccionar la opcion.*nunca/u;
  const checklistSuggestions = [
    ["E2_P1", ["sistemas de video proyeccion", "plataformas digitales"]],
    ["E2_P2", ["solucion de problemas y/o ejercicios", "trabajo en equipo"]],
    ["E2_P3", ["evaluacion sumativa", "evaluacion formativa"]],
    ["E4", ["etica", "compromiso social"]],
    ["E5", ["respetuoso", "responsable"]]
  ];

  function fillChecklists(form, normalizeText, count, applied) {
    for (const [index, [suffix, suggestions]] of checklistSuggestions.entries()) {
      const table = form.querySelector(`[id$="_DG_PregsV2_${suffix}_CheckList"]`);
      const none = form.querySelector(`input[type="checkbox"][id$="_Chk_Ninguna_E2_P${index + 1}"]`);
      if (!table || !none || none.matches(":disabled")) continue;

      const options = [...table.querySelectorAll('input[type="checkbox"]')];
      const controls = [...options, none];
      const previous = applied.get(none);
      const checked = controls.filter((checkbox) => checkbox.checked);
      // Si alguien ya contestó esta pregunta, conserva sus casillas.
      if (previous ? !controls.every((box) => box.checked === previous.includes(box)) : checked.length) continue;

      const selection = count === 0 ? [none] : suggestions.slice(0, count).map((suggestion) =>
        options.find((box) => {
          const label = normalizeText(box.closest("tr")?.textContent);
          return !box.matches(":disabled") && (label === suggestion || label.startsWith(suggestion + " ("));
        })
      );
      if (selection.some((box) => !box)) continue;
      for (const box of controls) box.checked = selection.includes(box);
      applied.set(none, selection);
    }
  }

  function findQuestions(doc, normalizeText) {
    const questions = [...doc.querySelectorAll('select[id$="_Calificacion"]')].map((select) => {
      const prompt = normalizeText(select.closest("tr")?.cells[0]?.textContent);
      const options = new Map([...select.options]
        .filter((option) => !option.matches(":disabled"))
        .map((option) => [normalizeText(option.textContent), option]));
      return { select, options, prompt, attention: attentionPrompt.test(prompt) };
    });

    // La pregunta de lectura puede cambiar de número entre cuestionarios.
    const attention = questions.filter((question) => question.attention);
    if (questions.length < 2 || attention.length !== 1) return [];
    const form = attention[0].select.form;
    if (!form || !questions.every(({ select, options }) =>
      select.form === form && !select.matches(":disabled") &&
      presets.every(([, answer]) => options.has(answer))
    )) return [];
    return questions;
  }

  function mount(container, { isLocalPreview, normalizeText, announce }) {
    const doc = container.ownerDocument;
    const path = doc.location.pathname;
    const isQuestionnaire = /\/alumnos\/evaluacion_docente\/evaluacion_profesor\.aspx$/i.test(path)
      || (isLocalPreview && /\/saes-evaluation\.html$/i.test(path));
    if (!isQuestionnaire || !findQuestions(doc, normalizeText).length) return;

    const widget = doc.createElement("div");
    widget.className = "ms-evaluation";
    widget.innerHTML = `
      <button class="ms-evaluation__launcher" type="button" aria-expanded="false"
        aria-controls="ms-evaluation-options" aria-label="Evaluar rápido · MI SAES 2.0">
        <img src="${chrome.runtime.getURL("assets/icon-misaes-calendar-candidate.png")}" alt="" width="36" height="36">
        <span class="ms-evaluation__label">
          <strong>Evaluar rápido</strong>
          <span>MI SAES 2.0</span>
        </span>
        <span class="ms-evaluation__chevron" aria-hidden="true"></span>
      </button>
      <div id="ms-evaluation-options" class="ms-evaluation__options" hidden>
        <div data-evaluation-picker>
          <div class="ms-evaluation__choices" role="group" aria-label="Evaluación rápida"></div>
          <p>Elige una valoración general y revisa las respuestas sugeridas antes de enviar.</p>
        </div>
        <div data-evaluation-confirmation hidden>
          <strong id="ms-evaluation-confirm-title" tabindex="-1"></strong>
          <p>La evaluación es tu responsabilidad. Respóndela a conciencia y revisa que las respuestas reflejen tu experiencia antes de enviarla.</p>
          <div class="ms-evaluation__actions">
            <button class="ms-button" type="button" data-evaluation-cancel>Cancelar</button>
            <button class="ms-button ms-button--primary" type="button" data-evaluation-apply>Aplicar perfil</button>
          </div>
        </div>
      </div>
    `;
    const launcher = widget.querySelector("button");
    const panel = widget.querySelector("#ms-evaluation-options");
    const choices = widget.querySelector(".ms-evaluation__choices");
    const picker = widget.querySelector("[data-evaluation-picker]");
    const confirmation = widget.querySelector("[data-evaluation-confirmation]");
    const confirmationTitle = widget.querySelector("#ms-evaluation-confirm-title");
    const cancel = widget.querySelector("[data-evaluation-cancel]");
    const apply = widget.querySelector("[data-evaluation-apply]");
    const appliedChecklists = new WeakMap();
    let pendingApply = null;
    let selectedButton = null;

    function resetConfirmation() {
      pendingApply = null;
      selectedButton = null;
      confirmation.hidden = true;
      picker.hidden = false;
    }

    function setOpen(open) {
      panel.hidden = !open;
      launcher.setAttribute("aria-expanded", String(open));
      if (!open) {
        resetConfirmation();
        launcher.focus();
      }
    }

    function cancelConfirmation() {
      const previousChoice = selectedButton;
      resetConfirmation();
      previousChoice?.focus();
    }

    cancel.addEventListener("click", cancelConfirmation);
    apply.addEventListener("click", () => pendingApply?.());
    launcher.addEventListener("click", () => setOpen(panel.hidden));
    widget.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || panel.hidden) return;
      event.stopPropagation();
      if (confirmation.hidden) setOpen(false);
      else cancelConfirmation();
    });

    for (const [label, answer, checklistCount, alternatePrompt, alternateAnswer] of presets) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "ms-button";
      button.textContent = label;
      function applyProfile() {
        const questions = findQuestions(doc, normalizeText);
        if (!questions.length) {
          announce("El cuestionario cambió. Revisa las respuestas en SAES.");
          setOpen(false);
          return;
        }

        // SAES lee los valores de los desplegables cuando el estudiante pulsa Aceptar.
        for (const { select, options, prompt, attention } of questions) {
          const suggestion = alternatePrompt.test(prompt) ? alternateAnswer : answer;
          select.selectedIndex = options.get(attention ? "nunca" : suggestion).index;
        }
        fillChecklists(questions[0].select.form, normalizeText, checklistCount, appliedChecklists);
        announce(`Se aplicó «${label}». Revisa tus respuestas antes de enviar.`);
        setOpen(false);
      }
      button.addEventListener("click", () => {
        selectedButton = button;
        pendingApply = applyProfile;
        confirmationTitle.textContent = `¿Aplicar el perfil «${label}»?`;
        picker.hidden = true;
        confirmation.hidden = false;
        confirmationTitle.focus();
      });
      choices.append(button);
    }
    container.append(widget);
  }

  globalScope.MISaesEvaluation = { mount };
})(globalThis);
