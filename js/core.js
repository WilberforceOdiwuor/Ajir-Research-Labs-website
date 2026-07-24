// core.js

function initHeaderAndMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  const links = document.querySelectorAll('.nav-links a');
  const body = document.body;

  if (!toggle || !nav) return;

  function closeMenu() {
    nav.classList.remove('open');
    body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    body.classList.toggle('menu-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  links.forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && body.classList.contains('menu-open')) {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeMenu();
    }
  });
}

function initHeaderScrollState() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  function syncHeaderScrollState() {
    header.classList.toggle('is-scrolled', window.scrollY > 120);
  }

  syncHeaderScrollState();
  window.addEventListener('scroll', syncHeaderScrollState, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
  initHeaderAndMenu();
  initHeaderScrollState();
});
