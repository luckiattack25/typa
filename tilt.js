/**
 * Cursor-reactive 3D tilt + spotlight sheen for the album artwork.
 * Disabled under prefers-reduced-motion (the art stays flat and static).
 */
(function () {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  function initTilt(el) {
    if (!el || prefersReducedMotion) return;
    const inner = el.querySelector(".art-tilt-inner");
    if (!inner) return;

    const MAX_TILT = 10; // degrees

    function handleMove(clientX, clientY) {
      const rect = el.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width; // 0..1
      const py = (clientY - rect.top) / rect.height; // 0..1

      const rotateY = (px - 0.5) * MAX_TILT * 2;
      const rotateX = (0.5 - py) * MAX_TILT * 2;

      inner.style.setProperty("--tilt-x", rotateX.toFixed(2) + "deg");
      inner.style.setProperty("--tilt-y", rotateY.toFixed(2) + "deg");
      inner.style.setProperty("--sheen-x", (px * 100).toFixed(1) + "%");
      inner.style.setProperty("--sheen-y", (py * 100).toFixed(1) + "%");

      const glowStrength = 0.25 + Math.abs(px - 0.5) * 0.3;
      inner.style.setProperty(
        "--tilt-glow",
        `0 0 60px ${glowStrength.toFixed(2)}rem rgba(255,159,28,0.18)`
      );
    }

    function reset() {
      inner.style.setProperty("--tilt-x", "0deg");
      inner.style.setProperty("--tilt-y", "0deg");
      inner.style.setProperty("--tilt-glow", "0 0 0 rgba(255,159,28,0)");
    }

    el.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
    el.addEventListener("mouseleave", reset);

    el.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches && e.touches[0]) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );
    el.addEventListener("touchend", reset);
  }

  // Expose globally so app.js can (re)initialize once the art element exists.
  window.EchoTypeTilt = { initTilt };
})();
