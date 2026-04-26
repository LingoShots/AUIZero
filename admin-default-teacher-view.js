(() => {
  const FLAG = "praxis-admin-defaulted-teacher-this-load";
  let scheduled = false;

  function tryDefaultToTeacherView() {
    if (window[FLAG]) return;

    try {
      if (typeof currentProfile === "undefined" || typeof ui === "undefined" || typeof render !== "function") return;
      if (!currentProfile || currentProfile.role !== "admin") return;
      if (ui.adminViewingAsTeacher === true) return;

      ui.adminViewingAsTeacher = true;
      ui.teacherView = ui.teacherView || "assignments";
      window[FLAG] = true;
      render();
    } catch (_) {
      // Leave the normal app render alone if the expected globals are not available.
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      tryDefaultToTeacherView();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    schedule();
    setTimeout(schedule, 250);
    setTimeout(schedule, 1000);
    const app = document.getElementById("app");
    if (app) {
      new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
    }
  });
})();
