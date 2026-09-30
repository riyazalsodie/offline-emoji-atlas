/**
 * emoji-atlas.js - zero-dependency sprite-sheet runtime for the web.
 *
 * Works in vanilla JS, React, Vue, Svelte, Angular, Astro, anything - because
 * it only touches the DOM. The sprite sheet is a plain image and the manifest is
 * plain JSON, so no bundler configuration is required either.
 *
 * Two rendering strategies are provided:
 *
 *   1. Inline SVG (default) - an <svg> whose viewBox crops to a single cell of
 *      the atlas. Scales to any size with no extra work and needs no CSS.
 *
 *   2. CSS background-position - a single <span> with background-image and
 *      background-position. Useful when you cannot emit SVG.
 *
 * Any emoji missing from the atlas falls back to the system colour emoji font,
 * so an empty box is impossible.
 */

/**
 * @typedef {Object} EmojiAtlasManifest
 * @property {string} asset      Path to the sprite sheet.
 * @property {number} columns    Grid width in cells.
 * @property {number} cellSize   Cell edge length in pixels.
 * @property {number} width      Sprite sheet width in pixels.
 * @property {number} height     Sprite sheet height in pixels.
 * @property {number} count      Number of bundled glyphs.
 * @property {Record<string, number>} index emoji -> cell index.
 */

/**
 * @typedef {Object} EmojiAtlasRuntime
 * @property {EmojiAtlasManifest} manifest
 * @property {string} assetUrl   Resolved URL of the sprite sheet.
 * @property {(emoji: string) => number | undefined} indexOf
 * @property {(emoji: string) => {x: number, y: number, size: number} | undefined} cellFor
 * @property {(emoji: string, size?: number, className?: string) => SVGElement} createSvg
 * @property {(emoji: string, size?: number, className?: string) => HTMLSpanElement} createSpan
 * @property {(emoji: string) => string} markup
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Native colour fonts, used whenever a glyph is not in the atlas. */
export const NATIVE_EMOJI_FONTS = [
  'Apple Color Emoji',
  'Segoe UI Emoji',
  'Noto Color Emoji',
  'Android Emoji',
  'sans-serif',
];

let cached = null;

/**
 * Loads and caches the manifest.
 *
 * @param {string} manifestUrl
 * @returns {Promise<EmojiAtlasRuntime>}
 */
export async function loadEmojiAtlas(manifestUrl) {
  if (cached) return cached;
  cached = (async () => {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      throw new Error(`Failed to load emoji manifest: HTTP ${res.status}`);
    }
    return createEmojiAtlas(await res.json());
  })();
  return cached;
}

/**
 * Builds a runtime from an already-loaded manifest object. Use this if you
 * import the JSON directly (bundlers, SSR, inline `<script type="application/json">`).
 *
 * @param {EmojiAtlasManifest} manifest
 * @param {string} [assetUrl] Overrides manifest.asset (e.g. a CDN URL).
 * @returns {EmojiAtlasRuntime}
 */
export function createEmojiAtlas(manifest, assetUrl) {
  if (!manifest || !manifest.index || !manifest.columns || !manifest.cellSize) {
    throw new Error('Invalid emoji atlas manifest.');
  }

  const resolved = assetUrl ?? manifest.asset ?? '';
  // Resolve relative to the document by default; keeps bundler asset URLs working
  // when they are passed in explicitly.
  const src = resolved;

  const indexOf = (emoji) => {
    const v = manifest.index[emoji];
    return typeof v === 'number' ? v : undefined;
  };

  const cellFor = (emoji) => {
    const i = indexOf(emoji);
    if (i === undefined) return undefined;
    return {
      x: (i % manifest.columns) * manifest.cellSize,
      y: Math.floor(i / manifest.columns) * manifest.cellSize,
      size: manifest.cellSize,
    };
  };

  const buildSvg = (emoji, size, className) => {
    const cell = cellFor(emoji);
    const svg = document.createElementNS(SVG_NS, 'svg');

    if (!cell) {
      // Fallback: plain text with the platform colour emoji font.
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', emoji);
      svg.setAttribute('class', className ?? 'emoji-atlas');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '50%');
      text.setAttribute('y', '50%');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', String(size * 0.88));
      text.setAttribute('font-family', NATIVE_EMOJI_FONTS.map((f) => `"${f}"`).join(','));
      text.textContent = emoji;
      svg.appendChild(text);
      return svg;
    }

    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', emoji);
    svg.setAttribute('class', className ?? 'emoji-atlas');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    // The viewBox crops the full-size atlas down to this one cell.
    svg.setAttribute('viewBox', `${cell.x} ${cell.y} ${cell.size} ${cell.size}`);

    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', src);
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(manifest.width));
    image.setAttribute('height', String(manifest.height));
    svg.appendChild(image);

    return svg;
  };

  const buildSpan = (emoji, size, className) => {
    const cell = cellFor(emoji);
    const el = document.createElement('span');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', emoji);
    el.className = className ?? 'emoji-atlas';

    if (!cell) {
      el.textContent = emoji;
      el.style.fontFamily = NATIVE_EMOJI_FONTS.map((f) => `"${f}"`).join(',');
      el.style.fontSize = `${size * 0.88}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      return el;
    }

    const scale = size / cell.size;
    el.style.display = 'inline-block';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.backgroundImage = `url("${src}")`;
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = `${manifest.width * scale}px ${manifest.height * scale}px`;
    el.style.backgroundPosition = `${-cell.x * scale}px ${-cell.y * scale}px`;
    return el;
  };

  const markup = (emoji, size = 28) => {
    const cell = cellFor(emoji);
    if (!cell) {
      return `<span class="emoji-atlas" role="img" aria-label="${escapeHtml(emoji)}" style="font-family:${NATIVE_EMOJI_FONTS.map((f) => `"${f}"`).join(',')};font-size:${size * 0.88}px">${escapeHtml(emoji)}</span>`;
    }
    return `<svg class="emoji-atlas" role="img" aria-label="${escapeHtml(emoji)}" width="${size}" height="${size}" viewBox="${cell.x} ${cell.y} ${cell.size} ${cell.size}"><image href="${escapeHtml(src)}" x="0" y="0" width="${manifest.width}" height="${manifest.height}"/></svg>`;
  };

  return {
    manifest,
    assetUrl: src,
    indexOf,
    cellFor,
    createSvg: buildSvg,
    createSpan: buildSpan,
    markup,
  };
}

/** Clears the module-level cache. Useful in tests. */
export function resetEmojiAtlasCache() {
  cached = null;
}

/**
 * Fills every element matching `selector` with emoji glyphs.
 *
 * Reads the emoji from each element's `data-emoji` attribute, so it composes
 * with static server-rendered markup.
 *
 * @param {EmojiAtlasRuntime} atlas
 * @param {ParentNode} [root]
 * @param {string} [selector]
 */
export function hydrateEmojiAtlas(atlas, root = document, selector = '[data-emoji]') {
  for (const el of root.querySelectorAll(selector)) {
    const emoji = el.getAttribute('data-emoji');
    if (!emoji) continue;
    const size = Number(el.dataset.emojiSize ?? el.getAttribute('data-emoji-size') ?? 28);
    el.replaceChildren(atlas.createSvg(emoji, size, el.className || undefined));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
