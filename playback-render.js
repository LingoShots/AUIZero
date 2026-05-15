(function () {
  const PLAYBACK_INTRA_EVENT_DELAY_MS = 60;
  const PLAYBACK_MAX_FRAME_DELAY_MS = 1200;

  function renderPlaybackScreenOnly() {
    const { escapeHtml, getSelectedReviewSubmission } = window;
    const { ui } = window.AppState;
    const submission = getSelectedReviewSubmission();
    const playbackScreen = document.getElementById("playback-screen");
    if (!submission || !playbackScreen) {
      return;
    }

    const playback = getPlaybackState(submission);
    playbackScreen.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(playback.text)}</pre>`;
  }

  function getPlaybackSpeedMultiplier() {
    const { ui } = window.AppState;
    const speed = Number(ui.playback.speed || 1);
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  function getPlaybackFrameDelayMs(frames, index) {
    const rawDelay = Math.max(0, Number(frames?.[index]?.delayMs || 0));
    return Math.min(rawDelay, PLAYBACK_MAX_FRAME_DELAY_MS) / getPlaybackSpeedMultiplier();
  }

  function startPlayback(frames) {
    const { stopPlayback } = window;
    const { ui } = window.AppState;
    if (!frames.length) {
      return;
    }

    stopPlayback();
    ui.playback.isPlaying = true;
    const scheduleNextFrame = () => {
      if (ui.playback.index >= frames.length - 1) {
        stopPlayback();
        syncPlaybackUi();
        return;
      }
      const delay = getPlaybackFrameDelayMs(frames, ui.playback.index);
      ui.playback.timerId = window.setTimeout(() => {
        ui.playback.timerId = null;
        if (!ui.playback.isPlaying) return;
        if (ui.playback.index >= frames.length - 1) {
          stopPlayback();
          syncPlaybackUi();
          return;
        }
        ui.playback.index += 1;
        syncPlaybackUi();
        scheduleNextFrame();
      }, delay);
    };
    scheduleNextFrame();
  }

  function getEventTimeMs(event) {
    const parsed = Date.parse(event?.timestamp || "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isLargeSingleInsertEvent(event) {
    const { LARGE_PASTE_LIMIT } = window.AppConstants;
    return event?.type === "insert"
      && String(event?.insertedText || "").length >= LARGE_PASTE_LIMIT
      && !String(event?.removedText || "");
  }

  function isPasteLikeWritingEvent(event) {
    const { LARGE_PASTE_LIMIT } = window.AppConstants;
    return Boolean(
      event?.type === "paste"
      || (event?.flagged && String(event?.insertedText || "").length >= LARGE_PASTE_LIMIT)
      || isLargeSingleInsertEvent(event)
    );
  }

  function countPlaybackOperations(event) {
    if (window.ReviewUtils?.getPlaybackOperationCount) {
      return window.ReviewUtils.getPlaybackOperationCount(event);
    }
    if (!event || isPasteLikeWritingEvent(event) || event.type === "delete") return 1;
    if (event.type === "replace") return Math.max(1, 1 + String(event.insertedText || "").length);
    return Math.max(1, String(event.removedText || "").length + String(event.insertedText || "").length);
  }

  function getIntraEventDelayMs(event, nextEventTimeMs, eventTimeMs) {
    const operationCount = countPlaybackOperations(event);
    if (operationCount <= 1) return 0;
    if (Number.isFinite(nextEventTimeMs) && Number.isFinite(eventTimeMs) && nextEventTimeMs > eventTimeMs) {
      return Math.max(0, Math.min(PLAYBACK_INTRA_EVENT_DELAY_MS, (nextEventTimeMs - eventTimeMs) / operationCount));
    }
    return PLAYBACK_INTRA_EVENT_DELAY_MS;
  }

  function finalizePlaybackFrameDelays(frames) {
    const startTime = Number(frames[0]?.timeMs) || 0;
    for (let i = 0; i < frames.length; i += 1) {
      const currentTime = Number(frames[i]?.timeMs);
      const nextTime = Number(frames[i + 1]?.timeMs);
      frames[i].elapsedMs = Number.isFinite(currentTime) ? Math.max(0, currentTime - startTime) : 0;
      frames[i].delayMs = Number.isFinite(currentTime) && Number.isFinite(nextTime)
        ? Math.max(0, nextTime - currentTime)
        : 0;
    }
    return frames;
  }

  function formatPlaybackDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatPlaybackElapsedLabel(elapsedMs, totalMs) {
    const elapsed = formatPlaybackDuration(elapsedMs);
    const total = formatPlaybackDuration(totalMs);
    return totalMs > 0 ? `${elapsed} / ${total} recorded` : elapsed;
  }

  function stepPlayback(direction) {
    const { getSelectedReviewSubmission, stopPlayback, clamp } = window;
    const { ui } = window.AppState;
    const submission = getSelectedReviewSubmission();
    const frames = submission ? getPlaybackFrames(submission) : [];
    if (!frames.length) {
      return;
    }

    stopPlayback();
    ui.playback.index = clamp(ui.playback.index + direction, 0, frames.length - 1);
    syncPlaybackUi();
  }

  function syncPlaybackUi() {
    const { getSelectedReviewSubmission, escapeHtml } = window;
    const { ui } = window.AppState;
    const submission = getSelectedReviewSubmission();
    if (!submission) {
      return;
    }

    const playback = getPlaybackState(submission);
    const slider = document.getElementById("playback-slider");
    if (slider) {
      slider.value = String(playback.index);
    }

    const playbackScreen = document.getElementById("playback-screen");
    if (playbackScreen) {
      playbackScreen.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(playback.text)}</pre>`;
    }

    const playbackMeta = document.getElementById("playback-meta");
    if (playbackMeta) {
      playbackMeta.textContent = playback.timeLabel;
    }

    const playbackLabel = document.getElementById("playback-label");
    if (playbackLabel) {
      playbackLabel.textContent = playback.label;
    }

    const playbackToggle = document.querySelector('[data-action="playback-toggle"]');
    if (playbackToggle) {
      playbackToggle.textContent = ui.playback.isPlaying ? "Pause" : "Play";
    }
  }

  function updateDraftMeters() {
    const { getStudentSubmission, wordCount } = window;
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    updateTextContent("draft-word-count", String(wordCount(submission.draftText)));
    updateTextContent("draft-event-count", String(submission.writingEvents.length));
    updateTextContent(
      "draft-paste-count",
      String(submission.writingEvents.filter((entry) => isPasteLikeWritingEvent(entry)).length)
    );
  }

  function updateFinalMeters() {
    const { getStudentSubmission, wordCount } = window;
    const submission = getStudentSubmission();
    if (!submission) {
      return;
    }

    updateTextContent("final-word-count", String(wordCount(submission.finalText || submission.draftText)));
  }

  function updateTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function getPlaybackState(submission) {
    const { clamp } = window;
    const { ui } = window.AppState;
    const frames = getPlaybackFrames(submission);
    const index = clamp(ui.playback.index, 0, Math.max(frames.length - 1, 0));
    ui.playback.index = index;
    const frame = frames[index] || { text: "", label: "No frames yet" };

    return {
      frames,
      index,
      text: frame.text,
      label: frame.label,
      elapsedMs: frame.elapsedMs || 0,
      totalMs: frames[frames.length - 1]?.elapsedMs || 0,
      timeLabel: formatPlaybackElapsedLabel(frame.elapsedMs || 0, frames[frames.length - 1]?.elapsedMs || 0),
    };
  }

  function getPlaybackFrames(submission) {
    const { safeArray, clamp, titleCase, formatTime } = window;
    const events = safeArray(submission.writingEvents)
      .filter((event) => event?.phase !== "coach_outline");
    const eventSignature = getPlaybackEventSignature(events);
    if (submission._playbackCache && submission._playbackCache.eventSignature === eventSignature) {
      return submission._playbackCache.frames;
    }

    const firstEventTime = events.map(getEventTimeMs).find((time) => Number.isFinite(time)) || 0;
    let text = "";
    const frames = [
      {
        text: "",
        label: "Start",
        timeMs: firstEventTime,
      },
    ];

    const pushFrame = createPlaybackFramePusher(frames, firstEventTime);

    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      const eventTimeMs = getEventTimeMs(event) ?? (frames[frames.length - 1]?.timeMs || firstEventTime);
      const nextEventTimeMs = events.slice(eventIndex + 1).map(getEventTimeMs).find((time) => Number.isFinite(time));
      const intraEventDelayMs = getIntraEventDelayMs(event, nextEventTimeMs, eventTimeMs);
      text = applyPlaybackEvent({
        event,
        eventTimeMs,
        intraEventDelayMs,
        text,
        fallbackText: submission.draftText || text,
        pushFrame,
        clamp,
        titleCase,
        formatTime,
      });
    }

    const currentWriting = submission.finalText || submission.draftText || "";
    if (currentWriting !== text) {
      pushFrame(currentWriting, submission.finalText ? "Current final version" : "Current draft", frames[frames.length - 1]?.timeMs || firstEventTime);
    }

    finalizePlaybackFrameDelays(frames);
    submission._playbackCache = {
      eventSignature,
      frames,
    };
    return frames;
  }

  function getPlaybackEventSignature(events) {
    return events
      .map((event) => `${event?.timestamp || ""}:${event?.type || ""}:${event?.start ?? ""}:${event?.end ?? ""}:${String(event?.insertedText || "").length}:${String(event?.removedText || "").length}`)
      .join("|");
  }

  function createPlaybackFramePusher(frames, firstEventTime) {
    return (frameText, label, timeMs) => {
      frames.push({
        text: frameText,
        label,
        timeMs: Number.isFinite(timeMs) ? timeMs : (frames[frames.length - 1]?.timeMs || firstEventTime),
      });
    };
  }

  function applyPlaybackEvent({ event, eventTimeMs, intraEventDelayMs, text, fallbackText, pushFrame, clamp, titleCase, formatTime }) {
    if (!hasStructuredPlaybackOperation(event)) {
      pushFrame(fallbackText, `${titleCase(event.type)} • ${formatTime(event.timestamp)}`, eventTimeMs);
      return fallbackText;
    }

    let operationIndex = 0;
    if (event.removedText) {
      text = applyPlaybackDeletion({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, formatTime });
      operationIndex += 1;
    }
    if (!event.insertedText) {
      return text;
    }
    if (isPasteLikeWritingEvent(event)) {
      return applyPlaybackBulkInsert({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, formatTime });
    }
    return applyPlaybackCharacterInsertions({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, titleCase, formatTime });
  }

  function hasStructuredPlaybackOperation(event) {
    return typeof event.start === "number" && typeof event.end === "number";
  }

  function applyPlaybackDeletion({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, formatTime }) {
    const deleteStart = clamp(Number(event.start || 0), 0, text.length);
    const recordedEnd = Number(event.end);
    const fallbackEnd = deleteStart + String(event.removedText || "").length;
    const deleteEnd = clamp(Number.isFinite(recordedEnd) && recordedEnd > deleteStart ? recordedEnd : fallbackEnd, deleteStart, text.length);
    const nextText = text.slice(0, deleteStart) + text.slice(deleteEnd);
    pushFrame(nextText, `Deleted ${String(event.removedText || "").length} characters • ${formatTime(event.timestamp)}`, eventTimeMs + (operationIndex * intraEventDelayMs));
    return nextText;
  }

  function applyPlaybackBulkInsert({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, formatTime }) {
    const pasteStart = clamp(Number(event.start || 0), 0, text.length);
    const nextText = text.slice(0, pasteStart) + event.insertedText + text.slice(pasteStart);
    const label = event.type === "paste"
      ? `Pasted ${String(event.insertedText || "").length} characters`
      : `Bulk inserted ${String(event.insertedText || "").length} characters`;
    pushFrame(nextText, `${label} • ${formatTime(event.timestamp)}`, eventTimeMs + (operationIndex * intraEventDelayMs));
    return nextText;
  }

  function applyPlaybackCharacterInsertions({ event, text, eventTimeMs, operationIndex, intraEventDelayMs, pushFrame, clamp, titleCase, formatTime }) {
    let nextText = text;
    for (let index = 0; index < event.insertedText.length; index += 1) {
      const char = event.insertedText[index];
      const insertIndex = clamp(Number(event.start || 0) + index, 0, nextText.length);
      nextText = nextText.slice(0, insertIndex) + char + nextText.slice(insertIndex);
      pushFrame(nextText, `${titleCase(event.type)} • ${formatTime(event.timestamp)}`, eventTimeMs + ((operationIndex + index) * intraEventDelayMs));
    }
    return nextText;
  }

  const PlaybackRender = {
    renderPlaybackScreenOnly,
    getPlaybackSpeedMultiplier,
    getPlaybackFrameDelayMs,
    startPlayback,
    getEventTimeMs,
    isLargeSingleInsertEvent,
    isPasteLikeWritingEvent,
    countPlaybackOperations,
    getIntraEventDelayMs,
    finalizePlaybackFrameDelays,
    formatPlaybackDuration,
    formatPlaybackElapsedLabel,
    stepPlayback,
    syncPlaybackUi,
    updateDraftMeters,
    updateFinalMeters,
    updateTextContent,
    getPlaybackState,
    getPlaybackFrames,
  };

  if (typeof window !== "undefined") {
    window.PlaybackRender = PlaybackRender;
    Object.assign(window, PlaybackRender);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PlaybackRender;
  }
})();
