// behavior.js

/* ============================
   Utility: Format Date
============================ */

function formatDate(dateStr) {
  const date = new Date(dateStr);

  // Fallback protection
  if (isNaN(date)) return dateStr;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function isSafeResearchPath(path) {
  if (typeof path !== "string") return false;

  const trimmedPath = path.trim();
  if (!trimmedPath) return false;
  if (/^(?:[a-z]+:|\/\/|#)/i.test(trimmedPath)) return false;

  return /^(?:\.{1,2}\/)?(?:Research|legals)\//.test(trimmedPath);
}

function normalizeTag(tag) {
  if (typeof tag !== "string") return "all";

  const normalized = tag.trim().toLowerCase();
  return normalized || "all";
}

function createResearchItem(item) {
  const article = document.createElement("article");
  article.className = "research-item";

  const meta = document.createElement("div");
  meta.className = "research-meta";

  const type = document.createElement("span");
  type.className = "research-type";
  type.textContent = item.type || "";

  const date = document.createElement("span");
  date.className = "research-date";
  date.textContent = formatDate(item.date);

  meta.append(type, date);

  const link = document.createElement("a");
  link.className = "research-link";
  link.href = isSafeResearchPath(item.path) ? item.path : "./index.html";

  const title = document.createElement("h2");
  title.className = "research-title";
  title.textContent = item.title || "";

  const summary = document.createElement("p");
  summary.className = "research-summary";
  summary.textContent = item.summary || "";

  link.append(title, summary);
  article.append(meta, link);

  return article;
}

function setActiveFilter(buttons, activeTag) {
  buttons.forEach(button => {
    const isActive = normalizeTag(button.dataset.tag) === activeTag;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderResearchItems(container, items) {
  container.replaceChildren();

  items.forEach(item => {
    container.appendChild(createResearchItem(item));
  });
}

function updateResearchUrl(activeTag) {
  const url = new URL(window.location.href);

  if (activeTag === "all") {
    url.searchParams.delete("tag");
  } else {
    url.searchParams.set("tag", activeTag);
  }

  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function initResearchFilters(container, items) {
  const buttons = Array.from(document.querySelectorAll("[data-tag]"));
  if (!buttons.length) {
    renderResearchItems(container, items);
    return;
  }

  const validTags = new Set(buttons.map(button => normalizeTag(button.dataset.tag)));
  const requestedTag = normalizeTag(new URLSearchParams(window.location.search).get("tag"));
  const initialTag = validTags.has(requestedTag) ? requestedTag : "all";

  function applyFilter(activeTag, shouldUpdateUrl = true) {
    const filteredItems = activeTag === "all"
      ? items
      : items.filter(item => normalizeTag(item.type) === activeTag);

    setActiveFilter(buttons, activeTag);
    renderResearchItems(container, filteredItems);

    if (shouldUpdateUrl) {
      updateResearchUrl(activeTag);
    }
  }

  buttons.forEach(button => {
    button.type = "button";
    button.addEventListener("click", () => {
      applyFilter(normalizeTag(button.dataset.tag));
    });
  });

  applyFilter(initialTag, false);
}


/* ============================
   Research Index Loader
============================ */

async function initResearchIndex() {
  const container = document.querySelector("[data-research-index]");
  if (!container) return; // Not on research page

  const source = container.dataset.source;
  if (!source) return;

  try {
    const res = await fetch(source);

    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }

    const data = await res.json();

    if (!data.items || !Array.isArray(data.items)) {
      console.warn("Invalid research JSON structure.");
      return;
    }

    const items = [...data.items].sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    initResearchFilters(container, items);
  } catch (err) {
    console.error("Failed to load research index:", err);
  }
}


/* ============================
   Initialize on Load
============================ */

document.addEventListener("DOMContentLoaded", () => {
  initResearchIndex();
});
