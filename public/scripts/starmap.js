const CLUSTER_LAYOUT = {
  sol: { x: 0.16, y: 0.5 },
  "alpha-centauri": { x: 0.35, y: 0.26 },
  "barnards-star": { x: 0.34, y: 0.72 },
  "wolf-359": { x: 0.56, y: 0.35 },
  "tau-ceti": { x: 0.72, y: 0.55 },
  "epsilon-eridani": { x: 0.83, y: 0.3 }
};

const BODY_COLORS = {
  Planet: "rgba(216, 235, 245, 0.95)",
  Moon: "rgba(150, 190, 230, 0.95)",
  Field: "rgba(0, 247, 255, 0.68)"
};

function overlayColor(system, overlay) {
  if (overlay === "none") {
    return "rgba(0, 247, 255, 0.88)";
  }

  const value =
    overlay === "gdp"
      ? system.gdpIndex / 100
      : overlay === "activity"
        ? system.activityLevel / 100
        : overlay === "pirates"
          ? system.pirateDensity / 40
          : Math.max(0.12, (100 - system.pirateDensity + system.gdpIndex) / 150);

  const clamped = Math.max(0.1, Math.min(1, value));
  return `rgba(${Math.floor((1 - clamped) * 180 + 40)}, ${Math.floor(clamped * 220 + 30)}, 255, 0.92)`;
}

