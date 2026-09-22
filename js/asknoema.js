// asknoema.js
// AskNoema product page only. No inline script — the page CSP is script-src 'self'.

/* ============================
   Workflow pipeline
============================ */

// The camera frames the active node: the scene zooms a little and slides
// the node toward the middle, so the stage you are reading about is the
// thing in focus and the rest of the graph falls back, blurred.
//
// The pan is then clamped against the graph's own bounding box, so however
// far the camera leans, no node or label is ever pushed out of the frame.
const AN_ZOOM = 1.12;
const AN_PAN = 0.45;

function anClamp(value, min, max) {
  // A scene larger than the frame has no valid resting place; centre it.
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function anBuildCamera(svg, scene) {
  const box = (svg.getAttribute("viewBox") || "0 0 480 340").split(/[\s,]+/).map(Number);
  const [viewX, viewY, viewW, viewH] = box;
  const midX = viewX + viewW / 2;
  const midY = viewY + viewH / 2;

  let bounds = null;
  try {
    const measured = scene.getBBox();
    if (measured && measured.width > 0 && measured.height > 0) bounds = measured;
  } catch (err) {
    bounds = null;
  }

  return function frame(node) {
    if (!node) {
      scene.setAttribute("transform", "translate(0 0) scale(1)");
      return;
    }
    const cx = Number(node.dataset.cx);
    const cy = Number(node.dataset.cy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const toX = cx + (midX - cx) * AN_PAN;
    const toY = cy + (midY - cy) * AN_PAN;

    let tx = toX - AN_ZOOM * cx;
    let ty = toY - AN_ZOOM * cy;

    if (bounds) {
      tx = anClamp(tx, viewX - AN_ZOOM * bounds.x, viewX + viewW - AN_ZOOM * (bounds.x + bounds.width));
      ty = anClamp(ty, viewY - AN_ZOOM * bounds.y, viewY + viewH - AN_ZOOM * (bounds.y + bounds.height));
    }

    scene.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${AN_ZOOM})`);
  };
}

function anBuildProgress(host, count, onJump) {
  const dots = [];
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement("span");
    host.appendChild(dot);
    dots.push(dot);
  }
  host.addEventListener("click", event => {
    const index = dots.indexOf(event.target);
    if (index >= 0) onJump(index);
  });
  return dots;
}

function anInitPipeline() {
  const pipeline = document.querySelector("[data-pipeline]");
  if (!pipeline) return;

  const svg = pipeline.querySelector("[data-pipeline-svg]");
  const scene = pipeline.querySelector("[data-pipeline-scene]");
  const nodes = Array.from(pipeline.querySelectorAll("[data-node]"));
  const bonds = Array.from(pipeline.querySelectorAll("[data-bond]"));
  const stages = Array.from(pipeline.querySelectorAll("[data-stage]"));
  const counter = pipeline.querySelector("[data-pipeline-counter]");
  const prevBtn = pipeline.querySelector("[data-pipeline-prev]");
  const nextBtn = pipeline.querySelector("[data-pipeline-next]");
  const progressHost = pipeline.querySelector("[data-pipeline-progress]");
  const live = pipeline.querySelector("[data-pipeline-live]");

  if (!svg || !scene || !nodes.length || nodes.length !== stages.length) return;

  // The sequence is the order the stages are authored in.
  const order = stages.map(stage => stage.dataset.stage);
  const byId = new Map(nodes.map(node => [node.dataset.node, node]));

  const frame = anBuildCamera(svg, scene);
  const dots = progressHost ? anBuildProgress(progressHost, order.length, jump) : [];

  let current = 0;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function render() {
    const activeId = order[current];
    const nextId = order[current + 1];

    stages.forEach((stage, i) => {
      stage.classList.toggle("is-active", i === current);
    });

    nodes.forEach(node => {
      const id = node.dataset.node;
      node.classList.toggle("is-active", id === activeId);
      node.classList.toggle("is-next", id === nextId);
      node.classList.toggle("is-dim", id !== activeId && id !== nextId);
      node.setAttribute("aria-pressed", String(id === activeId));
    });

    // The bonds that carry you forward are the ones that pulse. Not every
    // consecutive pair is directly bonded — the artwork has no sonar-synthesis
    // link, for instance, because that evidence travels back through the
    // record — so where there is no direct bond, the two-step path is hinted
    // instead and the trail stays unbroken.
    const hinted = new Set();
    if (nextId) {
      const joins = (bond, x, y) =>
        (bond.dataset.a === x && bond.dataset.b === y) ||
        (bond.dataset.b === x && bond.dataset.a === y);

      const direct = bonds.find(bond => joins(bond, activeId, nextId));
      if (direct) {
        hinted.add(direct);
      } else {
        // Several nodes may bridge the two. Take the geometrically shortest
        // detour rather than whichever happens to be first in the markup —
        // that is both stable and the one a reader's eye would follow.
        const span = (from, to) => {
          const a = byId.get(from);
          const b = byId.get(to);
          if (!a || !b) return Infinity;
          return Math.hypot(
            Number(a.dataset.cx) - Number(b.dataset.cx),
            Number(a.dataset.cy) - Number(b.dataset.cy)
          );
        };

        const from = bonds.filter(b => b.dataset.a === activeId || b.dataset.b === activeId);
        const to = bonds.filter(b => b.dataset.a === nextId || b.dataset.b === nextId);

        let best = null;
        for (const first of from) {
          const via = first.dataset.a === activeId ? first.dataset.b : first.dataset.a;
          const second = to.find(b => b.dataset.a === via || b.dataset.b === via);
          if (!second) continue;
          const length = span(activeId, via) + span(via, nextId);
          if (!best || length < best.length) best = { first, second, length };
        }

        if (best) {
          hinted.add(best.first);
          hinted.add(best.second);
        }
      }
    }

    bonds.forEach(bond => {
      const touchesActive = bond.dataset.a === activeId || bond.dataset.b === activeId;
      const isHint = hinted.has(bond);
      bond.classList.toggle("is-lit", touchesActive && !isHint);
      bond.classList.toggle("is-hint", isHint);
    });

    dots.forEach((dot, i) => dot.classList.toggle("is-on", i <= current));

    if (counter) counter.textContent = `${pad(current + 1)} / ${pad(order.length)}`;
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = current === order.length - 1;

    frame(byId.get(activeId));

    if (live) {
      const title = stages[current].querySelector(".an-stage__title");
      live.textContent = `Stage ${current + 1} of ${order.length}: ${title ? title.textContent : activeId}`;
    }
  }

  function jump(index) {
    if (index < 0 || index >= order.length || index === current) return;
    current = index;
    render();
  }

  nodes.forEach(node => {
    const index = order.indexOf(node.dataset.node);
    if (index < 0) return;

    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");

    node.addEventListener("click", () => jump(index));
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        jump(index);
      }
    });
  });

  if (prevBtn) prevBtn.addEventListener("click", () => jump(current - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => jump(current + 1));

  pipeline.addEventListener("keydown", event => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      jump(current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      jump(current - 1);
    }
  });

  pipeline.classList.add("is-ready");
  render();
}

document.addEventListener("DOMContentLoaded", anInitPipeline);
