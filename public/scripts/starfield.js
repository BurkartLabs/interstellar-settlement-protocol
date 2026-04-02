/**
 * Starfield canvas — lightweight animated cosmic background.
 * Two star layers at different speeds for a subtle parallax feel.
 * Negligible CPU: uses requestAnimationFrame + single canvas.
 */
(function () {
  const canvas = document.getElementById("starfield-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let W, H, stars;

  const STAR_COUNT = 260;
  const LAYERS = [
    { speed: 0.012, radiusMax: 1.1, opacity: 0.55 }, // far stars
    { speed: 0.022, radiusMax: 1.6, opacity: 0.80 }, // near stars
  ];

  function randomStar(layer) {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * layer.radiusMax + 0.3,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.004 + Math.random() * 0.008,
      speed: layer.speed,
      opacity: layer.opacity,
    };
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildStars();
  }

  function buildStars() {
    stars = [];
    LAYERS.forEach((layer) => {
      const count = Math.round(STAR_COUNT / LAYERS.length);
      for (let i = 0; i < count; i++) {
        stars.push(randomStar(layer));
      }
    });
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);

    for (const s of stars) {
      s.twinkle += s.twinkleSpeed;
      // Very slow vertical drift
      s.y -= s.speed;
      if (s.y < -2) {
        s.y = H + 2;
        s.x = Math.random() * W;
      }

      const alpha = s.opacity * (0.65 + 0.35 * Math.sin(s.twinkle));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 230, 255, ${alpha.toFixed(2)})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();
  requestAnimationFrame(draw);
})();
