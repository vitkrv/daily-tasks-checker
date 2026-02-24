const STORAGE_KEY = "daily-tasks-checker-v1";
const MAX_VISIBLE_DAYS = 30;
const INITIAL_VISIBLE_PAST_DAYS = 3;

const state = loadState();

const tablePanel = document.getElementById("table-panel");
const modal = document.getElementById("task-modal");
const openModalBtn = document.getElementById("open-modal");
const cancelModalBtn = document.getElementById("cancel-modal");
const taskForm = document.getElementById("task-form");
const taskNameInput = document.getElementById("task-name");
const taskEmojiInput = document.getElementById("task-emoji");
const formError = document.getElementById("form-error");
const notification = document.getElementById("top-notification");
const toggleViewModeBtn = document.getElementById("toggle-view-mode");

const fullModeIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3H5a2 2 0 0 0-2 2v4h2V5h4zm10 0h-4v2h4v4h2V5a2 2 0 0 0-2-2M5 15H3v4a2 2 0 0 0 2 2h4v-2H5zm16 0h-2v4h-4v2h4a2 2 0 0 0 2-2z"/></svg>';
const focusedModeIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 10V3h2v5h5v2zm-4 0H3V8h5V3h2zm4 4h7v2h-5v5h-2zm-4 0v7H8v-5H3v-2z"/></svg>';

let viewMode = "focused";
let notificationTimer;

ensureTodayEntry();
render();
registerServiceWorker();
updateViewModeButton();

openModalBtn.addEventListener("click", () => {
  modal.classList.remove("hidden");
  taskNameInput.focus();
});

cancelModalBtn.addEventListener("click", closeModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = taskNameInput.value.trim();
  const emoji = taskEmojiInput.value.trim();

  if (!name) {
    formError.textContent = "Please enter full routine name.";
    return;
  }

  if (!isSingleEmoji(emoji)) {
    formError.textContent = "Emoji field must contain a valid emoji.";
    return;
  }

  const task = {
    id: crypto.randomUUID(),
    name,
    emoji,
  };

  state.tasks.push(task);
  persistState();
  render();
  closeModal();
});

toggleViewModeBtn.addEventListener("click", () => {
  viewMode = viewMode === "focused" ? "full" : "focused";
  tablePanel.classList.toggle("mode-full", viewMode === "full");
  updateViewModeButton();
});

function updateViewModeButton() {
  toggleViewModeBtn.innerHTML = viewMode === "full" ? fullModeIcon : focusedModeIcon;
  toggleViewModeBtn.setAttribute("aria-label", `View mode: ${viewMode}`);
}

function closeModal() {
  modal.classList.add("hidden");
  taskForm.reset();
  formError.textContent = "";
}

function isSingleEmoji(value) {
  if (!value) return false;

  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(
    (segment) => segment.segment,
  );

  if (segments.length !== 1) return false;
  return /\p{Extended_Pictographic}/u.test(segments[0]);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: [], entries: {} };
    const parsed = JSON.parse(raw);

    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return { tasks: [], entries: {} };
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dateKey(offset = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

function prettyDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ensureTodayEntry() {
  const today = dateKey(0);
  if (!state.entries[today]) {
    state.entries[today] = {};
    persistState();
  }
}

function getVisibleDateKeys() {
  return Array.from({ length: MAX_VISIBLE_DAYS }, (_, index) => dateKey(MAX_VISIBLE_DAYS - 1 - index));
}

function toggleTask(date, taskId) {
  if (!state.entries[date]) state.entries[date] = {};
  state.entries[date][taskId] = !state.entries[date][taskId];
  persistState();
  render();
}

function render() {
  const dates = getVisibleDateKeys();
  const today = dateKey(0);

  const headers = state.tasks
    .map((task) => `<th data-name="${escapeHtml(task.name)}" title="Tap to view full name">${escapeHtml(task.emoji)}</th>`)
    .join("");

  const rows = dates
    .map((date, index) => {
      const isToday = date === today;
      const daysBeforeToday = Math.max(0, dates.length - 1 - index);
      const opacity = getRowOpacity(daysBeforeToday);
      const cells = state.tasks
        .map((task) => {
          const checked = Boolean(state.entries[date]?.[task.id]);
          const classes = ["routine-cell"];
          if (checked) classes.push("checked");

          return `<td class="${classes.join(" ")}" data-date="${date}" data-task-id="${task.id}" aria-label="${escapeHtml(task.name)} ${checked ? "checked" : "unchecked"}">${checked ? "✓" : ""}</td>`;
        })
        .join("");

      return `<tr class="${isToday ? "today" : "past"}" style="opacity:${opacity.toFixed(2)}"><td class="date-col">${prettyDate(date)}</td>${cells}</tr>`;
    })
    .join("");

  tablePanel.innerHTML = `
    <table>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <th class="date-col"></th>
          ${headers}
        </tr>
      </tfoot>
    </table>
  `;

  tablePanel.querySelectorAll("td.routine-cell").forEach((cell) => {
    const row = cell.closest("tr");
    if (row.classList.contains("past")) return;

    cell.addEventListener("click", () => {
      toggleTask(cell.dataset.date, cell.dataset.taskId);
    });
  });

  tablePanel.querySelectorAll("tfoot th[data-name]").forEach((header) => {
    header.addEventListener("click", () => {
      showNotification(header.dataset.name);
    });
  });

  const rowHeight = 56;
  tablePanel.scrollTop = Math.max(0, tablePanel.scrollHeight - rowHeight * (INITIAL_VISIBLE_PAST_DAYS + 1));
}

function showNotification(text) {
  clearTimeout(notificationTimer);
  notification.textContent = text;
  notification.classList.remove("hidden");

  notificationTimer = setTimeout(() => {
    notification.classList.add("hidden");
  }, 4000);
}

function getRowOpacity(daysBeforeToday) {
  if (daysBeforeToday <= 0) return 1;
  if (daysBeforeToday === 1) return 0.8;
  if (daysBeforeToday === 2) return 0.5;
  if (daysBeforeToday === 3) return 0.2;
  return 0;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // best effort only
    });
  }
}
