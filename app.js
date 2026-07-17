const THEME_KEY = "starlight-kasa-theme";
const DAY_NAMES = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];
const MONTH_NAMES = ["januar", "februar", "mart", "april", "maj", "juni", "juli", "avgust", "septembar", "oktobar", "novembar", "decembar"];
const PRODUCTS = [
  { key: "goldCircles", stockId: "stockGoldCircles", label: "Krugovi (zlatni)" },
  { key: "silverCircles", stockId: "stockSilverCircles", label: "Krugovi (srebreni)" },
  { key: "mamaNecklaces", stockId: "stockMamaNecklaces", label: "Mama ogrlice" },
  { key: "armyTags", stockId: "stockArmyTags", label: "Vojničke pločice" },
  { key: "eyeTags", stockId: "stockEyeTags", label: "Oči pločice" },
  { key: "bracelets", stockId: "stockBracelets", label: "Narukvice" }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const num = (value) => Number(value) || 0;
const dateISO = (date = new Date()) => date.toISOString().slice(0, 10);
const monthISO = (date = new Date()) => date.toISOString().slice(0, 7);
const money = (value) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(value)) + " KM";
const shortDate = (value) => {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}.`;
};
const safeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

let state = {
  openingBalance: 0,
  stock: {},
  entries: [],
  dark: localStorage.getItem(THEME_KEY) === "dark"
};
let requestPending = false;

function setSyncStatus(status, detail, error = false) {
  $("#syncStatus").textContent = status;
  $("#syncDetail").textContent = detail;
  $(".status-dot").classList.toggle("error", error);
}

function setRequestPending(pending) {
  requestPending = pending;
  $$("button[type='submit']").forEach((button) => {
    button.disabled = pending;
  });
}

async function apiRequest(body) {
  const response = await fetch("/api/state", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Baza trenutno nije dostupna.");
  }
  return data;
}

function applyRemoteState(data) {
  state.openingBalance = num(data.openingBalance);
  state.stock = normalizeStock(data.stock);
  state.entries = Array.isArray(data.entries) ? data.entries : [];
  renderAll();
  setSyncStatus("Podaci su sačuvani", "Neon cloud");
}

async function loadRemoteState() {
  setSyncStatus("Učitavanje podataka", "Neon cloud");
  try {
    applyRemoteState(await apiRequest());
  } catch (error) {
    setSyncStatus("Baza nije povezana", "Provjerite DATABASE_URL", true);
    showToast(error.message, true);
  }
}

async function persistAction(action, payload, message) {
  if (requestPending) return false;
  setRequestPending(true);
  setSyncStatus("Čuvanje podataka", "Neon cloud");
  try {
    applyRemoteState(await apiRequest({ action, ...payload }));
    if (message) showToast(message);
    return true;
  } catch (error) {
    setSyncStatus("Čuvanje nije uspjelo", "Pokušajte ponovo", true);
    showToast(error.message, true);
    return false;
  } finally {
    setRequestPending(false);
  }
}

function entryTotals(entry) {
  if (entry.kind === "quick") {
    return {
      income: entry.type === "plus" ? num(entry.amount) : 0,
      expense: entry.type === "minus" ? num(entry.amount) : 0,
      debt: 0
    };
  }
  if (entry.kind === "debt") {
    const amount = num(entry.amount);
    return {
      income: 0,
      expense: 0,
      debt: entry.type === "decrease" ? -amount : amount
    };
  }
  return {
    income: num(entry.income),
    expense: num(entry.otherExpenses) + num(entry.salary),
    debt: num(entry.workerDebt)
  };
}

function entryKindLabel(entry, short = false) {
  if (entry.kind === "quick") return short ? "Brzi" : "Brzi unos";
  if (entry.kind === "debt") return short ? "Dug" : "Korekcija duga";
  return short ? "Dnevni" : "Dnevni unos";
}

function debtDisplay(value) {
  if (!value) return "—";
  return `${value < 0 ? "−" : ""}${money(Math.abs(value))}`;
}

function normalizeStock(stock = {}) {
  return PRODUCTS.reduce((normalized, product) => {
    normalized[product.key] = Math.max(0, num(stock[product.key]));
    return normalized;
  }, {});
}

function totalStock(stock = state.stock) {
  return PRODUCTS.reduce((sum, product) => sum + num(stock[product.key]), 0);
}

function soldProducts(entries = state.entries) {
  return sortedEntries(entries).reduce((sold, entry) => {
    if (entry.kind === "daily") {
      PRODUCTS.forEach((product) => {
        sold[product.key] = num(sold[product.key]) + num(entry[product.key]);
      });
    }
    return sold;
  }, normalizeStock());
}

function sortedEntries(entries = state.entries) {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || num(a.createdAt) - num(b.createdAt));
}

function balanceThrough(entries) {
  return entries.reduce((balance, entry) => {
    const totals = entryTotals(entry);
    return balance + totals.income - totals.expense;
  }, state.openingBalance);
}

function description(entry) {
  if (entry.kind === "quick") return entry.note || (entry.type === "plus" ? "Dodatni prihod" : "Dodatni trošak");
  if (entry.kind === "debt") return entry.note || (entry.type === "decrease" ? "Smanjenje duga prema radniku" : "Povećanje duga prema radniku");
  return entry.note || "Dnevni unos";
}

function showView(id) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === id));
  const titles = {
    pregled: ["DNEVNI PREGLED", "Dobro došli"],
    unos: ["EVIDENCIJA", $("#entryId").value ? "Izmjena unosa" : "Novi unos"],
    evidencija: ["ARHIVA POSLOVANJA", "Evidencija"],
    roba: ["STANJE ROBE", "Roba"],
    izvjestaji: ["POSLOVNI REZULTATI", "Izvještaji"]
  };
  $("#pageEyebrow").textContent = titles[id][0];
  $("#pageTitle").textContent = titles[id][1];
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  document.body.classList.toggle("dark", state.dark);
  const entries = sortedEntries();
  const totals = entries.reduce((acc, entry) => {
    const values = entryTotals(entry);
    acc.income += values.income;
    acc.expense += values.expense;
    acc.debt += values.debt;
    acc.packages += num(entry.packages);
    if (values.income) acc.incomeCount += 1;
    if (values.expense) acc.expenseCount += 1;
    return acc;
  }, { income: 0, expense: 0, debt: 0, packages: 0, incomeCount: 0, expenseCount: 0 });
  const balance = state.openingBalance + totals.income - totals.expense;

  $("#currentBalance").textContent = money(balance);
  $("#currentBalance").classList.toggle("negative-text", balance < 0);
  $("#balanceStatus").textContent = balance < 0 ? "Upozorenje: kasa je u minusu" : entries.length ? `Početno stanje: ${money(state.openingBalance)}` : "Kasa je spremna za prvi unos";
  $("#totalIncome").textContent = money(totals.income);
  $("#totalExpenses").textContent = money(totals.expense);
  $("#totalDebt").textContent = money(totals.debt);
  $("#totalPackages").textContent = totals.packages;
  $("#totalStock").textContent = totalStock();
  $("#incomeCount").textContent = `${totals.incomeCount} evidentiranih uplata`;
  $("#expenseCount").textContent = `${totals.expenseCount} evidentiranih troškova`;
  $("#openingBalanceInput").value = state.openingBalance;

  renderRecent(entries);
  renderRecords();
  renderChart(entries);
  renderStock();
  renderReport();
}

function renderRecent(entries) {
  const latest = [...entries].reverse().slice(0, 5);
  $("#recentEmpty").classList.toggle("show", latest.length === 0);
  $("#recentRows").innerHTML = latest.map((entry) => {
    const totals = entryTotals(entry);
    const position = entries.findIndex((item) => item.id === entry.id);
    const balance = balanceThrough(entries.slice(0, position + 1));
    const change = totals.income - totals.expense;
    const isDebt = entry.kind === "debt";
    return `<tr>
      <td><strong>${shortDate(entry.date)}</strong><br><small>${DAY_NAMES[new Date(`${entry.date}T12:00:00`).getDay()]}</small></td>
      <td><span class="badge ${entry.kind === "quick" ? "quick" : entry.kind === "debt" ? "debt" : ""}">${entryKindLabel(entry)}</span></td>
      <td>${safeText(description(entry))}</td>
      <td>${num(entry.packages) || "—"}</td>
      <td class="${isDebt ? "" : change >= 0 ? "amount-plus" : "amount-minus"}">${isDebt ? "Bez promjene kase" : `${change >= 0 ? "+" : "−"}${money(Math.abs(change))}`}</td>
      <td><strong>${money(balance)}</strong></td>
    </tr>`;
  }).join("");
}

function filteredEntries() {
  const search = $("#searchInput").value.trim().toLowerCase();
  const from = $("#filterFrom").value;
  const to = $("#filterTo").value;
  return sortedEntries().filter((entry) =>
    (!search || description(entry).toLowerCase().includes(search)) &&
    (!from || entry.date >= from) &&
    (!to || entry.date <= to)
  ).reverse();
}

function renderRecords() {
  const entries = filteredEntries();
  $("#allEmpty").classList.toggle("show", entries.length === 0);
  $("#allRows").innerHTML = entries.map((entry) => {
    const totals = entryTotals(entry);
    return `<tr>
      <td><strong>${shortDate(entry.date)}</strong></td>
      <td><span class="badge ${entry.kind === "quick" ? "quick" : entry.kind === "debt" ? "debt" : ""}">${entryKindLabel(entry, true)}</span></td>
      <td>${safeText(description(entry))}</td>
      <td class="amount-plus">${totals.income ? money(totals.income) : "—"}</td>
      <td class="amount-minus">${totals.expense ? money(totals.expense) : "—"}</td>
      <td class="${totals.debt < 0 ? "amount-plus" : ""}">${debtDisplay(totals.debt)}</td>
      <td>${num(entry.packages) || "—"}</td>
      <td>${entry.kind === "daily" ? `<button class="action-button" data-edit="${entry.id}">Izmijeni</button>` : ""}<button class="action-button delete" data-delete="${entry.id}">Obriši</button></td>
    </tr>`;
  }).join("");
}

function renderChart(entries) {
  if (!entries.length) {
    $("#balanceChart").innerHTML = '<div class="chart-empty">Grafikon će se prikazati nakon prvog unosa.</div>';
    return;
  }
  const points = entries.map((entry, index) => ({ date: entry.date, balance: balanceThrough(entries.slice(0, index + 1)) })).slice(-7);
  const width = 650, height = 190, padX = 28, padY = 24;
  const values = points.map((point) => point.balance);
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const range = max - min || 1;
  const x = (index) => padX + (points.length === 1 ? (width - padX * 2) / 2 : index * (width - padX * 2) / (points.length - 1));
  const y = (value) => height - padY - ((value - min) / range) * (height - padY * 2);
  const coords = points.map((point, index) => `${x(index)},${y(point.balance)}`).join(" ");
  const area = `${x(0)},${height - padY} ${coords} ${x(points.length - 1)},${height - padY}`;
  const grid = [0, 1, 2, 3].map((step) => {
    const gy = padY + step * (height - padY * 2) / 3;
    return `<line class="grid-line" x1="${padX}" x2="${width - padX}" y1="${gy}" y2="${gy}" />`;
  }).join("");
  const labels = points.map((point, index) => `<text x="${x(index)}" y="${height - 4}" text-anchor="middle">${point.date.slice(5).split("-").reverse().join(".")}</text>`).join("");
  const dots = points.map((point, index) => `<circle class="dot" cx="${x(index)}" cy="${y(point.balance)}" r="4"><title>${shortDate(point.date)}: ${money(point.balance)}</title></circle>`).join("");
  $("#balanceChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8a96a" stop-opacity=".25"/><stop offset="1" stop-color="#c8a96a" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon class="area" points="${area}"/><polyline class="line" points="${coords}"/>${dots}${labels}
  </svg>`;
}

