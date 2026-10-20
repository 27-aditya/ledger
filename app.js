const LOCAL_KEY = "ledger:data:v1";

const CATEGORIES = [
  { name: "Food", color: "oklch(0.74 0.15 65)" },
  { name: "Transport", color: "oklch(0.62 0.16 250)" },
  { name: "Shopping", color: "oklch(0.66 0.2 350)" },
  { name: "Bills", color: "oklch(0.68 0.11 215)" },
  { name: "Entertainment", color: "oklch(0.6 0.2 305)" },
  { name: "Health", color: "oklch(0.6 0.19 25)" },
  { name: "Other", color: "oklch(0.6 0.012 265)" },
];

const RANGE_LABELS = { all: "All time", month: "This month", week: "Last 7 days" };

const ICON_PENCIL =
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

const state = { range: "all", category: "", editing: null };
let expenses = [];

const $ = (id) => document.getElementById(id);
const colorFor = (name) =>
  (CATEGORIES.find((c) => c.name === name) || {}).color || "oklch(0.6 0.012 265)";
const money = (n) =>
  "₹" +
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function animateValue(el, from, to, duration, fmt) {
  const token = (el._animToken = (el._animToken || 0) + 1);
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  function tick(now) {
    if (el._animToken !== token) return;
    const t = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
const todayKey = () => toKey(new Date());
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function rangeStartKey(range) {
  const now = new Date();
  if (range === "month") return toKey(new Date(now.getFullYear(), now.getMonth(), 1));
  if (range === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return toKey(d);
  }
  return null;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------- storage (local) ------------------------------- */

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(expenses));
}

/* ------------------------------- rendering ------------------------------- */

function currentRows() {
  const start = rangeStartKey(state.range);
  return expenses
    .filter((e) => (!start || e.date >= start))
    .filter((e) => (!state.category || e.category === state.category))
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.id).localeCompare(String(a.id))
    );
}

function render() {
  const rows = currentRows();
  renderHero(rows);
  renderWidgets(rows);
  renderDonut(rows);
  renderStats(rows);
  renderList(rows);
  renderTrend();
}

function renderHero(rows) {
  const total = rows.reduce((s, e) => s + e.amount, 0);
  $("hero-range").textContent = RANGE_LABELS[state.range];
  const el = $("hero-total");
  animateValue(el, el._val ?? 0, total, 900, money);
  el._val = total;
  $("hero-sub").textContent = `${rows.length} transaction${rows.length === 1 ? "" : "s"}`;
}

function renderWidgets(rows) {
  const monthTotal = expenses
    .filter((e) => e.date.slice(0, 7) === todayKey().slice(0, 7))
    .reduce((s, e) => s + e.amount, 0);
  const weekStart = rangeStartKey("week");
  const weekTotal = expenses
    .filter((e) => e.date >= weekStart)
    .reduce((s, e) => s + e.amount, 0);

  const byCat = {};
  for (const e of rows) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const avg = rows.length ? total / rows.length : 0;

  $("stat-month").textContent = money(monthTotal);
  $("stat-week").textContent = money(weekTotal);
  $("stat-top").textContent = top ? top[0] : "—";
  $("stat-avg").textContent = money(avg);
}

function categoryTotals(rows) {
  const byCat = {};
  for (const e of rows) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  return Object.entries(byCat).sort((a, b) => b[1] - a[1]);
}

function renderDonut(rows) {
  const entries = categoryTotals(rows);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const container = $("donut");

  if (!total) {
    container.innerHTML = `<div class="donut-svg"></div>`;
    container.style.visibility = "hidden";
    return;
  }
  container.style.visibility = "visible";

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 66;
  const sw = 20;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const segs = entries
    .map(([name, val]) => {
      const len = (val / total) * circ;
      const gap = Math.max(circ - len, 0.6);
      const seg = `<circle class="donut-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colorFor(
        name
      )}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(
        2
      )}"><title>${name}: ${money(val)}</title></circle>`;
      offset += len;
      return seg;
    })
    .join("");

  container.innerHTML = `
    <svg class="donut-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category">
      <g transform="rotate(-90 ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="${sw}"/>
        ${segs}
      </g>
    </svg>
    <div class="donut-center">
      <span class="donut-total">${money(total)}</span>
      <span class="donut-caption">total</span>
    </div>`;
}

