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
            <p class="subtle" style="margin:0;max-width:620px;">Choose one path. The page will then show only the fields needed for that workflow.</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
          ${workflowCard(
            "ai",
            currentFlow,
            "Create with AI support",
            "Step 1: describe the task. Step 2: review the generated version and save.",
            "Use AI-assisted setup"
          )}
          ${workflowCard(
            "manual",
            currentFlow,
            "Set up manually",
            "Write the student title and instructions yourself, then save with the same shared settings.",
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
        <p class="subtle" style="margin:0 0 14px;">Only this manual task form is shown in manual mode. Shared settings stay below.</p>
        <label for="manual-assignment-title" style="font-size:0.85rem;font-weight:700;color:var(--ink);display:block;margin-bottom:6px;">Assignment title</label>
        <input id="manual-assignment-title" name="manual-assignment-title" placeholder="e.g. Process paragraph: how to make Moroccan mint tea" style="width:100%;margin-bottom:12px;" />
        <label for="manual-assignment-prompt" style="font-size:0.85rem;font-weight:700;color:var(--ink);display:block;margin-bottom:6px;">Student instructions</label>
        <textarea id="manual-assignment-prompt" name="manual-assignment-prompt" rows="8" placeholder="Write the instructions students will see..." style="width:100%;resize:vertical;margin-bottom:10px;"></textarea>
        <p class="subtle" style="margin:0;font-size:0.82rem;">Next: review the rubric and shared settings, then save below.</p>
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

  function renderAiReviewIntroHtml() {
    return `
      <div id="ai-review-intro" class="teacher-ready-card" style="padding:14px 16px;border-color:var(--line);background:#fffefb;">
        <p class="mini-label" style="margin-bottom:3px;">Step 2</p>
        <h3 style="font-size:1.02rem;margin:0 0 5px;color:var(--ink);">Review before saving</h3>
        <p class="subtle" style="margin:0;font-size:0.84rem;">Check the generated title, prompt, word count, rubric, and shared settings. Then use the native Save assignment button.</p>
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
      briefHeading.textContent = "Step 1: Describe the assignment";
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
    const { title, prompt } = getManualProxyValues();
    return Boolean(title && prompt);
  }

  function syncManualProxyToHiddenFields() {
    const titleField = document.getElementById("teacher-title");
    const promptField = document.getElementById("teacher-prompt");
    const { title, prompt } = getManualProxyValues();

    if (titleField) {
      titleField.value = title;
      titleField.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (promptField) {
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
        ? "Review the rubric and shared settings, then save when ready."
        : "Add a title and instructions, then check the settings above before saving.";
    }
  }

  function aiDraftExists(generated) {
    return Boolean(generated && generated.textContent && generated.textContent.trim().length > 80);
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

  function ensureAiReviewIntro(fieldStack, generated) {
    if (!fieldStack || !generated) return null;
    let intro = document.getElementById("ai-review-intro");
    if (!intro) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderAiReviewIntroHtml().trim();
      intro = wrapper.firstElementChild;
    }
    if (intro.parentElement !== fieldStack || intro.nextElementSibling !== generated) {
      fieldStack.insertBefore(intro, generated);
    }
    return intro;
  }

  function originalSaveButtons() {
    return Array.from(document.querySelectorAll('[data-action="save-assignment"]'))
      .filter((button) => !button.matches("[data-manual-settings-save]"));
  }

  function setOriginalSaveVisibility(shouldShow) {
    originalSaveButtons().forEach((button) => {
      button.style.display = shouldShow ? "" : "none";
    });
  }

  function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
    const brief = document.getElementById("teacher-brief");
    const briefCard = brief?.closest(".teacher-ready-card");
    const generated = document.getElementById("teacher-generated-assignment");
    const manualProxy = ensureManualProxy(fieldStack, settings);
    const manualSaveBar = ensureManualSaveBar(fieldStack, settings);
    const aiReviewIntro = ensureAiReviewIntro(fieldStack, generated);
    const hasAiDraft = aiDraftExists(generated);

    setDisplay(briefCard, currentFlow === "ai");
    setDisplay(generated, currentFlow === "ai" && hasAiDraft);
    setDisplay(aiReviewIntro, currentFlow === "ai" && hasAiDraft);
    setDisplay(manualProxy, currentFlow === "manual");
    setDisplay(manualSaveBar, currentFlow === "manual");

    // In AI mode, the native save button appears only after a generated draft exists.
    setOriginalSaveVisibility(currentFlow === "ai" && hasAiDraft);

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
      if (typeof window.saveCurrentTeacherAssignment === "function") {
        await window.saveCurrentTeacherAssignment();
      }
    }
  });

  document.addEventListener("input", (event) => {
    if (!event.target.closest("#manual-assignment-proxy")) return;
    syncManualProxyToHiddenFields();
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
