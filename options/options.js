(async function initOptions() {
  "use strict";

  if (!globalThis.chrome?.storage?.local) return;

  const core = globalThis.MISaesCore;
  const stored = await chrome.storage.local.get(["settings"]);
  let settings = core.mergeSettings(stored.settings || {});
  const status = document.getElementById("save-status");
  const moduleInputs = [...document.querySelectorAll("[data-module]")];
  let statusTimer = 0;

  function render() {
    document.documentElement.dataset.theme = "light";
    moduleInputs.forEach((input) => {
      input.checked = settings.modules[input.dataset.module] !== false;
    });
  }

  async function save() {
    clearTimeout(statusTimer);
    status.dataset.state = "loading";
    status.textContent = "Guardando…";
    try {
      await chrome.storage.local.set({ settings });
      status.dataset.state = "success";
      status.textContent = "Preferencias guardadas ✓";
      statusTimer = setTimeout(() => {
        delete status.dataset.state;
        status.textContent = "Cambios locales";
      }, 2500);
    } catch {
      status.dataset.state = "error";
      status.textContent = "No fue posible guardar";
    }
  }

  moduleInputs.forEach((input) => input.addEventListener("change", () => {
    settings.modules[input.dataset.module] = input.checked;
    save();
  }));
  render();
})();
