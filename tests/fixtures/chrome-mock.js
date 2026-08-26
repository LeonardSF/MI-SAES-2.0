"use strict";

const localState = {};
const changeListeners = [];

if (new URLSearchParams(location.search).has("release-preview")) {
  localState.releaseNotice = { version: "0.13.0", previousVersion: "0.12.4" };
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
      return { version: "0.13.0" };
    },
    getURL(resource) {
      return `/${resource}`;
    },
    onMessage: {
      addListener() {}
    }
  }
};