function hashSeed(input) {
  let h = 0;
  const text = String(input || "unknown");
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function generatedComposition(body) {
  const seed = hashSeed(body.id);
  const entries = [
    { name: "Silicates", pct: 20 + (seed % 25) },
    { name: "Nickel", pct: 8 + ((seed >> 2) % 18) },
    { name: "Titanium", pct: 6 + ((seed >> 3) % 16) },
    { name: "Water Ice", pct: 5 + ((seed >> 4) % 28) },
    { name: "Helium-3", pct: 2 + ((seed >> 5) % 10) }
  ];

  const sum = entries.reduce((acc, item) => acc + item.pct, 0);
  return entries.map((item) => ({
    name: item.name,
    pct: Math.round((item.pct / sum) * 100)
  }));
}

export function createStarmapController({
  canvas,
  fallbackEl,
  detailsEl,
  overlaySelect,
  resetButton,
  onScoutBody,
  isBodyScouted
}) {
  const ctx = canvas?.getContext?.("2d");
  const state = {
    systems: [],
    overlay: "none",
    view: "cluster",
    selectedSystemId: null,
    selectedBodyId: null,
    clickTargets: []
  };

  function setCanvasSize() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(500, Math.floor(rect.width));
    const availableHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 34));
    const targetHeight = Math.min(560, availableHeight);

    canvas.style.height = `${targetHeight}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(targetHeight * dpr);
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function clearScene() {
    if (!ctx || !canvas) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, width, height);

    const nebulaA = ctx.createRadialGradient(width * 0.12, height * 0.2, 10, width * 0.12, height * 0.2, width * 0.45);
    nebulaA.addColorStop(0, "rgba(0, 247, 255, 0.1)");
    nebulaA.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = nebulaA;
    ctx.fillRect(0, 0, width, height);

    const nebulaB = ctx.createRadialGradient(width * 0.8, height * 0.75, 10, width * 0.8, height * 0.75, width * 0.4);
    nebulaB.addColorStop(0, "rgba(255, 170, 51, 0.08)");
    nebulaB.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = nebulaB;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 220; i += 1) {
      const x = (i * 79) % width;
      const y = (i * 113) % height;
      ctx.fillStyle = `rgba(210, 235, 255, ${(i % 8) / 20 + 0.1})`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }

  function drawClusterView() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    state.clickTargets = [];

    ctx.strokeStyle = "rgba(120, 180, 220, 0.2)";
    ctx.lineWidth = 1;

    for (let i = 0; i < state.systems.length; i += 1) {
      for (let j = i + 1; j < state.systems.length; j += 1) {
        const a = CLUSTER_LAYOUT[state.systems[i].id];
        const b = CLUSTER_LAYOUT[state.systems[j].id];
        if (!a || !b) {
          continue;
        }

        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const d = Math.hypot(ax - bx, ay - by);
        if (d < width * 0.42) {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
    }

    state.systems.forEach((system) => {
      const p = CLUSTER_LAYOUT[system.id] || { x: 0.5, y: 0.5 };
      const x = p.x * width;
      const y = p.y * height;
      const radius = state.selectedSystemId === system.id ? 10 : 8;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = overlayColor(system, state.overlay);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0, 247, 255, 0.3)";
      ctx.stroke();

      ctx.fillStyle = "rgba(216, 235, 245, 0.95)";
      ctx.font = "12px Inter";
      ctx.fillText(system.name, x + 14, y - 4);

      state.clickTargets.push({
        type: "system",
        systemId: system.id,
        x,
        y,
        radius: radius + 8
      });
    });

    renderDetails();
  }

  function drawSystemView(system) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    state.clickTargets = [
      {
        type: "back",
        x: 76,
        y: 36,
        radius: 32
      }
    ];

    ctx.fillStyle = "rgba(255, 170, 51, 0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();

    const bodies = system?.bodies || [];
    const maxOrbit = Math.max(1, ...bodies.map((body) => Math.abs(body.x) + Math.abs(body.y)));

    bodies.forEach((body, index) => {
      const orbit = ((Math.abs(body.x) + Math.abs(body.y)) / maxOrbit) * (Math.min(width, height) * 0.34) + 42;
      const angle = (index / Math.max(1, bodies.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit;

      ctx.beginPath();
      ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120, 180, 220, 0.14)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, body.radius), 0, Math.PI * 2);
      ctx.fillStyle = BODY_COLORS[body.type] || "rgba(216, 235, 245, 0.9)";
      ctx.fill();

      if (body.type === "Planet") {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, body.radius) + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 170, 51, 0.28)";
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(216, 235, 245, 0.92)";
      ctx.font = "11px Inter";
      ctx.fillText(body.name, x + 8, y - 4);

      state.clickTargets.push({
        type: "body",
        systemId: system.id,
        bodyId: body.id,
        x,
        y,
        radius: Math.max(8, body.radius + 8)
      });
    });

    drawBackButton();
    renderDetails();
  }

  function drawBodyView(system, body) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    state.clickTargets = [
      { type: "back-to-system", x: 96, y: 36, radius: 36 },
      { type: "back-to-cluster", x: 228, y: 36, radius: 40 }
    ];

    const radius = Math.min(width, height) * 0.16;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = body.type === "Moon" ? "rgba(150, 190, 230, 0.92)" : "rgba(216, 235, 245, 0.95)";
    ctx.fill();

    const moons = (system.bodies || []).filter((item) => item.type === "Moon" && item.id !== body.id);
    moons.forEach((moon, idx) => {
      const orbit = radius + 42 + idx * 24;
      const angle = (idx / Math.max(1, moons.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * orbit;
      const y = cy + Math.sin(angle) * orbit;

      ctx.beginPath();
      ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120, 180, 220, 0.15)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(150, 190, 230, 0.95)";
      ctx.fill();

      ctx.fillStyle = "rgba(216, 235, 245, 0.92)";
      ctx.font = "11px Inter";
      ctx.fillText(moon.name, x + 8, y - 4);
    });

    drawBackButton("Back To System", 96, 36);
    drawBackButton("Back To Cluster", 228, 36);
    renderDetails();
  }

  function drawBackButton(label = "Back", x = 76, y = 36) {
    ctx.fillStyle = "rgba(17, 34, 51, 0.9)";
    ctx.strokeStyle = "rgba(0, 247, 255, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 46, y - 15, 92, 30, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(216, 235, 245, 0.94)";
    ctx.font = "11px Inter";
    ctx.fillText(label, x - 30, y + 4);
  }

  function getSelectedSystem() {
    return state.systems.find((item) => item.id === state.selectedSystemId) || null;
  }

  function getSelectedBody() {
    const system = getSelectedSystem();
    if (!system) {
      return null;
    }
    return (system.bodies || []).find((item) => item.id === state.selectedBodyId) || null;
  }

  function renderDetails() {
    const system = getSelectedSystem();
    const body = getSelectedBody();

    if (!detailsEl) {
      return;
    }

    if (state.view === "cluster") {
      detailsEl.innerHTML = `
        <h3>Star Cluster</h3>
        <p class="muted">Select a system to enter fixed solar view mode. Mouse wheel and drag are disabled for stable navigation.</p>
      `;
      return;
    }

    if (state.view === "system" && system) {
      const bodyLines = (system.bodies || [])
        .map((entry) => `<li>${entry.name} (${entry.type})</li>`)
        .join("");
      detailsEl.innerHTML = `
        <h3>${system.name}</h3>
        <p class="muted">GDP ${system.gdpIndex} | Activity ${system.activityLevel} | Pirates ${system.pirateDensity}</p>
        <p>${system.ownerRule || "Ownership available via territorial dominance and treaties."}</p>
        <ul class="text-list">${bodyLines}</ul>
      `;
      return;
    }

    if (state.view === "body" && system && body) {
      const scouted = isBodyScouted ? Boolean(isBodyScouted(system.id, body.id)) : false;
      const composition = generatedComposition(body)
        .map((part) => `<li>${part.name}: ${part.pct}%</li>`)
        .join("");

      detailsEl.innerHTML = `
        <h3>${body.name} - ${system.name}</h3>
        <p class="muted">Type: ${body.type} | Scouting Status: ${scouted ? "Completed" : "Unscouted"}</p>
        ${
          scouted
            ? `<ul class="text-list">${composition}</ul>`
            : `<p class="muted">Resource composition is unknown. You must scout this body first.</p>
               <button id="scout-body-btn" class="btn btn-accent">Scout Body</button>`
        }
      `;

      if (!scouted) {
        const scoutButton = detailsEl.querySelector("#scout-body-btn");
        scoutButton?.addEventListener("click", () => {
          if (onScoutBody) {
            onScoutBody(system.id, body.id);
          }
          render();
        });
      }
    }
  }

  function renderFallback() {
    if (!fallbackEl) {
      return;
    }

    const rows = state.systems
      .map((system) => `<li><strong>${system.name}</strong> - ${(system.bodies || []).length} catalogued bodies.</li>`)
      .join("");

    fallbackEl.innerHTML = `
      <h3>Text-mode Starmap Summary</h3>
      <p class="muted">Graphical mode unavailable. Use list navigation to inspect systems and body counts.</p>
      <ul class="text-list">${rows}</ul>
    `;
  }

  function render() {
    if (!ctx || !canvas || canvas.hidden) {
      renderFallback();
      return;
    }

    clearScene();

    const system = getSelectedSystem();
    const body = getSelectedBody();

    if (state.view === "cluster") {
      drawClusterView();
      return;
    }

    if (state.view === "system" && system) {
      drawSystemView(system);
      return;
    }

    if (state.view === "body" && system && body) {
      drawBodyView(system, body);
      return;
    }

    state.view = "cluster";
    drawClusterView();
  }

  function handleClick(event) {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const hit = state.clickTargets.find((target) => Math.hypot(target.x - x, target.y - y) <= target.radius);
    if (!hit) {
      return;
    }

    if (hit.type === "system") {
      state.selectedSystemId = hit.systemId;
      state.selectedBodyId = null;
      state.view = "system";
      render();
      return;
    }

    if (hit.type === "body") {
      state.selectedSystemId = hit.systemId;
      state.selectedBodyId = hit.bodyId;
      state.view = "body";
      render();
      return;
    }

    if (hit.type === "back") {
      state.view = "cluster";
      state.selectedBodyId = null;
      render();
      return;
    }

    if (hit.type === "back-to-system") {
      state.view = "system";
      state.selectedBodyId = null;
      render();
      return;
    }

    if (hit.type === "back-to-cluster") {
      state.view = "cluster";
      state.selectedBodyId = null;
      render();
    }
  }

  function bindEvents() {
    if (!canvas) {
      return;
    }

    canvas.addEventListener("click", handleClick);

    overlaySelect?.addEventListener("change", () => {
      state.overlay = overlaySelect.value;
      render();
    });

    resetButton?.addEventListener("click", () => {
      state.view = "cluster";
      state.selectedBodyId = null;
      render();
    });

    window.addEventListener("resize", () => {
      setCanvasSize();
      render();
    });
  }

  function setGraphicsMode(enabled) {
    if (!canvas || !fallbackEl) {
      return;
    }

    canvas.hidden = !enabled;
    fallbackEl.hidden = enabled;
    render();
  }

  function mount(initialSystems) {
    state.systems = initialSystems || [];
    state.selectedSystemId = state.systems[0]?.id || null;

    const graphicsAvailable = Boolean(ctx);
    if (!graphicsAvailable) {
      fallbackEl.hidden = false;
      renderFallback();
      return;
    }

    bindEvents();
    setCanvasSize();
    render();
  }

  return {
    mount,
    setSystems(nextSystems) {
      state.systems = nextSystems || [];
      if (!state.systems.some((item) => item.id === state.selectedSystemId)) {
        state.selectedSystemId = state.systems[0]?.id || null;
        state.selectedBodyId = null;
        state.view = "cluster";
      }
      render();
    },
    setGraphicsMode,
    setOverlay(value) {
      state.overlay = value;
      render();
    },
    rerender() {
      render();
    }
  };
}
