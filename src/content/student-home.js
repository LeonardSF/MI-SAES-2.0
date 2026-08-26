(function initMiSaesStudentHome(globalScope) {
  "use strict";

  function photoCandidatesFromDocument(document) {
    return [...(document?.querySelectorAll?.("img") || [])].map((image) => ({
      src: image.getAttribute("src") || "",
      id: image.id || "",
      name: image.getAttribute("name") || "",
      alt: image.getAttribute("alt") || "",
      className: image.className || ""
    }));
  }

  function officialPhotoFromDocument(document, pageUrl, core) {
    return core.officialStudentPhotoUrl(photoCandidatesFromDocument(document), pageUrl);
  }

  function create({ document, stylesheetUrl, identity }) {
    const host = document.createElement("section");
    host.id = "misaes-student-home";
    host.setAttribute("aria-label", "Inicio del alumno");
    const shadow = host.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = stylesheetUrl;

    const surface = document.createElement("header");
    surface.className = "ms-student-home";
    const photoFrame = document.createElement("div");
    photoFrame.className = "ms-student-home__photo";
    photoFrame.hidden = true;
    const photo = document.createElement("img");
    photo.alt = "Fotografía oficial del alumno";
    photo.decoding = "async";
    photo.loading = "eager";
    photo.referrerPolicy = "same-origin";
    photoFrame.append(photo);

    const copy = document.createElement("div");
    copy.className = "ms-student-home__copy";
    const name = document.createElement("h1");
    name.className = "ms-student-home__name";
    name.textContent = identity.name;
    const greeting = document.createElement("p");
    greeting.className = "ms-student-home__greeting";
    greeting.textContent = identity.greeting;
    const detail = document.createElement("p");
    detail.className = "ms-student-home__detail";
    detail.textContent = "Tu información académica, clara y en un solo lugar.";
    copy.append(name, greeting, detail);
    surface.append(photoFrame, copy);
    shadow.append(stylesheet, surface);

    function setPhoto(url) {
      if (!url) return;
      photo.addEventListener("load", () => { photoFrame.hidden = false; }, { once: true });
      photo.addEventListener("error", () => {
        photoFrame.hidden = true;
        photo.removeAttribute("src");
      }, { once: true });
      photo.src = url;
    }

    return { host, setPhoto };
  }

  const api = Object.freeze({ photoCandidatesFromDocument, officialPhotoFromDocument, create });
  globalScope.MISaesStudentHome = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
