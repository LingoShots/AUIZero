(() => {
  const FLAG = "praxis-clicked-teacher-view-control-this-load";
  let scheduled = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 12;

  function isVisible(element) {
    return Boolean(element && element.offsetParent !== null);
  }

  function looksLikeTeacherViewControl(element) {
    const text = String(element?.textContent || "").trim().toLowerCase();
    if (!text) return false;
    return text === "teacher view"
      || text === "view as teacher"
      || text === "switch to teacher view"
      || text.includes("teacher view")
      || text.includes("view as teacher");
  }

  function looksLikeAdminViewIsOpen() {
    const appText = String(document.getElementById("app")?.textContent || "").toLowerCase();
    return appText.includes("admin") && !appText.includes("class work");
  }

  function preferTeacherView() {
    if (window[FLAG]) return;
    attempts += 1;

    const controls = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible)
      .filter(looksLikeTeacherViewControl);

    const control = controls[0];
    if (!control) return;

    // Use the app's own control instead of mutating app state directly.
    // This keeps class/assignment/submission loading inside the normal app logic.
    window[FLAG] = true;
    control.click();
  }

  function schedule() {
    if (scheduled || window[FLAG] || attempts >= MAX_ATTEMPTS) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      preferTeacherView();
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    schedule();
    const timers = [250, 750, 1500, 3000];
    timers.forEach((delay) => setTimeout(schedule, delay));

    const app = document.getElementById("app");
    if (app) {
      new MutationObserver(() => {
        if (!looksLikeAdminViewIsOpen()) return;
        schedule();
      }).observe(app, { childList: true, subtree: true });
    }
  });
})();
