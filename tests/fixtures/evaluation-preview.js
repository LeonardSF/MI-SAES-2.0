const evaluationForm = document.querySelector("#evaluation-form");
let submitCount = 0;
evaluationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCount += 1;
});

const evaluationObserver = new MutationObserver(() => {
  const shadow = document.querySelector("#misaes-root")?.shadowRoot;
  const widget = shadow?.querySelector(".ms-evaluation");
  if (!widget) return;
  evaluationObserver.disconnect();

  const launcher = widget.querySelector("button");
  const choices = [...widget.querySelectorAll('[role="group"] button')];
  const confirmation = widget.querySelector("[data-evaluation-confirmation]");
  const cancel = widget.querySelector("[data-evaluation-cancel]");
  const apply = widget.querySelector("[data-evaluation-apply]");
  const expected = new Map([
    ["Malo", ["60", "40"]],
    ["Bueno", ["20", "60"]],
    ["Excelente", ["20", "60"]]
  ]);
  const passed = choices.length === expected.size && choices.every((choice) => {
    launcher.click();
    if (launcher.getAttribute("aria-expanded") !== "true") return false;
    const previousAnswers = JSON.stringify([...new FormData(evaluationForm)]);
    choice.click();
    if (confirmation.hidden || !confirmation.textContent.includes(choice.textContent)) return false;
    cancel.click();
    if (!confirmation.hidden || JSON.stringify([...new FormData(evaluationForm)]) !== previousAnswers) return false;
    choice.click();
    if (JSON.stringify([...new FormData(evaluationForm)]) !== previousAnswers) return false;
    apply.click();
    const data = new FormData(evaluationForm);
    const profile = choice.textContent;
    const [knowledge, analysis] = expected.get(profile);
    return data.get("respuesta08") === knowledge
      && data.get("respuesta09") === "40"
      && data.get("respuesta10") === analysis
      && data.has("ninguna") === (profile === "Malo")
      && data.has("video") === (profile !== "Malo")
      && data.has("plataformas") === (profile === "Excelente")
      && data.has("equipo") && !data.has("ejercicios") && !data.has("ningunaActividades")
      && launcher.getAttribute("aria-expanded") === "false";
  });
  const result = document.createElement("output");
  result.id = "evaluation-result";
  result.textContent = passed && submitCount === 0 && launcher.textContent.includes("MI SAES 2.0")
    && evaluationForm.querySelector("textarea").value === "Comentario de prueba"
    ? "ready" : "failed";
  document.body.append(result);
});
evaluationObserver.observe(document.documentElement, { childList: true, subtree: true });
