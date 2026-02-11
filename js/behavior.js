// behavior.js
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

async function initResearchIndex() {
  const container = document.querySelector("[data-research-index]");
  if (!container) return; // Not on research index page

  const source = container.dataset.source;
  if (!source) return;

  try {
    const res = await fetch(source);
    const data = await res.json();

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

document.addEventListener("DOMContentLoaded", initResearchIndex);