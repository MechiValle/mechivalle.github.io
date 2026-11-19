type Status = "idle" | "loaded" | "blocked";

const LABELS: Record<Status, string> = {
  idle: "Not loaded",
  loaded: "Loaded",
  blocked: "Blocked",
};

function requested(urlPart: string): boolean {
  return performance
    .getEntriesByType("resource")
    .some((entry) => entry.name.includes(urlPart));
}

// The autoblocker leaves inline snippets alone and blocks the script they
// inject (or a script tag with a src), marking it with data-uc-hash and
// type="text/plain". Manual markup (type="text/plain" on the snippet itself)
// is still recognised through `selector`.
function scriptStatus(selector: string, urlPart: string): Status {
  const el = document.querySelector<HTMLScriptElement>(selector);
  if (el?.type === "text/plain") return "blocked";
  const blocked = Array.from(
    document.querySelectorAll<HTMLScriptElement>(
      'script[data-uc-hash][type="text/plain"]',
    ),
  ).some((script) => script.getAttribute("src")?.includes(urlPart));
  if (blocked) return "blocked";
  return requested(urlPart) ? "loaded" : "idle";
}

// The autoblocker moves an iframe's src to data-uc-src until consent is given.
function frameStatus(selector: string): Status {
  const el = document.querySelector<HTMLIFrameElement>(selector);
  if (!el) return "idle";
  const src = el.getAttribute("src");
  return src && src !== "about:blank" ? "loaded" : "blocked";
}

const checks: Record<string, () => Status> = {
  ga4: () => scriptStatus("#ga4-loader", "/g/collect"),
  gtm: () => scriptStatus("#gtm-snippet", "googletagmanager.com/gtm.js"),
  "meta-pixel": () =>
    scriptStatus("#meta-pixel-snippet", "connect.facebook.net"),
  youtube: () => frameStatus("#youtube-frame"),
  maps: () => frameStatus("#maps-frame"),
  vimeo: () => frameStatus("#vimeo-frame"),
};

function renderStatus(): void {
  for (const [id, detect] of Object.entries(checks)) {
    const label = document.querySelector<HTMLElement>(`#${id} .status`);
    if (!label) continue;
    const status = detect();
    if (label.dataset.status === status) continue;
    label.dataset.status = status;
    label.textContent = LABELS[status];
  }
}

type Tone = "set" | "removed" | "info";

interface Entry {
  key: string;
  cells: string[];
}

interface StoredCookie {
  name: string;
  value?: string;
  domain?: string | null;
  path?: string;
  expires?: number | null;
  secure?: boolean;
  sameSite?: string;
}

interface CookieJar {
  getAll(): Promise<StoredCookie[]>;
  delete(options: {
    name: string;
    path?: string;
    domain?: string;
  }): Promise<void>;
}

const jar = (window as unknown as { cookieStore?: CookieJar }).cookieStore;

const LOG_LIMIT = 200;
const VALUE_LIMIT = 48;

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function logEvent(kind: string, detail: string, tone: Tone = "info"): void {
  const list = document.querySelector<HTMLOListElement>("#log");
  if (!list) return;
  const item = document.createElement("li");
  item.dataset.tone = tone;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("en-GB");
  const kindEl = document.createElement("span");
  kindEl.className = "kind";
  kindEl.textContent = kind;
  const detailEl = document.createElement("span");
  detailEl.className = "detail";
  detailEl.textContent = detail;
  item.append(time, kindEl, detailEl);
  list.prepend(item);
  while (list.children.length > LOG_LIMIT) list.lastElementChild?.remove();
  const count = document.querySelector<HTMLElement>('[data-count="log"]');
  if (count) count.textContent = String(list.children.length);
}

async function readCookies(): Promise<Entry[]> {
  if (jar) {
    const all = await jar.getAll();
    return all.map((c) => ({
      key: `${c.name}|${c.domain ?? ""}|${c.path ?? "/"}`,
      cells: [
        c.name,
        c.value ?? "",
        c.domain ?? location.hostname,
        c.path ?? "/",
        c.expires
          ? new Date(c.expires).toISOString().slice(0, 16).replace("T", " ")
          : "Session",
        c.secure ? "Yes" : "No",
        c.sameSite ?? "",
      ],
    }));
  }
  return document.cookie
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf("=");
      const name = index < 0 ? pair : pair.slice(0, index);
      const value = index < 0 ? "" : pair.slice(index + 1);
      return {
        key: name,
        cells: [name, value, location.hostname, "/", "", "", ""],
      };
    });
}

function readStorage(store: Storage): Entry[] {
  const rows: Entry[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === null) continue;
    rows.push({ key, cells: [key, store.getItem(key) ?? ""] });
  }
  return rows;
}

