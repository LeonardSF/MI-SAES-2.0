"use strict";

const source = document.getElementById("ctl00_mainCopy_FormView1");
source.dataset.misaesHomeSource = "true";
const studentHeader = globalThis.MISaesStudentHome.create({
  document,
  stylesheetUrl: "/src/content/student-home.css",
  identity: globalThis.MISaesCore.studentGreetingModel([...source.rows].map((row) => row.textContent))
});
source.insertAdjacentElement("afterend", studentHeader.host);
studentHeader.setPhoto(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 120"><rect width="90" height="120" fill="#750946"/><circle cx="45" cy="38" r="18" fill="#fff"/><path d="M14 112c4-28 18-42 31-42s27 14 31 42" fill="#fff"/></svg>')}`);

const host = document.getElementById("misaes-trajectory-home");
const shadow = host.attachShadow({ mode: "open" });
const baseStylesheet = document.createElement("link");
baseStylesheet.rel = "stylesheet";
baseStylesheet.href = "/src/content/content.css";
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/src/content/trajectory-home.css";
const surface = document.createElement("section");
surface.className = "ms-trajectory-home-surface";
const view = document.createElement("div");
view.className = "ms-view ms-trajectory-home__view";
surface.append(view);
shadow.append(baseStylesheet, stylesheet, surface);

globalThis.MISaesTrajectoryView.render(view, {
  embedded: true,
  snapshot: {
    state: "ready",
    progressPercent: 72,
    updatedAt: "2026-08-26T03:00:00.000Z",
    reenrollment: {
      average: 8.36,
      failedSubjects: 1,
      earnedCredits: 310,
      remainingCredits: 120,
      periodsCompleted: 7,
      periodsAvailable: 4,
      minimumLoad: 35,
      mediumLoad: 70,
      maximumLoad: 100,
      authorizedLoad: 70
    },
    kardex: { records: 42, gradesFromSix: 40, gradesBelowSix: 2, withoutNumericGrade: 0 },
    status: { records: 2, repeatedRecords: 1 },
    sources: { reenrollment: "ready", status: "ready", kardex: "ready" }
  }
});

const header = view.querySelector(".ms-trajectory-home__header");
const hero = view.querySelector(".ms-trajectory-home__hero");
const freshness = header?.querySelector("time");
document.getElementById("trajectory-layout-result").textContent = header?.querySelector(".ms-heading")
  && header.querySelector(".ms-button--primary")
  && hero?.querySelector(".ms-trajectory-progress")
  && hero.querySelector(".ms-trajectory-metrics")
  && freshness?.dateTime === "2026-08-26T03:00:00.000Z"
  ? "ready"
  : "missing";
