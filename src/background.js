"use strict";

importScripts("shared/core.js");

const DEFAULT_SETTINGS = {
  enabled: true,
  hideStudentId: false,
  modules: {
    filters: true,
    schedule: true,
    trajectoryHome: true,
    notes: true,
    tools: true
  }
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(["settings"]);
  const savedModules = current.settings?.modules || {};
  const settings = {
    enabled: current.settings?.enabled !== false,
    hideStudentId: current.settings?.hideStudentId === true,
    modules: Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.modules).map(([module, enabled]) => [
        module,
        module === "trajectoryHome" ? true : module in savedModules ? savedModules[module] : enabled
      ])
    )
  };
  const releaseNotice = globalThis.MISaesCore.releaseNoticeForInstall({
    reason: details?.reason,
    previousVersion: details?.previousVersion,
    currentVersion: chrome.runtime.getManifest().version
  });
  await chrome.storage.local.set(releaseNotice ? { settings, releaseNotice } : { settings });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "MI_SAES_TOGGLE_PANEL" }).catch(() => undefined);
});
