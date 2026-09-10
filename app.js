/**
 * App orchestration: search -> fetch -> render states, plus the
 * typewriter playback engine (play/pause/restart/scrub/speed).
 */
(function () {
  const { fetchTrackMetadata, fetchLyrics, fetchArtistCatalog, EchoTypeError } =
    window.EchoTypeProviders;

  // ---- DOM refs ----------------------------------------------------
  const form = document.getElementById("search-form");
  const artistInput = document.getElementById("artist-input");
  const songInput = document.getElementById("song-input");
  const findBtn = document.getElementById("find-btn");
  const browseBtn = document.getElementById("browse-btn");

  const emptyState = document.getElementById("empty-state");
  const loadingState = document.getElementById("loading-state");
  const loadingText = document.getElementById("loading-text");
  const errorState = document.getElementById("error-state");
  const errorTitle = document.getElementById("error-title");
  const errorDetail = document.getElementById("error-detail");
  const errorRetry = document.getElementById("error-retry");
  const songView = document.getElementById("song-view");
  const catalogState = document.getElementById("catalog-state");
  const catalogArtistName = document.getElementById("catalog-artist-name");
  const catalogList = document.getElementById("catalog-list");

  const artTilt = document.getElementById("art-tilt");
  const artImage = document.getElementById("art-image");
  const trackTitleEl = document.getElementById("track-title");
  const trackArtistEl = document.getElementById("track-artist");
  const trackAlbumEl = document.getElementById("track-album");
  const sourceBadge = document.getElementById("lyrics-source-badge");

  const lyricsScroll = document.getElementById("lyrics-scroll");
  const lyricsTextEl = document.getElementById("lyrics-text");

  const playBtn = document.getElementById("play-btn");
  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");
  const restartBtn = document.getElementById("restart-btn");
  const speedSelect = document.getElementById("speed-select");
  const scrub = document.getElementById("scrub");
  const progressPct = document.getElementById("progress-pct");

  const SCRUB_MAX = 1000;
  const BASE_CHARS_PER_SEC = 28;

  // ---- Typewriter engine --------------------------------------------
  const typewriter = {
    fullText: "",
    charIndex: 0,
    playing: false,
    speed: 1,
    rafId: null,
    lastTimestamp: null,
    carryFraction: 0,

    load(text) {
      this.fullText = text;
      this.charIndex = 0;
      this.playing = false;
      this.carryFraction = 0;
      this.render();
      this.updateProgressUI();
    },

    render() {
      const visible = this.fullText.slice(0, this.charIndex);
      lyricsTextEl.textContent = "";
      lyricsTextEl.appendChild(document.createTextNode(visible));

      const cursor = document.createElement("span");
      cursor.className = "type-cursor" + (this.playing ? " typing" : "");
      lyricsTextEl.appendChild(cursor);
    },

    updateProgressUI() {
      const total = this.fullText.length || 1;
      const ratio = this.charIndex / total;
      const pct = Math.round(ratio * 100);
      scrub.value = String(Math.round(ratio * SCRUB_MAX));
      scrub.style.setProperty("--fill", pct + "%");
      progressPct.textContent = pct + "%";
    },

    play() {
      if (this.playing) return;
      if (this.charIndex >= this.fullText.length) {
        this.charIndex = 0; // replay from the top if already finished
      }
      this.playing = true;
      this.lastTimestamp = null;
      playIcon.hidden = true;
      pauseIcon.hidden = false;
      playBtn.setAttribute("aria-label", "Pause");
      this.render();
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    },

    pause() {
      this.playing = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      playIcon.hidden = false;
      pauseIcon.hidden = true;
      playBtn.setAttribute("aria-label", "Play");
      this.render();
    },

    restart() {
      this.pause();
      this.charIndex = 0;
      this.carryFraction = 0;
      this.render();
      this.updateProgressUI();
      lyricsScroll.scrollTop = 0;
    },

    seekToRatio(ratio) {
      const clamped = Math.max(0, Math.min(1, ratio));
      this.charIndex = Math.round(clamped * this.fullText.length);
      this.carryFraction = 0;
      this.render();
      this.updateProgressUI();
      this.autoScroll();
    },

    tick(timestamp) {
      if (!this.playing) return;
      if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
      const dt = (timestamp - this.lastTimestamp) / 1000;
      this.lastTimestamp = timestamp;

      const charsThisFrame =
        BASE_CHARS_PER_SEC * this.speed * dt + this.carryFraction;
      const wholeChars = Math.floor(charsThisFrame);
      this.carryFraction = charsThisFrame - wholeChars;

      if (wholeChars > 0) {
        this.charIndex = Math.min(
          this.fullText.length,
          this.charIndex + wholeChars
        );
        this.render();
        this.updateProgressUI();
        this.autoScroll();
      }

      if (this.charIndex >= this.fullText.length) {
        this.pause();
        return;
      }

      this.rafId = requestAnimationFrame((t) => this.tick(t));
    },

    autoScroll() {
      // Keep the actively-typed line in view without fighting a user
      // who is manually scrolling back through earlier lyrics.
      const distanceFromBottom =
        lyricsScroll.scrollHeight -
        lyricsScroll.scrollTop -
        lyricsScroll.clientHeight;
      if (distanceFromBottom < 120) {
        lyricsScroll.scrollTop = lyricsScroll.scrollHeight;
      }
    },
  };

  // ---- UI state machine ----------------------------------------------
  function showState(name) {
    emptyState.hidden = name !== "empty";
    loadingState.hidden = name !== "loading";
    errorState.hidden = name !== "error";
    songView.hidden = name !== "song";
    catalogState.hidden = name !== "catalog";
  }

  function showError(title, detail) {
    errorTitle.textContent = title;
    errorDetail.textContent = detail;
    showState("error");
  }

  let lastQuery = null;

  async function runSearch(artist, title) {
    lastQuery = { type: "search", artist, title };
    showState("loading");
    loadingText.textContent = `Looking up "${title}" by ${artist}…`;
    findBtn.disabled = true;

    try {
      const track = await fetchTrackMetadata(artist, title);
      await loadTrack(track);
      showState("song");
    } catch (err) {
      handleSearchError(err);
    } finally {
      findBtn.disabled = false;
    }
  }

  /** Load lyrics for a track whose metadata is already known (used both
   *  after a direct search and after picking an item from the catalog). */
  async function loadTrack(track) {
    loadingText.textContent = "Finding the lyrics…";
    const { lyrics, source } = await fetchLyrics(track.artist, track.title);
    renderSong(track, lyrics, source);
  }

  function handleSearchError(err) {
    if (err instanceof EchoTypeError) {
      if (err.code === "NOT_FOUND") {
        showError("Couldn't find that track", err.message);
      } else if (err.code === "LYRICS_NOT_FOUND") {
        showError("Lyrics not available", err.message);
      } else {
        showError("Network hiccup", err.message);
      }
    } else {
      showError(
        "Something unexpected happened",
        "Please try again in a moment."
      );
    }
  }

  async function browseArtist(artist) {
    lastQuery = { type: "browse", artist };
    showState("loading");
    loadingText.textContent = `Pulling ${artist}'s catalog…`;
    browseBtn.disabled = true;

    try {
      const tracks = await fetchArtistCatalog(artist);
      renderCatalog(artist, tracks);
      showState("catalog");
    } catch (err) {
      handleSearchError(err);
    } finally {
      browseBtn.disabled = false;
    }
  }

  function renderCatalog(artist, tracks) {
    catalogArtistName.textContent = artist;
    catalogList.innerHTML = "";

    for (const track of tracks) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "catalog-item";

      const img = document.createElement("img");
      img.className = "catalog-item-art";
      img.src = track.artwork || "";
      img.alt = "";
      img.loading = "lazy";

      const textWrap = document.createElement("span");
      textWrap.className = "catalog-item-text";

      const titleEl = document.createElement("span");
      titleEl.className = "catalog-item-title";
      titleEl.textContent = track.title;

      const albumEl = document.createElement("span");
      albumEl.className = "catalog-item-album";
      albumEl.textContent = track.album || "";

      textWrap.appendChild(titleEl);
      textWrap.appendChild(document.createElement("br"));
      textWrap.appendChild(albumEl);

      btn.appendChild(img);
      btn.appendChild(textWrap);
      btn.addEventListener("click", () => selectCatalogTrack(track));

      li.appendChild(btn);
      catalogList.appendChild(li);
    }
  }

  async function selectCatalogTrack(track) {
    showState("loading");
    loadingText.textContent = "Finding the lyrics…";
    try {
      await loadTrack(track);
      showState("song");
    } catch (err) {
      handleSearchError(err);
    }
  }

  function renderSong(track, lyrics, source) {
    artImage.src =
      track.artwork ||
      "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="%2315151f"/></svg>'
        );
    artImage.alt = `${track.album || track.title} cover artwork`;

    trackTitleEl.textContent = track.title;
    trackArtistEl.textContent = track.artist;
    trackAlbumEl.textContent = track.album || "";

    sourceBadge.textContent = "Lyrics via " + source;

    typewriter.load(lyrics);
  }

  // ---- Event wiring ----------------------------------------------------
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const artist = artistInput.value.trim();
    const title = songInput.value.trim();
    if (!artist || !title) return;
    runSearch(artist, title);
  });

  errorRetry.addEventListener("click", () => {
    if (!lastQuery) return;
    if (lastQuery.type === "browse") {
      browseArtist(lastQuery.artist);
    } else {
      runSearch(lastQuery.artist, lastQuery.title);
    }
  });

  browseBtn.addEventListener("click", () => {
    const artist = artistInput.value.trim();
    if (!artist) {
      artistInput.focus();
      return;
    }
    browseArtist(artist);
  });

  playBtn.addEventListener("click", () => {
    if (typewriter.playing) {
      typewriter.pause();
    } else {
      typewriter.play();
    }
  });

  restartBtn.addEventListener("click", () => typewriter.restart());

  speedSelect.addEventListener("change", () => {
    typewriter.speed = parseFloat(speedSelect.value);
  });

  let scrubbingWhilePlaying = false;
  scrub.addEventListener("input", () => {
    if (typewriter.playing) {
      scrubbingWhilePlaying = true;
      typewriter.pause();
    }
    typewriter.seekToRatio(Number(scrub.value) / SCRUB_MAX);
  });
  scrub.addEventListener("change", () => {
    if (scrubbingWhilePlaying) {
      scrubbingWhilePlaying = false;
      typewriter.play();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (songView.hidden) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault();
      typewriter.playing ? typewriter.pause() : typewriter.play();
    } else if (e.key === "r" || e.key === "R") {
      typewriter.restart();
    }
  });

  // 3D tilt on the artwork
  window.EchoTypeTilt.initTilt(artTilt);

  // ---- Boot ----------------------------------------------------------
  showState("empty");
  artistInput.focus();
})();