function renderStats(rows) {
  const entries = categoryTotals(rows);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const container = $("stats");

  if (!entries.length) {
    container.innerHTML = `<p class="empty">No data for this range.</p>`;
    return;
  }

  const max = entries[0][1];
  container.innerHTML = entries
    .map(([name, amt]) => {
      const bar = max ? (amt / max) * 100 : 0;
      const share = total ? Math.round((amt / total) * 100) : 0;
      const color = colorFor(name);
      return `
        <div class="stat-row">
          <div class="stat-head">
            <span class="stat-name"><span class="dot" style="background:${color}"></span>${name}</span>
            <span class="stat-amt"><span class="muted">${share}%</span>${money(amt)}</span>
          </div>
          <div class="bar"><span style="width:${bar}%;background:${color}"></span></div>
        </div>`;
    })
    .join("");
}

function renderList(rows) {
  const list = $("expense-list");
  list.innerHTML = rows.map(renderRow).join("");
  $("empty-state").style.display = rows.length ? "none" : "flex";
}

function renderRow(e) {
  const color = colorFor(e.category);

  if (String(e.id) === String(state.editing)) {
    return `
      <li class="list-row editing" data-id="${e.id}">
        <div class="edit-grid">
          <label class="edit-field">
            <span>Amount</span>
            <input class="edit-amount" type="number" step="0.01" min="0.01" inputmode="decimal" value="${e.amount}">
          </label>
          <label class="edit-field">
            <span>Category</span>
            <select class="edit-category">
              ${CATEGORIES.map(
                (c) =>
                  `<option value="${c.name}"${c.name === e.category ? " selected" : ""}>${c.name}</option>`
              ).join("")}
            </select>
          </label>
          <label class="edit-field">
            <span>Note</span>
            <input class="edit-note" type="text" maxlength="80" value="${escapeHtml(e.description || "")}">
          </label>
          <label class="edit-field">
            <span>Date</span>
            <input class="edit-date" type="date" value="${e.date}">
          </label>
        </div>
        <div class="edit-actions">
          <button class="btn edit-cancel">Cancel</button>
          <button class="btn filled compact edit-save">Save</button>
        </div>
      </li>`;
  }

  const label = e.description ? escapeHtml(e.description) : e.category;
  return `
    <li class="list-row">
      <span class="cat-badge" style="background:color-mix(in oklch, ${color}, transparent 86%);color:${color}">${e.category[0]}</span>
      <div class="row-text">
        <span class="row-title">${label}</span>
        <span class="row-sub">${e.category} · ${formatDate(e.date)}</span>
      </div>
      <span class="row-amount">${money(e.amount)}</span>
      <div class="row-actions">
        <button class="icon-btn row-edit" data-id="${e.id}" aria-label="Edit">${ICON_PENCIL}</button>
        <button class="icon-btn row-delete" data-id="${e.id}" aria-label="Delete">×</button>
      </div>
    </li>`;
}

