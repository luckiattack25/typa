/**
 * All external data fetching lives here, isolated from UI/animation logic.
 *
 * - Track metadata + artwork: iTunes Search API (no key, CORS-open).
 * - Lyrics, primary: a Fandom lyrics wiki via the public MediaWiki API,
 *   using the documented `origin=*` parameter to enable CORS from a
 *   browser with no backend involved.
 * - Lyrics, fallback: lyrics.ovh (no key, CORS-open).
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

  function upscaleArtwork(url) {
    if (!url) return null;
    return url.replace(/\d+x\d+bb\.(jpg|png)/, "600x600bb.$1");
  }

  /** Look up artist / title / album / artwork via the iTunes Search API. */
  async function fetchTrackMetadata(artist, title) {
    const term = encodeURIComponent(`${artist} ${title}`);
    const url = `${ITUNES_ENDPOINT}?term=${term}&entity=song&limit=5`;

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

    // Prefer the closest artist-name match among the returned results.
    const lowerArtist = artist.trim().toLowerCase();
    const best =
      data.results.find(
        (r) => (r.artistName || "").toLowerCase() === lowerArtist
      ) || data.results[0];

    return {
      artist: best.artistName,
      title: best.trackName,
      album: best.collectionName,
      artwork: upscaleArtwork(best.artworkUrl100),
      previewUrl: best.previewUrl || null,
    };
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
      return null; // Fall through to the secondary provider silently.
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
    if (!cleaned || cleaned.length < 40) return null; // too short to be real lyrics

    return cleaned;
  }

  /** Strip MediaWiki markup down to plain lyric lines. */
  function cleanWikitext(wikitext) {
    let text = wikitext;

    // Drop templates like {{...}}, infoboxes, categories, refs.
    text = text.replace(/\{\{[\s\S]*?\}\}/g, "");
    text = text.replace(/\[\[Category:[^\]]*\]\]/gi, "");
    text = text.replace(/<ref[\s\S]*?<\/ref>/gi, "");
    text = text.replace(/<[^>]+>/g, "");

    // Convert [[link|Display]] or [[link]] to plain display text.
    text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
    text = text.replace(/\[\[([^\]]*)\]\]/g, "$1");

    // Remove bold/italic wiki markup.
    text = text.replace(/'''''|'''|''/g, "");

    // Drop remaining section headers like == Lyrics ==.
    text = text.replace(/^={2,}.*={2,}$/gm, "");

    // Collapse excess blank lines.
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
   * Try Fandom first, then lyrics.ovh. Returns { lyrics, source }.
   * Throws EchoTypeError("NOT_FOUND") if both come up empty.
   */
  async function fetchLyrics(artist, title) {
    const fandom = await fetchFandomLyrics(artist, title);
    if (fandom) return { lyrics: fandom, source: "Fandom" };

    const ovh = await fetchOvhLyrics(artist, title);
    if (ovh) return { lyrics: ovh, source: "lyrics.ovh" };

    throw new EchoTypeError(
      `Found the track, but no lyrics were available for "${title}."`,
      "LYRICS_NOT_FOUND"
    );
  }

  window.EchoTypeProviders = {
    EchoTypeError,
    fetchTrackMetadata,
    fetchLyrics,
  };
})();
