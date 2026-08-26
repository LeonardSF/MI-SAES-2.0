"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,
  hideStudentId: false,
  modules: {
    filters: true,
    schedule: true,
    evaluationAssist: true,
    notes: true,
    tools: true
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["settings"]);
  const settings = {
    enabled: current.settings?.enabled !== false,
    hideStudentId: current.settings?.hideStudentId === true,
    modules: {
      ...DEFAULT_SETTINGS.modules,
      ...(current.settings?.modules || {})
    }
  };
  await chrome.storage.local.set({ settings });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "MI_SAES_TOGGLE_PANEL" }).catch(() => undefined);
});
