/**
 * Ambient "digital rain" background.
 * Kept deliberately subtle (opacity is controlled in CSS, not here) so it
 * reads as texture behind the glass panels rather than a distraction.
 * Fully disabled when the user has requested reduced motion.
 */
(function () {
  const canvas = document.getElementById("rain");
  if (!canvas) return;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  if (prefersReducedMotion) {
    canvas.style.display = "none";
    return;
  }

  const ctx = canvas.getContext("2d");
  const GLYPHS = "01⌁⌇░▒▓♪♫✧·:;+*".split("");
  const FONT_SIZE = 15;

  let columns = 0;
  let drops = [];
  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    columns = Math.floor(width / FONT_SIZE);
    drops = new Array(columns).fill(0).map(() => Math.random() * -height);
  }

  function draw() {
    ctx.fillStyle = "rgba(8, 8, 12, 0.14)";
    ctx.fillRect(0, 0, width, height);

    ctx.font = FONT_SIZE + "px " + '"IBM Plex Mono", monospace';
    ctx.fillStyle = "#4dd8c8";

    for (let i = 0; i < columns; i++) {
      const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      const x = i * FONT_SIZE;
      const y = drops[i];

      ctx.fillText(glyph, x, y);

      if (y > height && Math.random() > 0.975) {
        drops[i] = 0;
      } else {
        drops[i] += FONT_SIZE * 0.55;
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();
  requestAnimationFrame(draw);
})();
