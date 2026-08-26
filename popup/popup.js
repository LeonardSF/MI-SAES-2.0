(async function initPopup() {
  "use strict";

  if (!globalThis.chrome?.storage?.local) return;

  const core = globalThis.MISaesCore;
  const statusCard = document.querySelector(".status-card");
  const statusTitle = document.getElementById("status-title");
  const statusDetail = document.getElementById("status-detail");
  const openPanel = document.getElementById("open-panel");
  const enabled = document.getElementById("enabled");
  const live = document.getElementById("live");

  const stored = await chrome.storage.local.get(["settings"]);
  let settings = core.mergeSettings(stored.settings || {});

  function applyForm() {
    enabled.checked = settings.enabled;
    document.documentElement.dataset.theme = "light";
  }

  async function save(patch) {
    settings = core.mergeSettings({ ...settings, ...patch });
    await chrome.storage.local.set({ settings });
    applyForm();
    live.textContent = "Preferencia guardada";
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function readStatus() {
    const tab = await activeTab();
    if (!tab?.id) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "MI_SAES_GET_STATUS" });
    } catch {
      return null;
    }
  }

  enabled.addEventListener("change", () => save({ enabled: enabled.checked }));

  openPanel.addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: "MI_SAES_OPEN_PANEL" });
    window.close();
  });

  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  applyForm();
  const status = await readStatus();
  if (status?.available) {
    statusCard.dataset.state = "ready";
    statusTitle.textContent = status.enabled ? `Listo en ${status.contextName}` : "MI SAES está pausado";
    statusDetail.textContent = `${status.hostname} · ${status.tables} tabla${status.tables === 1 ? "" : "s"} detectada${status.tables === 1 ? "" : "s"}`;
    openPanel.disabled = !status.enabled;
  } else {
    statusCard.dataset.state = "offline";
    statusTitle.textContent = "Abre una página de SAES";
    statusDetail.textContent = "La extensión sólo se activa dentro de dominios del IPN que contienen SAES.";
    openPanel.disabled = true;
  }
})();
