const btnMobileNav = document.querySelector(".btn-mobile-nav");
const header = document.querySelector(".site-header");

btnMobileNav.addEventListener("click", function () {
  header.classList.toggle("nav-open");
});

const lightbox = document.getElementById("lightbox");

if (lightbox) {
  const images = Array.from(document.querySelectorAll("#gallery img"));
  const lbImage = document.getElementById("lbImage");
  const lbCounter = document.getElementById("lbCounter");

  let currentIndex = 0;

  // Cloudflare liefert nur diese Breiten aus dem Cache -> weniger Origin-Requests
  const LIGHTBOX_WIDTHS = [640, 1024, 1600, 2000];

  function resizedFullSrc(img) {
    if (!img.dataset.full) return img.currentSrc || img.src;

    const targetWidth = Math.round(
      window.innerWidth * 0.9 * (window.devicePixelRatio || 1),
    );
    const width =
      LIGHTBOX_WIDTHS.find((w) => w >= targetWidth) ||
      LIGHTBOX_WIDTHS[LIGHTBOX_WIDTHS.length - 1];

    // data-full ist eine absolute URL (https://img.reiseblog-hollmann.de/...),
    // relative Pfade werden zur Sicherheit gegen die aktuelle Seite aufgelöst
    const fullUrl = new URL(img.dataset.full, location.href).href;
    return `/cdn-cgi/image/width=${width},quality=80,format=auto/${fullUrl}`;
  }

  // Bereits im Hintergrund geladene Auflösungen merken, um sie nicht doppelt anzufordern
  const preloadedSrcs = new Set();

  function preloadNeighbor(img) {
    const src = resizedFullSrc(img);
    if (preloadedSrcs.has(src)) return;
    preloadedSrcs.add(src);
    new Image().src = src;
  }

  const showImage = (index) => {
    currentIndex = (index + images.length) % images.length;
    const requestIndex = currentIndex;
    const img = images[currentIndex];
    const fallbackSrc = img.dataset.full || img.currentSrc || img.src;
    const nextSrc = resizedFullSrc(img);

    // Sofort die bereits geladene Grid-Vorschau zeigen (leicht geweichzeichnet),
    // damit beim Öffnen/Blättern nicht erst eine leere Fläche zu sehen ist,
    // während das hochauflösende Bild im Hintergrund lädt.
    lbImage.src = img.currentSrc || img.src;
    lbImage.alt = img.alt;
    lbImage.classList.add("is-loading");

    preloadedSrcs.add(nextSrc);
    const preload = new Image();
    preload.onload = () => {
      if (currentIndex !== requestIndex) return; // Nutzer hat schon weitergeblättert
      lbImage.src = nextSrc;
      lbImage.classList.remove("is-loading");
    };
    preload.onerror = () => {
      if (currentIndex !== requestIndex) return;
      // Original laden und die Unschärfe erst entfernen, wenn es wirklich da ist
      const fallback = new Image();
      fallback.onload = fallback.onerror = () => {
        if (currentIndex !== requestIndex) return;
        lbImage.src = fallbackSrc;
        lbImage.classList.remove("is-loading");
      };
      fallback.src = fallbackSrc;
    };
    preload.src = nextSrc;

    lbCounter.textContent = currentIndex + 1 + " / " + images.length;

    // Vor- und Nachbarbild im Hintergrund vorladen, damit Weiterblättern sofort geht
    preloadNeighbor(images[(currentIndex + 1) % images.length]);
    preloadNeighbor(images[(currentIndex - 1 + images.length) % images.length]);
  };

  const openLightbox = (index) => {
    showImage(index);
    lightbox.classList.add("is-open");
  };

  const closeLightbox = () => {
    lightbox.classList.remove("is-open");
  };

  images.forEach((img, i) => {
    img.addEventListener("click", () => openLightbox(i));
  });

  document
    .getElementById("lbNext")
    .addEventListener("click", () => showImage(currentIndex + 1));
  document
    .getElementById("lbPrev")
    .addEventListener("click", () => showImage(currentIndex - 1));
  document.getElementById("lbClose").addEventListener("click", closeLightbox);

  // Klick auf den dunklen Hintergrund schließt
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Tastatur: Pfeile blättern, Escape schließt
  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("is-open")) return;
    if (e.key === "ArrowRight") showImage(currentIndex + 1);
    if (e.key === "ArrowLeft") showImage(currentIndex - 1);
    if (e.key === "Escape") closeLightbox();
  });

  /* --- Wisch-Gesten fürs Handy --- */
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 50; // Mindest-Wischweite in Pixeln

  lightbox.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    },
    { passive: true },
  );

  lightbox.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;

      // Nur reagieren, wenn die Bewegung überwiegend horizontal war
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        if (dx < 0)
          showImage(currentIndex + 1); // nach links wischen -> nächstes
        else showImage(currentIndex - 1); // nach rechts wischen -> vorheriges
      }
    },
    { passive: true },
  );
}
