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

    // 🔥 Sort newest first
    data.items.sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    // Clear container (prevents duplicates)
    container.innerHTML = "";

    // Render items
    data.items.forEach(item => {
      const article = document.createElement("article");
      article.className = "research-item";

      article.innerHTML = `
        <div class="research-meta">
          <span class="research-type">${item.type}</span>
          <span class="research-date">${formatDate(item.date)}</span>
        </div>

        <a href="${item.path}" class="research-link">
          <h2 class="research-title">${item.title}</h2>
          <p class="research-summary">${item.summary}</p>
        </a>
      `;

      container.appendChild(article);
    });

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