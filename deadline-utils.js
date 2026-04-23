(function initDeadlineUtils(global) {
  function getDeadlineDatePart(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  function getDeadlineTimePart(value) {
    return value && String(value).includes("T") ? String(value).slice(11, 16) : "";
  }

  function combineDeadlineParts(dateValue, timeValue) {
    return dateValue ? `${dateValue}T${timeValue || "09:00"}:00` : "";
  }

  function buildDeadlineTimeOptions(selectedValue) {
    const times = [
      "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
      "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
      "18:00", "19:00", "20:00", "21:00",
    ];
    return times.map((time) => {
      const [hour, minute] = time.split(":").map(Number);
      const display = new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      const selected = time === selectedValue ? "selected" : "";
      return `<option value="${time}" ${selected}>${display}</option>`;
    }).join("");
  }

  global.DeadlineUtils = {
    getDeadlineDatePart,
    getDeadlineTimePart,
    combineDeadlineParts,
    buildDeadlineTimeOptions,
  };
})(window);