function renderReport() {
  const selectedMonth = $("#reportMonth").value || monthISO();
  const entries = sortedEntries().filter((entry) => entry.date.startsWith(selectedMonth));
  const totals = entries.reduce((acc, entry) => {
    const values = entryTotals(entry);
    acc.income += values.income;
    acc.expense += values.expense;
    acc.debt += values.debt;
    acc.packages += num(entry.packages);
    return acc;
  }, { income: 0, expense: 0, debt: 0, packages: 0 });
  const [year, month] = selectedMonth.split("-");
  $("#reportTitle").textContent = `${MONTH_NAMES[num(month) - 1]} ${year}.`;
  $("#reportOpening").textContent = money(state.openingBalance);
  $("#reportIncome").textContent = money(totals.income);
  $("#reportExpenses").textContent = money(totals.expense);
  $("#reportDebt").textContent = money(totals.debt);
  $("#reportResult").textContent = money(totals.income - totals.expense);
  $("#reportResult").className = totals.income - totals.expense < 0 ? "negative-text" : "positive-text";
  $("#reportEmpty").classList.toggle("show", entries.length === 0);
  $("#reportRows").innerHTML = entries.map((entry) => {
    const values = entryTotals(entry);
    return `<tr><td>${shortDate(entry.date)}</td><td>${safeText(description(entry))}</td><td class="amount-plus">${values.income ? money(values.income) : "—"}</td><td class="amount-minus">${values.expense ? money(values.expense) : "—"}</td><td class="${values.debt < 0 ? "amount-plus" : ""}">${debtDisplay(values.debt)}</td><td>${num(entry.packages) || "—"}</td></tr>`;
  }).join("");
}

