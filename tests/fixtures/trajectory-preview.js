"use strict";

globalThis.MISaesTrajectoryView.render(document.getElementById("trajectory-preview"), {
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
      authorizedLoad: 70
    },
    kardex: {
      records: 42,
      gradesFromSix: 40,
      gradesBelowSix: 2,
      withoutNumericGrade: 0
    },
    status: {
      records: 2,
      repeatedRecords: 1
    },
    sources: {
      reenrollment: "ready",
      status: "ready",
      kardex: "ready"
    }
  }
});
