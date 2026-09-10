/**
 * All external data fetching lives here, isolated from UI/animation logic.
 *
 * - Track metadata + artwork: iTunes Search API (no key, CORS-open).
 * - Lyrics, in order of preference:
 *     1. lrclib.net — free, keyless, CORS-open, community-maintained lyrics
 *        database used by several synced-lyrics music apps. Much better
 *        coverage of underground/mixtape artists and newer releases than
 *        the two sources below.
 *     2. A Fandom lyrics wiki, via the public MediaWiki API, using the
 *        documented `origin=*` parameter to enable CORS from a browser
 *        with no backend involved.
 *     3. lyrics.ovh — smaller, keyless, CORS-open fallback.
 *
 * Every function throws a small typed error the UI can present directly.
 */
(function () {
  class EchoTypeError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const ITUNES_ENDPOINT = "https://itunes.apple.com/search";
  const FANDOM_WIKI = "https://lyrics.fandom.com";
  const LYRICS_OVH = "https://api.lyrics.ovh/v1";
  const LRCLIB_ENDPOINT = "https://lrclib.net/api";

  function upscaleArtwork(url) {
    if (!url) return null;
    return url.replace(/\d+x\d+bb\.(jpg|png)/, "600x600bb.$1");
  }

  function normalize(str) {
    return (str || "")
      .toLowerCase()
      .replace(/\(feat\.?[^)]*\)|\[feat\.?[^\]]*\]/g, "")
      .replace(/feat\.?.*$/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /**
   * Score how well a candidate (artist, title) matches the query, as two
   * independent components. A high title score can't compensate for a
   * wrong artist, and vice versa — both must clear MIN_COMPONENT on their
   * own for the candidate to be considered a real match at all.
   */
  const MIN_COMPONENT = 0.3;

  function componentScore(query, candidate) {
    const q = normalize(query);
    const c = normalize(candidate);
    if (!q || !c) return 0;
    if (c === q) return 1;
    if (c.includes(q) || q.includes(c)) return 0.6;
    // Loose word-overlap check for cases like "Lucki" vs "Lucki Eck$".
    const qWords = q.split(" ").filter(Boolean);
    const overlap = qWords.filter((w) => c.includes(w)).length;
    if (qWords.length && overlap === qWords.length) return 0.5;
    return 0;
  }

  function matchScore(queryArtist, queryTitle, candArtist, candTitle) {
    const artistScore = componentScore(queryArtist, candArtist);
    const titleScore = componentScore(queryTitle, candTitle);
    if (artistScore < MIN_COMPONENT || titleScore < MIN_COMPONENT) return 0;
    return artistScore + titleScore;
  }

  /** Look up artist / title / album / artwork via the iTunes Search API. */
  async function fetchTrackMetadata(artist, title) {
    const term = encodeURIComponent(`${artist} ${title}`);
    const url = `${ITUNES_ENDPOINT}?term=${term}&entity=song&limit=15`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new EchoTypeError(
        "Couldn't reach the track database.",
        "NETWORK"
      );
    }

    if (!res.ok) {
      throw new EchoTypeError("The track database didn't respond.", "NETWORK");
    }

    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      throw new EchoTypeError(
        `No track found for "${title}" by ${artist}.`,
        "NOT_FOUND"
      );
    }

    // Score every candidate and take the best artist+title match, rather
    // than trusting iTunes' own result ordering (which can surface remixes,
    // covers, or same-titled tracks by other artists first).
    let best = data.results[0];
    let bestScore = -1;
    for (const r of data.results) {
      const s = matchScore(artist, title, r.artistName, r.trackName);
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }

    if (bestScore <= 0) {
      throw new EchoTypeError(
        `No close match found for "${title}" by ${artist}. Double-check the spelling, or the track may not be in Apple's catalog.`,
        "NOT_FOUND"
      );
    }

    return {
      artist: best.artistName,
      title: best.trackName,
      album: best.collectionName,
      artwork: upscaleArtwork(best.artworkUrl100),
      previewUrl: best.previewUrl || null,
    };
  }

  /** Primary lyrics source: lrclib.net (broad community coverage). */
  async function fetchLrclibLyrics(artist, title) {
    const url = `${LRCLIB_ENDPOINT}/search?artist_name=${encodeURIComponent(
      artist
    )}&track_name=${encodeURIComponent(title)}`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      return null;
    }
    if (!res.ok) return null;

    let results;
    try {
      results = await res.json();
    } catch (e) {
      return null;
    }
    if (!Array.isArray(results) || results.length === 0) return null;

    let best = null;
    let bestScore = -1;
    for (const r of results) {
      const text = r.plainLyrics || r.syncedLyrics;
      if (!text) continue;
      const s = matchScore(artist, title, r.artistName, r.trackName);
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    if (!best || bestScore <= 0) return null;

    let text = best.plainLyrics;
    if (!text && best.syncedLyrics) {
      // Strip [mm:ss.xx] timestamps from LRC-format lyrics.
      text = best.syncedLyrics
        .split("\n")
        .map((line) => line.replace(/^\[\d{2}:\d{2}(\.\d{2,3})?\]\s?/, ""))
        .join("\n");
    }
    if (!text || text.trim().length < 20) return null;

    return text.trim();
  }

  /**
   * Search a Fandom lyrics wiki for a page matching "Artist:Song" and
   * return its plain-text lyrics, or null if nothing usable was found.
   */
  async function fetchFandomLyrics(artist, title) {
    const searchTerm = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `${FANDOM_WIKI}/api.php?action=query&list=search&srsearch=${searchTerm}&format=json&origin=*`;

    let searchRes;
    try {
      searchRes = await fetch(searchUrl);
    } catch (e) {
      return null;
    }
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const hit = searchData?.query?.search?.[0];
    if (!hit) return null;

    const parseUrl = `${FANDOM_WIKI}/api.php?action=parse&page=${encodeURIComponent(
      hit.title
    )}&prop=wikitext&format=json&origin=*`;

    let parseRes;
    try {
      parseRes = await fetch(parseUrl);
    } catch (e) {
      return null;
    }
    if (!parseRes.ok) return null;

    const parseData = await parseRes.json();
    const wikitext = parseData?.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    const cleaned = cleanWikitext(wikitext);
    if (!cleaned || cleaned.length < 40) return null;

    return cleaned;
  }

  /** Strip MediaWiki markup down to plain lyric lines. */
  function cleanWikitext(wikitext) {
    let text = wikitext;
    text = text.replace(/\{\{[\s\S]*?\}\}/g, "");
    text = text.replace(/\[\[Category:[^\]]*\]\]/gi, "");
    text = text.replace(/<ref[\s\S]*?<\/ref>/gi, "");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
    text = text.replace(/\[\[([^\]]*)\]\]/g, "$1");
    text = text.replace(/'''''|'''|''/g, "");
    text = text.replace(/^={2,}.*={2,}$/gm, "");
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }

  /** Secondary lyrics source: lyrics.ovh. */
  async function fetchOvhLyrics(artist, title) {
    const url = `${LYRICS_OVH}/${encodeURIComponent(artist)}/${encodeURIComponent(
      title
    )}`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.lyrics) return null;
    return data.lyrics.trim();
  }

  /**
   * Try lrclib first, then Fandom, then lyrics.ovh.
   * Returns { lyrics, source }. Throws EchoTypeError("LYRICS_NOT_FOUND")
   * if all three come up empty.
   */
  async function fetchLyrics(artist, title) {
    const lrclib = await fetchLrclibLyrics(artist, title);
    if (lrclib) return { lyrics: lrclib, source: "lrclib.net" };

    const fandom = await fetchFandomLyrics(artist, title);
    if (fandom) return { lyrics: fandom, source: "Fandom" };

    const ovh = await fetchOvhLyrics(artist, title);
    if (ovh) return { lyrics: ovh, source: "lyrics.ovh" };

    throw new EchoTypeError(
      `Found the track, but no lyrics were available for "${title}" anywhere EchoType checked.`,
      "LYRICS_NOT_FOUND"
    );
  }

  window.EchoTypeProviders = {
    EchoTypeError,
    fetchTrackMetadata,
    fetchLyrics,
  };
})();