function renderStock() {
  const stock = normalizeStock(state.stock);
  const sold = soldProducts();
  PRODUCTS.forEach((product) => {
    const input = document.getElementById(product.stockId);
    if (input && document.activeElement !== input) {
      input.value = stock[product.key];
    }
  });
  $("#stockRows").innerHTML = PRODUCTS.map((product) => `
    <tr>
      <td><strong>${product.label}</strong></td>
      <td>${num(stock[product.key])}</td>
      <td>${num(sold[product.key])}</td>
    </tr>
  `).join("");
}

function resetEntryForm() {
  $("#entryForm").reset();
  $("#entryId").value = "";
  $("#entryDate").value = dateISO();
  $("#entryFormTitle").textContent = "Novi dnevni unos";
}

function editEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry || entry.kind !== "daily") return;
  Object.entries(entry).forEach(([key, value]) => {
    const input = document.getElementById(key);
    if (input) input.value = value;
  });
  $("#entryId").value = id;
  $("#entryFormTitle").textContent = "Izmijeni dnevni unos";
  showView("unos");
}

function exportCSV() {
  const month = $("#reportMonth").value || monthISO();
  const entries = sortedEntries().filter((entry) => entry.date.startsWith(month));
  const rows = [["Datum", "Vrsta", "Opis", "Primljeno KM", "Troškovi KM", "Dug KM", "Broj paketa", "Vrijednost robe KM", "Zlatni krugovi", "Srebreni krugovi", "Mama ogrlice", "Vojničke pločice", "Oči pločice", "Narukvice"]];
  entries.forEach((entry) => {
    const totals = entryTotals(entry);
    rows.push([entry.date, entryKindLabel(entry), description(entry), totals.income, totals.expense, totals.debt, num(entry.packages), num(entry.goodsValue), num(entry.goldCircles), num(entry.silverCircles), num(entry.mamaNecklaces), num(entry.armyTags), num(entry.eyeTags), num(entry.bracelets)]);
  });
  const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `star-light-izvjestaj-${month}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV izvještaj je preuzet.");
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

$$(".nav-link").forEach((link) => link.addEventListener("click", () => showView(link.dataset.view)));
$$("[data-view-target]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));
$$("[data-open-entry]").forEach((button) => button.addEventListener("click", () => { resetEntryForm(); showView("unos"); }));
$("#menuButton").addEventListener("click", () => document.body.classList.toggle("menu-open"));
$("#themeButton").addEventListener("click", () => {
  state.dark = !state.dark;
  localStorage.setItem(THEME_KEY, state.dark ? "dark" : "light");
  renderAll();
});
$("#openingBalanceButton").addEventListener("click", () => $("#openingDialog").showModal());
$("#openingForm").addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const saved = await persistAction(
    "setOpeningBalance",
    { openingBalance: num($("#openingBalanceInput").value) },
    "Početno stanje je sačuvano."
  );
  if (saved) $("#openingDialog").close();
});

$("#stockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const stock = PRODUCTS.reduce((values, product) => {
    values[product.key] = num(document.getElementById(product.stockId).value);
    return values;
  }, {});
  await persistAction("setStock", { stock }, "Stanje robe je sačuvano.");
});

$("#quickForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID(), kind: "quick", type: new FormData(event.currentTarget).get("quickType"),
    amount: num($("#quickAmount").value), note: $("#quickNote").value.trim(), date: dateISO(), createdAt: Date.now()
  };
  const saved = await persistAction("saveEntry", { entry }, "Promjena kase je sačuvana.");
  if (saved) event.currentTarget.reset();
});

$("#debtForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID(),
    kind: "debt",
    type: new FormData(event.currentTarget).get("debtType"),
    amount: num($("#debtAmount").value),
    note: $("#debtNote").value.trim(),
    date: dateISO(),
    createdAt: Date.now()
  };
  const saved = await persistAction("saveEntry", { entry }, "Korekcija duga je sačuvana.");
  if (saved) event.currentTarget.reset();
});

$("#entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = ["income", "packages", "goodsValue", "goldCircles", "silverCircles", "mamaNecklaces", "armyTags", "eyeTags", "bracelets", "otherExpenses", "salary", "workerDebt", "note"];
  const entry = { id: $("#entryId").value || crypto.randomUUID(), kind: "daily", createdAt: Date.now() };
  entry.date = $("#entryDate").value;
  fields.forEach((field) => {
    const value = document.getElementById(field).value;
    entry[field] = field === "date" || field === "note" ? value.trim() : num(value);
  });
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    entry.createdAt = state.entries[index].createdAt;
  }
  const saved = await persistAction(
    "saveEntry",
    { entry },
    index >= 0 ? "Unos je izmijenjen." : "Dnevni unos je sačuvan."
  );
  if (saved) {
    resetEntryForm();
    showView("pregled");
  }
});

$("#cancelEdit").addEventListener("click", () => { resetEntryForm(); showView("pregled"); });
$("#searchInput").addEventListener("input", renderRecords);
$("#filterFrom").addEventListener("change", renderRecords);
$("#filterTo").addEventListener("change", renderRecords);
$("#clearFilters").addEventListener("click", () => {
  $("#searchInput").value = "";
  $("#filterFrom").value = "";
  $("#filterTo").value = "";
  renderRecords();
});
$("#allRows").addEventListener("click", async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  if (editId) editEntry(editId);
  if (deleteId && confirm("Da li sigurno želite obrisati ovaj unos?")) {
    await persistAction("deleteEntry", { id: deleteId }, "Unos je obrisan.");
  }
});
$("#reportMonth").addEventListener("change", renderReport);
$("#csvButton").addEventListener("click", exportCSV);
$("#printButton").addEventListener("click", () => window.print());

const today = new Date();
$("#todayLabel").textContent = `${DAY_NAMES[today.getDay()]}, ${today.getDate()}. ${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}.`;
$("#entryDate").value = dateISO();
$("#reportMonth").value = monthISO();
renderAll();
loadRemoteState();
