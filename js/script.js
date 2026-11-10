const btnMobileNav = document.querySelector(".btn-mobile-nav");
const header = document.querySelector(".site-header");

btnMobileNav.addEventListener("click", function () {
  header.classList.toggle("nav-open");
});

const landFilter = document.querySelector(".land-filter");

if (landFilter) {
  const landButtons = Array.from(landFilter.querySelectorAll("button"));
  const cards = document.querySelectorAll(".card[data-land]");

  const showLand = (land) => {
    landButtons.forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.land === land);
    });
    cards.forEach((card) => {
      card.hidden = card.dataset.land !== land;
    });
  };

  landButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      showLand(btn.dataset.land);
      try {
        sessionStorage.setItem("land", btn.dataset.land);
      } catch {}
    });
  });

  // Nav-Links "Neuseeland"/"Australien" führen auf index.html#<land>:
  // passenden Tab öffnen und zu den Beiträgen scrollen
  const showLandFromHash = () => {
    const land = location.hash.slice(1);
    if (!landButtons.some((btn) => btn.dataset.land === land)) return false;
    showLand(land);
    try {
      sessionStorage.setItem("land", land);
    } catch {}
    header.classList.remove("nav-open");
    document.getElementById("section-posts").scrollIntoView();
    return true;
  };

  window.addEventListener("hashchange", showLandFromHash);

  // Erneuter Klick auf denselben Link löst kein hashchange aus
  document.querySelectorAll(".main-nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      if (link.pathname === location.pathname && link.hash === location.hash) {
        showLandFromHash();
      }
    });
  });

  // Auswahl im Tab merken, damit man nach einem Post beim selben Land landet
  if (!showLandFromHash()) {
    let savedLand = null;
    try {
      savedLand = sessionStorage.getItem("land");
    } catch {}
    showLand(
      landButtons.some((btn) => btn.dataset.land === savedLand)
        ? savedLand
        : "neuseeland",
    );
  }
}

const lightbox = document.getElementById("lightbox");

if (lightbox) {
  const images = Array.from(document.querySelectorAll("#gallery img"));
  const lbImage = document.getElementById("lbImage");
  const lbCounter = document.getElementById("lbCounter");

  let currentIndex = 0;

  // Jede Galerie-Kachel trägt in data-srcset ihre Lightbox-Varianten
  // ("url 800w, url 1200w, ..."). Gewählt wird die kleinste Variante,
  // die mindestens so breit ist, wie das Bild in der Lightbox wirklich
  // dargestellt wird (Fläche 90dvw x 85dvh, object-fit: contain).
  function parseSrcset(img) {
    return (img.dataset.srcset || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/))
      .filter(([url, w]) => url && /^\d+w$/.test(w))
      .map(([url, w]) => ({ url, width: parseInt(w, 10) }))
      .sort((a, b) => a.width - b.width);
  }

  function resizedFullSrc(img) {
    const variants = parseSrcset(img);
    if (!variants.length) return img.currentSrc || img.src;

    // Seitenverhältnis aus der bereits geladenen Vorschau (ohne Zuschnitt)
    const ratio =
      img.naturalWidth && img.naturalHeight
        ? img.naturalWidth / img.naturalHeight
        : 4 / 3;
    const boxWidth = window.innerWidth * 0.9;
    const boxHeight = window.innerHeight * 0.85;
    const shownWidth = Math.min(boxWidth, boxHeight * ratio);
    const targetWidth = Math.round(shownWidth * (window.devicePixelRatio || 1));

    const pick =
      variants.find((v) => v.width >= targetWidth) ||
      variants[variants.length - 1];
    return new URL(pick.url, location.href).href;
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
      // Variante fehlt: bei der Vorschau bleiben, nur die Unschärfe entfernen
      lbImage.classList.remove("is-loading");
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
