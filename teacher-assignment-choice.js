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
            <p class="subtle" style="margin:0;max-width:620px;">Choose AI-assisted setup or manual setup. Both paths use the same rubric, CEFR level, chatbot settings, feedback limits, and grading workflow.</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
          ${workflowCard(
            "ai",
            currentFlow,
            "Create with AI support",
            "Add a rough brief, let Praxis create a student-ready version, then review the settings before saving.",
            "Use AI-assisted setup"
          )}
          ${workflowCard(
            "manual",
            currentFlow,
            "Set up manually",
            "Write the student title and instructions yourself, then review the same rubric, level, chatbot, and grading settings before saving.",
            "Use manual setup"
          )}
        </div>
      </div>
    `;
  }

  function renderManualProxyHtml() {
    return `
      <div id="manual-assignment-proxy" class="teacher-ready-card" style="padding:16px;border-color:var(--line);background:#fff;">
        <p class="mini-label" style="margin-bottom:4px;">Manual assignment setup</p>
        <h3 style="font-size:1.05rem;margin:0 0 6px;color:var(--ink);">Write the student-facing task</h3>
        <p class="subtle" style="margin:0 0 14px;">Write the task first, then check the assignment settings below before saving.</p>
        <label style="font-size:0.85rem;font-weight:700;color:var(--ink);display:block;margin-bottom:6px;">Assignment title</label>
        <input id="manual-assignment-title" placeholder="e.g. Process paragraph: how to make Moroccan mint tea" style="width:100%;margin-bottom:12px;" />
        <label style="font-size:0.85rem;font-weight:700;color:var(--ink);display:block;margin-bottom:6px;">Student instructions</label>
        <textarea id="manual-assignment-prompt" rows="8" placeholder="Write the instructions students will see..." style="width:100%;resize:vertical;margin-bottom:10px;"></textarea>
        <p class="subtle" style="margin:0;font-size:0.82rem;">Next: review the rubric and assignment settings, then save below.</p>
      </div>
    `;
  }

  function renderManualSaveBarHtml() {
    return `
      <div id="manual-assignment-save-bar" class="teacher-ready-card" style="padding:14px 16px;border-color:var(--line);background:#fffefb;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <p class="mini-label" style="margin-bottom:3px;">Final step</p>
            <p id="manual-assignment-save-hint" class="subtle" style="margin:0;font-size:0.84rem;">Add a title and instructions, then check the settings above before saving.</p>
          </div>
          <button class="button" type="button" data-manual-settings-save="true" disabled>Save assignment</button>
        </div>
      </div>
    `;
  }

  function renderAiSaveBarHtml() {
    return `
      <div id="ai-assignment-save-bar" class="teacher-ready-card" style="padding:14px 16px;border-color:var(--line);background:#fffefb;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <p class="mini-label" style="margin-bottom:3px;">Final step</p>
            <p id="ai-assignment-save-hint" class="subtle" style="margin:0;font-size:0.84rem;">Review the student-ready version and settings above, then save when ready.</p>
          </div>
          <button class="button" type="button" data-ai-settings-save="true" onclick="console.log('[AI direct save clicked]'); window.saveCurrentTeacherAssignment && window.saveCurrentTeacherAssignment()">Save assignment</button>
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

    const briefCard = document.querySelector("#teacher-brief")?.closest(".teacher-ready-card");
    const briefHeading = briefCard?.querySelector("h3, h2");
    if (briefHeading && briefHeading.textContent.trim() === "Describe the assignment in plain English") {
      briefHeading.textContent = "AI-assisted setup";
    }
    const briefHelp = briefCard?.querySelector(".subtle");
    if (briefHelp && briefHelp.textContent.includes("Format With AI")) {
      briefHelp.textContent = "Add your rough brief, then create a student-ready version for review.";
    }
  }

  function getManualProxyValues() {
    return {
      title: document.getElementById("manual-assignment-title")?.value?.trim() || "",
      prompt: document.getElementById("manual-assignment-prompt")?.value?.trim() || "",
    };
  }

  function manualTitleAndPromptAreReady() {
    const proxyValues = getManualProxyValues();
    const hiddenTitle = document.getElementById("teacher-title")?.value?.trim() || "";
    const hiddenPrompt = document.getElementById("teacher-prompt")?.value?.trim() || "";
    return Boolean((proxyValues.title || hiddenTitle) && (proxyValues.prompt || hiddenPrompt));
  }

  function syncManualProxyToHiddenFields() {
    const titleField = document.getElementById("teacher-title");
    const promptField = document.getElementById("teacher-prompt");
    const { title, prompt } = getManualProxyValues();

    if (titleField && titleField.value !== title) {
      titleField.value = title;
      titleField.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (promptField && promptField.value !== prompt) {
      promptField.value = prompt;
      promptField.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function syncHiddenFieldsToManualProxy() {
    const proxyTitle = document.getElementById("manual-assignment-title");
    const proxyPrompt = document.getElementById("manual-assignment-prompt");
    const hiddenTitle = document.getElementById("teacher-title")?.value || "";
    const hiddenPrompt = document.getElementById("teacher-prompt")?.value || "";

    if (proxyTitle && !proxyTitle.value && hiddenTitle) proxyTitle.value = hiddenTitle;
    if (proxyPrompt && !proxyPrompt.value && hiddenPrompt) proxyPrompt.value = hiddenPrompt;
  }

  function updateManualSaveButtons(currentFlow) {
    if (currentFlow !== "manual") return;
    const ready = manualTitleAndPromptAreReady();
    document.querySelectorAll('[data-action="save-assignment"], [data-manual-settings-save]').forEach((button) => {
      button.disabled = !ready;
      button.title = ready ? "" : "Add a student-facing title and prompt first.";
    });

    const hint = document.getElementById("manual-assignment-save-hint");
    if (hint) {
      hint.textContent = ready
        ? "Review the assignment settings above, then save when ready."
        : "Add a title and instructions, then check the settings above before saving.";
    }
  }

  function ensureManualProxy(fieldStack, settings) {
    if (!fieldStack || !settings) return null;
    let proxy = document.getElementById("manual-assignment-proxy");
    if (!proxy) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderManualProxyHtml().trim();
      proxy = wrapper.firstElementChild;
      fieldStack.insertBefore(proxy, settings);
    } else if (proxy.parentElement !== fieldStack) {
      fieldStack.insertBefore(proxy, settings);
    }
    syncHiddenFieldsToManualProxy();
    return proxy;
  }

  function ensureManualSaveBar(fieldStack, settings) {
    if (!fieldStack || !settings) return null;
    let saveBar = document.getElementById("manual-assignment-save-bar");
    if (!saveBar) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderManualSaveBarHtml().trim();
      saveBar = wrapper.firstElementChild;
    }
    if (saveBar.parentElement !== fieldStack || saveBar.previousElementSibling !== settings) {
      fieldStack.insertBefore(saveBar, settings.nextSibling);
    }
    return saveBar;
  }

  function ensureAiSaveBar(fieldStack, settings) {
    if (!fieldStack || !settings) return null;
    let saveBar = document.getElementById("ai-assignment-save-bar");
    if (!saveBar) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderAiSaveBarHtml().trim();
      saveBar = wrapper.firstElementChild;
    }
    const manualSaveBar = document.getElementById("manual-assignment-save-bar");
    const anchor = manualSaveBar?.parentElement === fieldStack ? manualSaveBar.nextSibling : settings.nextSibling;
    if (saveBar.parentElement !== fieldStack || saveBar.previousElementSibling !== settings) {
      fieldStack.insertBefore(saveBar, anchor);
    }
    return saveBar;
  }

  function originalSaveButtons() {
    return Array.from(document.querySelectorAll('[data-action="save-assignment"]'))
      .filter((button) => !button.matches("[data-manual-settings-save], [data-ai-settings-save]"));
  }

  function clickBestOriginalSaveButton() {
    const buttons = originalSaveButtons().filter((button) => !button.disabled);
    const preferred = buttons.find((button) => button.closest("#teacher-generated-assignment"))
      || buttons[buttons.length - 1]
      || originalSaveButtons()[0]
      || null;
    preferred?.click();
  }

  function setOriginalSaveVisibility(shouldShow) {
    originalSaveButtons().forEach((button) => {
      button.style.display = shouldShow ? "" : "none";
    });
  }

  function aiDraftExists(generated) {
  return Boolean(
    generated &&
    generated.textContent &&
    generated.textContent.trim().length > 20
  );
}

 function updateAiSaveBar(currentFlow, generated) {
  const saveBar = document.getElementById("ai-assignment-save-bar");
  if (!saveBar || currentFlow !== "ai") return;

  const ready = aiDraftExists(generated);

  saveBar.querySelectorAll("[data-ai-settings-save]").forEach((button) => {
    button.disabled = !ready;
    button.title = ready ? "" : "Create a student-ready version first.";

    if (!button.dataset.directSaveBound) {
      button.dataset.directSaveBound = "true";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        console.log("[AI save button listener clicked]", {
          saveFunction: typeof window.saveCurrentTeacherAssignment,
          disabled: button.disabled,
        });

        if (button.disabled) return;

        if (typeof window.saveCurrentTeacherAssignment === "function") {
          await window.saveCurrentTeacherAssignment();
        } else {
          console.warn("[saveCurrentTeacherAssignment missing]");
        }
      });
    }
  });

  const hint = document.getElementById("ai-assignment-save-hint");
  if (hint) {
    hint.textContent = ready
      ? "Review the student-ready version and assignment settings above, then save when ready."
      : "Create a student-ready version first, then review settings before saving.";
  }
}
  
  function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
    const brief = document.getElementById("teacher-brief");
    const briefCard = brief?.closest(".teacher-ready-card");
    const generated = document.getElementById("teacher-generated-assignment");
    const manualDetails = generated?.querySelector("details");
    const hasAiDraft = aiDraftExists(generated);
    const manualProxy = ensureManualProxy(fieldStack, settings);
    const manualSaveBar = ensureManualSaveBar(fieldStack, settings);
    const aiSaveBar = ensureAiSaveBar(fieldStack, settings);

    setDisplay(briefCard, currentFlow === "ai");
    setDisplay(manualProxy, currentFlow === "manual");
    setDisplay(manualSaveBar, currentFlow === "manual");
    setDisplay(aiSaveBar, false);

    if (manualDetails) {
      // Keep the original manual form in place for app logic, but hide it from the visible workflow.
      setDisplay(generated, false);
      if (currentFlow === "manual") {
        manualDetails.open = true;
      }
      setOriginalSaveVisibility(false);
    } else if (generated) {
  // If an AI draft exists, keep it visible so the teacher can review it.
  setDisplay(generated, currentFlow === "ai" && hasAiDraft);

  // In AI mode, show the native app.js save button instead of relying on the proxy save button.
  setOriginalSaveVisibility(true);
}

    updateManualSaveButtons(currentFlow);
    updateAiSaveBar(currentFlow, generated);
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

  document.addEventListener("click", async (event) => {
    const flowButton = event.target.closest("[data-assignment-flow-choice]");
    if (flowButton) {
      const flow = flowButton.dataset.assignmentFlowChoice;
      if (flow !== "ai" && flow !== "manual") return;
      setFlow(flow);
      enhanceTeacherAssignmentSetup();
      return;
    }

    const manualSaveButton = event.target.closest("[data-manual-settings-save]");
if (manualSaveButton) {
  event.preventDefault();
  event.stopPropagation();
  syncManualProxyToHiddenFields();

  console.log("[manual proxy save clicked]");
  if (typeof window.saveCurrentTeacherAssignment === "function") {
    await window.saveCurrentTeacherAssignment();
  } else {
    console.warn("[saveCurrentTeacherAssignment missing, falling back]");
    clickBestOriginalSaveButton();
  }
  return;
}

const aiSaveButton = event.target.closest("[data-ai-settings-save]");
if (!aiSaveButton) return;

event.preventDefault();
event.stopPropagation();

console.log("[AI proxy save clicked]");
if (typeof window.saveCurrentTeacherAssignment === "function") {
  await window.saveCurrentTeacherAssignment();
} else {
  console.warn("[saveCurrentTeacherAssignment missing, falling back]");
  clickBestOriginalSaveButton();
}
  });

  document.addEventListener("input", (event) => {
    if (event.target.closest("#manual-assignment-proxy")) {
      syncManualProxyToHiddenFields();
      updateManualSaveButtons(getFlow());
      return;
    }
    if (!event.target.closest("#teacher-generated-assignment")) return;
    updateManualSaveButtons(getFlow());
    updateAiSaveBar(getFlow(), document.getElementById("teacher-generated-assignment"));
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
