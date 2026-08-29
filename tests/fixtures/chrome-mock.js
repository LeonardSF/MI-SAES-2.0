"use strict";

const localState = {};
const changeListeners = [];

if (new URLSearchParams(location.search).has("release-preview")) {
  localState.releaseNotice = { version: "0.14.0", previousVersion: "0.13.0" };
}

if (new URLSearchParams(location.search).has("curriculum-preview")) {
  const updatedAt = "2026-08-26T20:00:00.000Z";
  localState[`planner-config:${location.origin}:schedule`] = {
    careerValue: "ISC",
    careerLabel: "INGENIERÍA EN COMPUTACIÓN",
    planValue: "04",
    planLabel: "Plan del 1/1/2004",
    modeIndex: "0",
    modeLabel: "Periodo actual"
  };
  localState[`trajectory:${location.origin}`] = {
    state: "ready",
    updatedAt,
    kardex: { entries: [
      { key: "", name: "MODULACIÓN DIGITAL", period: "2025/1", date: "2025-06-01", grade: 8 },
      { key: "", name: "SISTEMAS OPERATIVOS", period: "2025/2", date: "2025-12-01", grade: 5 }
    ] }
  };
  localState[`curriculum:${location.origin}`] = {
    state: "partial",
    updatedAt,
    career: "INGENIERÍA EN COMPUTACIÓN",
    plan: "Plan del 1/1/2004",
    periods: Array.from({ length: 9 }, (_, index) => ({
      period: index + 1,
      state: index === 3 ? "stale" : "ready",
      updatedAt,
      error: index === 3 ? "SAES no respondió" : "",
      subjects: index < 4 ? [
        { key: "", name: ["MODULACIÓN DIGITAL", "SISTEMAS OPERATIVOS", "BASES DE DATOS", "INGENIERÍA DE SOFTWARE"][index], period: index + 1, credits: 6 + index, theoryHours: 3, practiceHours: 1.5 }
      ] : []
    }))
  };
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.filter((key) => key in localState).map((key) => [key, localState[key]]));
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => {
          const oldValue = localState[key];
          localState[key] = value;
          changeListeners.forEach((listener) => listener({ [key]: { oldValue, newValue: value } }, "local"));
        });
      },
      async remove(keys) {
        const requested = Array.isArray(keys) ? keys : [keys];
        requested.forEach((key) => {
          if (!(key in localState)) return;
          const oldValue = localState[key];
          delete localState[key];
          changeListeners.forEach((listener) => listener({ [key]: { oldValue } }, "local"));
        });
      }
    },
    onChanged: {
      addListener(listener) {
        changeListeners.push(listener);
      }
    }
  },
  runtime: {
    getManifest() {
      return { version: "0.14.0" };
    },
    getURL(resource) {
      return `/${resource}`;
    },
    onMessage: {
      addListener() {}
    }
  }
};