interface Panel {
  id: string;
  kind: string;
  columns: string[];
  read: () => Promise<Entry[]> | Entry[];
  previous: Map<string, { signature: string; label: string }> | null;
  signature: string;
}

const panels: Panel[] = [
  {
    id: "cookies",
    kind: "cookie",
    columns: [
      "Name",
      "Value",
      "Domain",
      "Path",
      "Expires",
      "Secure",
      "SameSite",
    ],
    read: readCookies,
    previous: null,
    signature: "",
  },
  {
    id: "local",
    kind: "localStorage",
    columns: ["Key", "Value"],
    read: () => readStorage(localStorage),
    previous: null,
    signature: "",
  },
  {
    id: "session",
    kind: "sessionStorage",
    columns: ["Key", "Value"],
    read: () => readStorage(sessionStorage),
    previous: null,
    signature: "",
  },
];

function renderTable(panel: Panel, entries: Entry[]): void {
  const container = document.querySelector<HTMLElement>(
    `[data-table="${panel.id}"]`,
  );
  const count = document.querySelector<HTMLElement>(
    `[data-count="${panel.id}"]`,
  );
  if (count) count.textContent = String(entries.length);
  if (!container) return;
  container.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Empty";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const column of panel.columns) {
    const th = document.createElement("th");
    th.textContent = column;
    head.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  for (const entry of entries) {
    const row = document.createElement("tr");
    for (const cell of entry.cells) {
      const td = document.createElement("td");
      td.textContent = shorten(cell, VALUE_LIMIT);
      td.title = cell;
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(thead, tbody);
  container.append(table);
}

function logDifferences(
  panel: Panel,
  next: Map<string, { signature: string; label: string }>,
): void {
  const previous = panel.previous;
  if (!previous) return;
  for (const [key, value] of next) {
    const before = previous.get(key);
    if (!before) logEvent(panel.kind, `added ${value.label}`, "set");
    else if (before.signature !== value.signature)
      logEvent(panel.kind, `changed ${value.label}`);
  }
  for (const [key, value] of previous) {
    if (!next.has(key))
      logEvent(panel.kind, `removed ${value.label}`, "removed");
  }
}

async function refreshPanel(panel: Panel): Promise<void> {
  const entries = await panel.read();
  const signature = JSON.stringify(entries);
  if (signature === panel.signature) return;
  const next = new Map(
    entries.map((entry) => [
      entry.key,
      { signature: entry.cells.join("\u0000"), label: entry.cells[0] },
    ]),
  );
  logDifferences(panel, next);
  panel.previous = next;
  panel.signature = signature;
  renderTable(panel, entries);
}

async function refreshAll(): Promise<void> {
  await Promise.all(panels.map(refreshPanel));
}

async function clearCookies(): Promise<void> {
  if (jar) {
    const all = await jar.getAll();
    await Promise.all(
      all.map((c) =>
        jar.delete({
          name: c.name,
          path: c.path,
          ...(c.domain ? { domain: c.domain } : {}),
        }),
      ),
    );
  } else {
    for (const pair of document.cookie.split("; ").filter(Boolean)) {
      const name = pair.split("=")[0];
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
  await refreshAll();
}

const actions: Record<string, () => Promise<void> | void> = {
  "clear-cookies": clearCookies,
  "clear-local": () => {
    localStorage.clear();
    return refreshAll();
  },
  "clear-session": () => {
    sessionStorage.clear();
    return refreshAll();
  },
  "clear-log": () => {
    document.querySelector("#log")?.replaceChildren();
    const count = document.querySelector<HTMLElement>('[data-count="log"]');
    if (count) count.textContent = "0";
  },
};

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  const run = target?.dataset.action
    ? actions[target.dataset.action]
    : undefined;
  if (run) void run();
});

function logRequest(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.host === location.host) return;
  logEvent("request", shorten(`${url.host}${url.pathname}`, 120));
}

const CONSENT_EVENTS = ["UC_UI_INITIALIZED", "UC_UI_CMP_EVENT", "ucConsent"];

for (const name of CONSENT_EVENTS) {
  window.addEventListener(name, (event) => {
    const detail =
      event instanceof CustomEvent && event.detail
        ? JSON.stringify(event.detail)
        : "";
    logEvent("consent", shorten(detail ? `${name} ${detail}` : name, 400));
  });
}

new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) logRequest(entry.name);
  renderStatus();
}).observe({ type: "resource", buffered: true });

new MutationObserver(() => renderStatus()).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src", "type"],
});

window.addEventListener("load", () => {
  renderStatus();
  void refreshAll();
});
window.addEventListener("focus", () => void refreshAll());
setInterval(() => void refreshAll(), 1000);

renderStatus();
void refreshAll();
