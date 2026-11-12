(function initMiSaesEvaluation(globalScope) {
  "use strict";

  const presets = [
    ["Malo", "nunca", [0, 0], /muestra conocimiento|da a conocer el temario|nivel de dificultad/u, "a veces"],
    ["Bueno", "a veces", [2, 3], /muestra conocimiento|explica los contenidos|clima de cordialidad|no realiza y no permite/u, "siempre"],
    ["Excelente", "siempre", [3, 4], /promueve el analisis|retroalimenta y revisa junto/u, "a veces"]
  ];
  const attentionPrompt = /la forma en la que leo este cuestionario.*debo seleccionar la opcion.*nunca/u;

  const checklistSuffixes = ["E2_P1", "E2_P2", "E2_P3", "E4", "E5"];
  const confirmationDelay = 5000;

  function fillChecklists(form, [minimum, maximum], applied) {
    for (const [index, suffix] of checklistSuffixes.entries()) {
      const table = form.querySelector(`[id$="_DG_PregsV2_${suffix}_CheckList"]`);
      const none = form.querySelector(`input[type="checkbox"][id$="_Chk_Ninguna_E2_P${index + 1}"]`);
      if (!table || !none || none.matches(":disabled")) continue;

      const options = [...table.querySelectorAll('input[type="checkbox"]')];
      const controls = [...options, none];
      const previous = applied.get(none);
      const checked = controls.filter((checkbox) => checkbox.checked);
      // Si alguien ya contestó esta pregunta, conserva sus casillas.
      if (previous ? !controls.every((box) => box.checked === previous.includes(box)) : checked.length) continue;

      const available = options.filter((box) => !box.matches(":disabled"));
      const lower = Math.min(minimum, available.length);
      const upper = Math.min(maximum, available.length);
      const count = lower + Math.floor(Math.random() * (upper - lower + 1));
      const selection = maximum === 0 ? [none] : [];
      // Extrae opciones sin reemplazo para que una casilla no se elija dos veces.
      while (selection.length < count && available.length) {
        const index = Math.floor(Math.random() * available.length);
        selection.push(available.splice(index, 1)[0]);
      }
      if (!selection.length) continue;
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
        <div class="ms-evaluation__choices" role="group" aria-label="Evaluación rápida"></div>
        <p>Elige una valoración general y revisa las respuestas sugeridas antes de enviar.</p>
      </div>
      <p class="ms-evaluation__review" role="status" hidden></p>
      <div class="ms-evaluation__confetti" aria-hidden="true"></div>
      <dialog class="ms-evaluation__dialog" data-evaluation-confirmation
        aria-labelledby="ms-evaluation-confirm-title" aria-describedby="ms-evaluation-confirm-copy">
        <div class="ms-evaluation__confirmation">
          <h2 id="ms-evaluation-confirm-title" tabindex="-1" autofocus></h2>
          <p id="ms-evaluation-confirm-copy">La evaluación es tu responsabilidad. Respóndela a conciencia y revisa que las respuestas reflejen tu experiencia antes de enviarla.</p>
          <fieldset class="ms-evaluation__scope">
            <legend>Qué quieres rellenar</legend>
            <label><input type="checkbox" data-evaluation-selects checked> Preguntas con desplegables</label>
            <label><input type="checkbox" data-evaluation-checklists checked> Preguntas con casillas</label>
          </fieldset>
          <div class="ms-evaluation__actions">
            <button class="ms-button" type="button" data-evaluation-cancel>Cancelar</button>
            <button class="ms-button ms-button--primary" type="button" data-evaluation-apply disabled>Aplicar perfil</button>
          </div>
        </div>
      </dialog>
    `;
    const launcher = widget.querySelector("button");
    const panel = widget.querySelector("#ms-evaluation-options");
    const choices = widget.querySelector(".ms-evaluation__choices");
    const confirmation = widget.querySelector("[data-evaluation-confirmation]");
    const confirmationTitle = widget.querySelector("#ms-evaluation-confirm-title");
    const cancel = widget.querySelector("[data-evaluation-cancel]");
    const apply = widget.querySelector("[data-evaluation-apply]");
    const fillSelects = widget.querySelector("[data-evaluation-selects]");
    const fillBoxes = widget.querySelector("[data-evaluation-checklists]");
    const review = widget.querySelector(".ms-evaluation__review");
    const confetti = widget.querySelector(".ms-evaluation__confetti");
    const appliedChecklists = new WeakMap();
    let pendingApply = null;
    let selectedButton = null;
    let confirmationTimer;
    let readyAt = 0;

    function celebrate() {
      if (globalScope.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const colors = ["--color-accent", "--color-success", "--color-info", "--color-warning"];
      const particles = Array.from({ length: 20 }, (_, index) => {
        const particle = doc.createElement("span");
        particle.style.backgroundColor = `var(${colors[index % colors.length]})`;
        return particle;
      });
      confetti.replaceChildren(...particles);

      for (const particle of particles) {
        const x = (Math.random() - 0.85) * 270;
        const lift = 32 + Math.random() * 68;
        const turn = (Math.random() - 0.5) * 480;
        const animation = particle.animate([
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${x * 0.65}px, -${lift}px) rotate(${turn / 2}deg)`, offset: 0.42 },
          { transform: `translate(${x}px, 100px) rotate(${turn}deg)`, opacity: 0 }
        ], { duration: 720 + Math.random() * 240, easing: "ease-out" });
        animation.onfinish = () => particle.remove();
      }
    }

    function updateCountdown() {
      clearTimeout(confirmationTimer);
      const seconds = Math.ceil((readyAt - performance.now()) / 1000);
      apply.disabled = seconds > 0 || (!fillSelects.checked && !fillBoxes.checked);
      apply.textContent = seconds > 0 ? `Aplicar perfil (${seconds} s)` : "Aplicar perfil";
      if (seconds > 0) confirmationTimer = setTimeout(updateCountdown, Math.min(1000, readyAt - performance.now()));
    }

    function resetConfirmation() {
      pendingApply = null;
      selectedButton = null;
      clearTimeout(confirmationTimer);
      confirmation.close();
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
    fillSelects.addEventListener("change", updateCountdown);
    fillBoxes.addEventListener("change", updateCountdown);
    confirmation.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancelConfirmation();
    });
    apply.addEventListener("click", () => {
      if (confirmation.open && !apply.disabled && performance.now() >= readyAt) pendingApply?.();
    });
    launcher.addEventListener("click", () => setOpen(panel.hidden));
    widget.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || panel.hidden || confirmation.open) return;
      event.stopPropagation();
      setOpen(false);
    });

    for (const [label, answer, checklistRange, alternatePrompt, alternateAnswer] of presets) {
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
        if (fillSelects.checked) {
          for (const { select, options, prompt, attention } of questions) {
            const suggestion = alternatePrompt.test(prompt) ? alternateAnswer : answer;
            select.selectedIndex = options.get(attention ? "nunca" : suggestion).index;
          }
        }
        if (fillBoxes.checked) {
          fillChecklists(questions[0].select.form, checklistRange, appliedChecklists);
        }
        setOpen(false);
        review.hidden = false;
        review.textContent = `Aplicaste «${label}». Revisa a conciencia que las respuestas reflejen tu experiencia antes de enviar.`;
        celebrate();
      }
      button.addEventListener("click", () => {
        selectedButton = button;
        pendingApply = applyProfile;
        confirmationTitle.textContent = `¿Aplicar el perfil «${label}»?`;
        readyAt = performance.now() + confirmationDelay;
        updateCountdown();
        confirmation.showModal();
        confirmationTitle.focus();
      });
      choices.append(button);
    }
    container.append(widget);
  }

  globalScope.MISaesEvaluation = { mount };
})(globalThis);
