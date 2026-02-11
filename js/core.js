// core.js

function initHeaderAndMenu() {
  const header = document.getElementById("site-header");
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".nav-links");
  const links = document.querySelectorAll(".nav-links a");
  const body = document.body;

  // If header/nav doesn't exist, silently exit
  if (!header || !toggle || !nav) return;

  /* Sticky header */
  window.addEventListener("scroll", () => {
    if (window.scrollY > 250) {
      header.classList.add("visible");
    } else {
      header.classList.remove("visible");
    }
  });

  function closeMenu() {
    nav.classList.remove("open");
    body.classList.remove("menu-open");
  }

  toggle.addEventListener("click", () => {
    nav.classList.toggle("open");
    body.classList.toggle("menu-open");
  });

  links.forEach(link => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && body.classList.contains("menu-open")) {
      closeMenu();
    }
  });
}

// Boot
document.addEventListener("DOMContentLoaded", initHeaderAndMenu);