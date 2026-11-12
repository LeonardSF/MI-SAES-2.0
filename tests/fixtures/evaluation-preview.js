const evaluationForm = document.querySelector("#evaluation-form");
let submitCount = 0;
evaluationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCount += 1;
});

const evaluationObserver = new MutationObserver(async () => {
  const shadow = document.querySelector("#misaes-root")?.shadowRoot;
  const widget = shadow?.querySelector(".ms-evaluation");
  if (!widget) return;
  evaluationObserver.disconnect();

  const launcher = widget.querySelector("button");
  const choices = [...widget.querySelectorAll('[role="group"] button')];
  const confirmation = widget.querySelector("[data-evaluation-confirmation]");
  const cancel = widget.querySelector("[data-evaluation-cancel]");
  const apply = widget.querySelector("[data-evaluation-apply]");
  const fillSelects = widget.querySelector("[data-evaluation-selects]");
  const fillBoxes = widget.querySelector("[data-evaluation-checklists]");
  const review = widget.querySelector('[role="status"]');
  const expected = new Map([
    ["Malo", ["60", "40"]],
    ["Bueno", ["60", "40"]],
    ["Excelente", ["20", "60"]]
  ]);
  async function checkProfile(choice) {
    const profile = choice.textContent;
    launcher.click();
    if (launcher.getAttribute("aria-expanded") !== "true") return false;
    const previousAnswers = JSON.stringify([...new FormData(evaluationForm)]);
    choice.click();
    if (!confirmation.open || !apply.disabled || !apply.textContent.includes("5 s")
      || !confirmation.textContent.includes(choice.textContent)) return false;
    apply.click();
    if (JSON.stringify([...new FormData(evaluationForm)]) !== previousAnswers) return false;
    cancel.click();
    if (confirmation.open || JSON.stringify([...new FormData(evaluationForm)]) !== previousAnswers) return false;
    choice.click();
    if (JSON.stringify([...new FormData(evaluationForm)]) !== previousAnswers) return false;
    await new Promise((resolve) => setTimeout(resolve, 4900));
    if (!apply.disabled) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (apply.disabled) return false;
    if (profile === "Bueno") {
      fillSelects.click();
      fillBoxes.click();
      if (!apply.disabled) return false;
      fillBoxes.click();
    }
    if (profile === "Excelente") {
      fillSelects.click();
      fillBoxes.click();
    }
    if (apply.disabled) return false;
    apply.click();
    const data = new FormData(evaluationForm);
    const [knowledge, analysis] = expected.get(profile);
    return data.get("respuesta08") === knowledge
      && data.get("respuesta09") === "40"
      && data.get("respuesta10") === analysis
      && data.has("ninguna") === (profile === "Malo")
      && ["video", "plataformas"].filter((name) => data.has(name)).length
        === { Malo: 0, Bueno: 2, Excelente: 2 }[profile]
      && !review.hidden && review.textContent.includes(profile) && review.textContent.includes("a conciencia")
      && data.has("equipo") && !data.has("ejercicios") && !data.has("ningunaActividades")
      && launcher.getAttribute("aria-expanded") === "false";
  }
  let passed = choices.length === expected.size;
  for (const choice of choices) {
    if (!passed) break;
    passed = await checkProfile(choice);
  }
  const result = document.createElement("output");
  result.id = "evaluation-result";
  result.textContent = passed && submitCount === 0 && launcher.textContent.includes("MI SAES 2.0")
    && evaluationForm.querySelector("textarea").value === "Comentario de prueba"
    ? "ready" : "failed";
  document.body.append(result);
});
evaluationObserver.observe(document.documentElement, { childList: true, subtree: true });
