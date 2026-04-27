// CLEAN RESTORED VERSION
// keeps selector cards + fixes fold-out logic

(() => {
  const FLOW_STORAGE_KEY = "praxis-assignment-creation-flow";

  function getFlow() {
    try {
      return window.sessionStorage.getItem(FLOW_STORAGE_KEY) || "ai";
    } catch {
      return "ai";
    }
  }

  function setFlow(flow) {
    try {
      window.sessionStorage.setItem(FLOW_STORAGE_KEY, flow);
    } catch {}
  }

  function setDisplay(el, show) {
    if (el) el.style.display = show ? "" : "none";
  }

  function aiDraftExists() {
    return Boolean(window.ui?.teacherAssist?.prompt || window.ui?.teacherAssist?.title);
  }

  function applyWorkflowVisibility(flow) {
    const brief = document.getElementById("teacher-brief")?.closest(".teacher-ready-card");
    const generated = document.getElementById("teacher-generated-assignment");

    const hasDraft = aiDraftExists();

    if (flow === "ai") {
      document.getElementById("manual-assignment-proxy")?.remove();
      document.getElementById("manual-assignment-save-bar")?.remove();

      setDisplay(brief, true);
      setDisplay(generated, hasDraft);

      document.querySelectorAll('[data-action="save-assignment"]').forEach(btn => {
        btn.style.display = hasDraft ? "" : "none";
      });

      let intro = document.getElementById("ai-review-intro");
      if (hasDraft) {
        if (!intro) {
          intro = document.createElement("div");
          intro.id = "ai-review-intro";
          intro.className = "teacher-ready-card";
          intro.style.padding = "14px 16px";
          intro.innerHTML = `
            <p class="mini-label">Step 2</p>
            <strong>Review before saving</strong>
          `;
          generated.parentElement.insertBefore(intro, generated);
        }
      } else {
        intro?.remove();
      }
    }

    if (flow === "manual") {
      document.getElementById("ai-review-intro")?.remove();
    }
  }

  function enhance() {
    applyWorkflowVisibility(getFlow());
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-assignment-flow-choice]");
    if (btn) {
      setFlow(btn.dataset.assignmentFlowChoice);
      enhance();
    }
  });

  window.addEventListener("DOMContentLoaded", enhance);
})();
