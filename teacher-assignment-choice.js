(() => {
  const FLOW_STORAGE_KEY = "praxis-assignment-creation-flow";

  let enhanceScheduled = false;
  let isEnhancing = false;

  function getFlow() {
    try {
      return window.sessionStorage.getItem(FLOW_STORAGE_KEY) || "ai";
    } catch (_) {
      return "ai";
    }
  }

  function setFlow(flow) {
    try {
      window.sessionStorage.setItem(FLOW_STORAGE_KEY, flow);
    } catch (_) {
      // Keep the UI usable even if sessionStorage is unavailable.
    }
  }

  function setDisplay(element, shouldShow) {
    if (!element) return;
    element.style.display = shouldShow ? "" : "none";
  }

  function workflowCard(flow, currentFlow, title, body, buttonText) {
    const active = flow === currentFlow;
    return `
      <div data-assignment-flow-card="${flow}" style="
        border:1px solid ${active ? "var(--accent)" : "var(--line)"};
        background:${active ? "#fffaf0" : "#fff"};
        border-radius:16px;
        padding:16px;
        box-shadow:${active ? "0 8px 22px rgba(185, 130, 55, 0.12)" : "none"};
        display:flex;
        flex-direction:column;
        gap:12px;
        min-height:178px;
      ">
        <div>
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">
            <h3 style="font-size:1rem;margin:0;color:var(--ink);">${title}</h3>
            ${active ? `<span class="pill" style="color:var(--accent-deep);border-color:var(--accent);">Selected</span>` : ""}
          </div>
          <p class="subtle" style="margin:0;line-height:1.5;">${body}</p>
        </div>
        <button class="${active ? "button" : "button-secondary"}" type="button" data-assignment-flow-choice="${flow}" style="margin-top:auto;width:100%;">
          ${buttonText}
        </button>
      </div>
    `;
  }

  function renderChoiceHtml(currentFlow) {
    return `
      <div id="assignment-workflow-choice" data-current-flow="${currentFlow}" class="teacher-ready-card" style="padding:16px;border-color:var(--line);background:#fffefb;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">
          <div>
            <p class="mini-label" style="margin-bottom:4px;">Create assignment</p>
            <h3 style="font-size:1.08rem;margin:0 0 5px;color:var(--ink);">How would you like to start?</h3>
            <p class="subtle" style="margin:0;max-width:620px;">Both paths use the same rubric, CEFR level, chatbot settings, feedback limits, and grading workflow. You are only choosing how to create the student-facing task.</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
          ${workflowCard(
            "ai",
            currentFlow,
            "Create with AI support",
            "Describe your assignment in plain English, then let Praxis turn it into clear student-ready instructions that you can review and edit before saving.",
            "Use AI-assisted setup"
          )}
          ${workflowCard(
            "manual",
            currentFlow,
            "Set up manually",
            "Write the student title and instructions yourself while still using the same rubric parsing, level settings, chatbot controls, and grading tools.",
            "Use manual setup"
          )}
        </div>
      </div>
    `;
  }

  function relabelTeacherButtons() {
    document.querySelectorAll('[data-action="generate-teacher-assist"]').forEach((button) => {
      button.textContent = button.disabled ? "Creating…" : "Create student-ready version";
    });

    document.querySelectorAll('[data-action="save-assignment"]').forEach((button) => {
      const text = (button.textContent || "").trim();
      if (text === "Save") button.textContent = "Save assignment";
    });

    const briefHelp = document.querySelector("#teacher-brief")?.closest(".teacher-ready-card")?.querySelector(".subtle");
    if (briefHelp && briefHelp.textContent.includes("Format With AI")) {
      briefHelp.textContent = "Describe the assignment in plain English, then create a student-ready version for review.";
    }
  }

  function manualTitleAndPromptAreReady() {
    const title = document.getElementById("teacher-title")?.value?.trim() || "";
    const prompt = document.getElementById("teacher-prompt")?.value?.trim() || "";
    return Boolean(title && prompt);
  }

  function updateManualSaveButtons(currentFlow) {
    if (currentFlow !== "manual") return;
    const ready = manualTitleAndPromptAreReady();
    document.querySelectorAll('[data-action="save-assignment"]').forEach((button) => {
      button.disabled = !ready;
      button.title = ready ? "" : "Add a student-facing title and prompt first.";
    });
  }

  function placeGeneratedPanel(currentFlow, fieldStack, settings, generated) {
    const manualDetails = generated?.querySelector("details");
    if (!generated || !fieldStack || !settings) return;

    if (currentFlow === "manual" && manualDetails) {
      fieldStack.insertBefore(generated, settings);
      return;
    }

    const setupPanel = fieldStack.closest(".panel") || fieldStack.parentElement;
    if (setupPanel && generated.parentElement === fieldStack) {
      setupPanel.insertBefore(generated, fieldStack.nextSibling);
    }
  }

  function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
    const brief = document.getElementById("teacher-brief");
    const briefCard = brief?.closest(".teacher-ready-card");
    const generated = document.getElementById("teacher-generated-assignment");
    const manualDetails = generated?.querySelector("details");
    const hasAiDraft = Boolean(generated?.querySelector("#teacher-assist-prompt"));

    placeGeneratedPanel(currentFlow, fieldStack, settings, generated);
    setDisplay(briefCard, currentFlow === "ai");

    if (manualDetails) {
      setDisplay(generated, currentFlow === "manual");
      if (currentFlow === "manual") {
        manualDetails.open = true;
      }
    } else if (generated) {
      // If an AI draft exists, keep it visible so the teacher can review/save it.
      setDisplay(generated, hasAiDraft || currentFlow === "manual");
    }

    updateManualSaveButtons(currentFlow);
  }

  function enhanceTeacherAssignmentSetup() {
    if (isEnhancing) return;
    isEnhancing = true;

    try {
      const rubric = document.getElementById("teacher-rubric-upload");
      const settings = document.getElementById("teacher-shared-settings");
      const brief = document.getElementById("teacher-brief");
      const generated = document.getElementById("teacher-generated-assignment");

      if (!rubric || !settings || !brief || !generated) return;

      const fieldStack = rubric.parentElement;
      if (!fieldStack) return;

      let currentFlow = getFlow();
      if (currentFlow !== "ai" && currentFlow !== "manual") currentFlow = "ai";

      let choice = document.getElementById("assignment-workflow-choice");
      if (!choice) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = renderChoiceHtml(currentFlow).trim();
        choice = wrapper.firstElementChild;
        fieldStack.insertBefore(choice, rubric);
      } else if (choice.dataset.currentFlow !== currentFlow) {
        choice.outerHTML = renderChoiceHtml(currentFlow).trim();
      }

      applyWorkflowVisibility(currentFlow, fieldStack, settings);
      relabelTeacherButtons();
    } finally {
      isEnhancing = false;
    }
  }

  function scheduleEnhancement() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    window.requestAnimationFrame(() => {
      enhanceScheduled = false;
      enhanceTeacherAssignmentSetup();
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-assignment-flow-choice]");
    if (!button) return;
    const flow = button.dataset.assignmentFlowChoice;
    if (flow !== "ai" && flow !== "manual") return;
    setFlow(flow);
    enhanceTeacherAssignmentSetup();
  });

  document.addEventListener("input", (event) => {
    if (!event.target.closest("#teacher-generated-assignment")) return;
    updateManualSaveButtons(getFlow());
  });

  const observer = new MutationObserver(scheduleEnhancement);

  window.addEventListener("DOMContentLoaded", () => {
    enhanceTeacherAssignmentSetup();
    const app = document.getElementById("app");
    if (app) {
      observer.observe(app, { childList: true, subtree: true });
    }
  });
})();