function renderTrend() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: "short" }), total: 0 });
  }
  const byKey = Object.fromEntries(months.map((m) => [m.key, m]));
  for (const e of expenses) {
    const k = e.date.slice(0, 7);
    if (byKey[k]) byKey[k].total += e.amount;
  }

  const W = 600;
  const H = 150;
  const padX = 10;
  const padTop = 14;
  const padBottom = 14;
  const n = months.length;
  const max = Math.max(...months.map((m) => m.total), 1);
  const xAt = (i) => padX + (i / (n - 1)) * (W - padX * 2);
  const yAt = (v) => H - padBottom - (v / max) * (H - padTop - padBottom);

  const pts = months.map((m, i) => ({ x: xAt(i), y: yAt(m.total) }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area =
    `M${pts[0].x.toFixed(1)} ${H} ` +
    pts.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
    ` L${pts[n - 1].x.toFixed(1)} ${H} Z`;
  const dots = pts
    .map(
      (p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--surface)" stroke="var(--accent-bright)" stroke-width="2" style="animation-delay:${(0.8 + i * 0.08).toFixed(2)}s"/>`
    )
    .join("");

  $("trend").innerHTML = `
    <svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spending trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-bright)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--accent-bright)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#trendFill)"/>
      <path class="trend-line" d="${line}" fill="none" stroke="var(--accent-bright)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="trend-dots">${dots}</g>
    </svg>
    <div class="trend-labels">
      ${months
        .map((m, i) => `<span${i === n - 1 ? ' class="trend-now"' : ""}>${m.label}</span>`)
        .join("")}
    </div>`;

  const linePath = $("trend").querySelector(".trend-line");
  if (linePath && linePath.getTotalLength) {
    linePath.style.setProperty("--len", linePath.getTotalLength());
  }

  const thisM = months[n - 1].total;
  const lastM = months[n - 2] ? months[n - 2].total : 0;
  const deltaEl = $("trend-delta");
  if (lastM > 0) {
    const pct = ((thisM - lastM) / lastM) * 100;
    const up = pct >= 0;
    deltaEl.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`;
    deltaEl.dataset.dir = up ? "up" : "down";
  } else {
    deltaEl.textContent = "—";
    delete deltaEl.dataset.dir;
  }
}

/* ------------------------------- actions ------------------------------- */

function addExpense(evt) {
  evt.preventDefault();
  const amount = parseFloat($("amount").value);
  if (!(amount > 0)) return;

  expenses.push({
    id: uuid(),
    amount,
    category: $("category").value,
    description: $("description").value.trim(),
    date: $("date").value,
  });
  saveLocal();
  state.editing = null;
  $("amount").value = "";
  $("description").value = "";
  $("amount").focus();
  render();
}

function saveEdit(id, li) {
  const amount = parseFloat(li.querySelector(".edit-amount").value);
  if (!(amount > 0)) {
    showToast("Enter a valid amount", true);
    return;
  }
  const idx = expenses.findIndex((e) => String(e.id) === String(id));
  if (idx === -1) return;

  expenses[idx] = {
    ...expenses[idx],
    amount,
    category: li.querySelector(".edit-category").value,
    description: li.querySelector(".edit-note").value.trim(),
    date: li.querySelector(".edit-date").value,
  };
  state.editing = null;
  saveLocal();
  render();
  showToast("Saved");
}

function removeExpense(id) {
  const before = expenses.length;
  expenses = expenses.filter((e) => String(e.id) !== String(id));
  if (expenses.length === before) return;
  saveLocal();
  render();
}

function clearAll() {
  if (!expenses.length) return;
  if (!confirm("Delete all expenses? This cannot be undone.")) return;
  expenses = [];
  saveLocal();
  render();
  showToast("All expenses deleted");
}

/* ------------------------------- exports ------------------------------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportCSV() {
  if (!expenses.length) return showToast("Nothing to export yet", true);
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Category", "Description", "Amount"].join(",")];
  for (const e of [...expenses].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    lines.push([e.date, e.category, e.description || "", e.amount.toFixed(2)].map(esc).join(","));
  }
  download(`ledger-${stamp()}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

function exportJSON() {
  if (!expenses.length) return showToast("Nothing to export yet", true);
  download(`ledger-${stamp()}.json`, JSON.stringify(expenses, null, 2), "application/json");
}

/* ------------------------------- ui helpers ------------------------------- */

function populateSelects() {
  $("category").innerHTML = CATEGORIES.map(
    (c) => `<option value="${c.name}">${c.name}</option>`
  ).join("");
  $("category-filter").innerHTML =
    `<option value="">All categories</option>` +
    CATEGORIES.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
}

let toastTimer;
function showToast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

/* ------------------------------- init ------------------------------- */

function bindEvents() {
  $("expense-form").addEventListener("submit", addExpense);

  $("expense-list").addEventListener("click", (e) => {
    const edit = e.target.closest(".row-edit");
    if (edit) {
      state.editing = edit.dataset.id;
      render();
      const input = document.querySelector(".list-row.editing .edit-amount");
      if (input) input.focus();
      return;
    }
    const del = e.target.closest(".row-delete");
    if (del) return removeExpense(del.dataset.id);

    const cancel = e.target.closest(".edit-cancel");
    if (cancel) {
      state.editing = null;
      render();
      return;
    }
    const save = e.target.closest(".edit-save");
    if (save) {
      const li = save.closest(".list-row");
      saveEdit(li.dataset.id, li);
    }
  });

  $("expense-list").addEventListener("keydown", (e) => {
    const li = e.target.closest(".list-row.editing");
    if (!li) return;
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(li.dataset.id, li);
    } else if (e.key === "Escape") {
      state.editing = null;
      render();
    }
  });

  $("category-filter").addEventListener("change", (e) => {
    state.category = e.target.value;
    render();
  });

  $("range-control").addEventListener("click", (e) => {
    const seg = e.target.closest(".seg");
    if (!seg) return;
    state.range = seg.dataset.range;
    document
      .querySelectorAll("#range-control .seg")
      .forEach((s) => {
        const active = s === seg;
        s.classList.toggle("is-active", active);
        s.setAttribute("aria-selected", active ? "true" : "false");
      });
    render();
  });

  $("export-csv").addEventListener("click", exportCSV);
  $("export-json").addEventListener("click", exportJSON);
  $("clear-all").addEventListener("click", clearAll);
}

function init() {
  populateSelects();
  $("date").value = todayKey();
  expenses = readLocal();
  bindEvents();
  render();
}

document.addEventListener("DOMContentLoaded", init);
