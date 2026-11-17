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

function scriptStatus(selector: string, urlPart: string): Status {
  const el = document.querySelector<HTMLScriptElement>(selector);
  if (!el) return "idle";
  if (el.type === "text/plain") return "blocked";
  return requested(urlPart) ? "loaded" : "idle";
}

function frameStatus(selector: string): Status {
  const el = document.querySelector<HTMLIFrameElement>(selector);
  if (!el) return "idle";
  return el.getAttribute("src") ? "loaded" : "blocked";
}

const checks: Record<string, () => Status> = {
  ga4: () => scriptStatus("#ga4-loader", "googletagmanager.com/gtag/js"),
  gtm: () => scriptStatus("#gtm-snippet", "googletagmanager.com/gtm.js"),
  "meta-pixel": () =>
    scriptStatus("#meta-pixel-snippet", "connect.facebook.net"),
  youtube: () => frameStatus("#youtube-frame"),
  maps: () => frameStatus("#maps-frame"),
  vimeo: () => frameStatus("#vimeo-frame"),
};

function render(): void {
  for (const [id, detect] of Object.entries(checks)) {
    const label = document.querySelector<HTMLElement>(`#${id} .status`);
    if (!label) continue;
    const status = detect();
    if (label.dataset.status === status) continue;
    label.dataset.status = status;
    label.textContent = LABELS[status];
  }
}

render();
window.addEventListener("load", render);
new PerformanceObserver(() => render()).observe({
  type: "resource",
  buffered: true,
});
new MutationObserver(() => render()).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src", "type"],
});
