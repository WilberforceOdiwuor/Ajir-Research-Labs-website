// core.js

function initHeaderAndMenu() {
  const header = document.getElementById('site-header');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  const links = document.querySelectorAll('.nav-links a');
  const body = document.body;

  if (!header || !toggle || !nav) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 250) {
      header.classList.add('visible');
    } else {
      header.classList.remove('visible');
    }
  });

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

document.addEventListener('DOMContentLoaded', initHeaderAndMenu);
