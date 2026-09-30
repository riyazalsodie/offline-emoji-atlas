/**
 * Glyph fetching with an on-disk cache.
 *
 * Glyphs are only ever downloaded at build time. The generated atlas ships
 * inside the app, so the runtime performs zero network requests.
 */

import fs from 'fs';
import path from 'path';

export type SourceName = 'apple' | 'noto' | 'custom';

export interface SourceConfig {
  name: SourceName;
  /** Placeholders: {encoded} (URL-encoded emoji), {codepoints} (dash-joined hex). */
  urlTemplate?: string;
}

const SOURCES: Record<Exclude<SourceName, 'custom'>, string> = {
  apple: 'https://emojicdn.elk.sh/{encoded}?style=apple',
  noto: 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/emoji_u{codepoints}.png',
};

export const SOURCE_NOTES: Record<SourceName, string> = {
  apple:
    "Apple artwork served by the third-party emojicdn.elk.sh. Looks identical to iOS. NOTE: Apple's emoji are Apple Inc. property - bundling them in a distributed app is a licensing decision you must make yourself. The upstream service may also rate-limit or disappear.",
  noto:
    "Noto Color Emoji (SIL Open Font License 1.1), explicitly redistributable. Safe to ship, at the cost of not matching Apple's exact artwork.",
  custom:
    'Your own template. Placeholders: {encoded} = URL-encoded emoji, {codepoints} = dash-joined lowercase hex codepoints (variation selectors dropped).',
};

export function buildUrl(source: SourceConfig, emoji: string): string {
  const template = source.name === 'custom' ? source.urlTemplate : SOURCES[source.name];
  if (!template) {
    throw new Error(`--url-template is required when --source is "custom".`);
  }

  const codepoints = [...emoji]
    .map((c) => c.codePointAt(0)!)
    // Drop variation selectors; most sources do not want them in filenames.
    .filter((cp) => cp < 0xfe00 || cp > 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('-');

  return template
    .replaceAll('{encoded}', encodeURIComponent(emoji))
    .replaceAll('{codepoints}', codepoints);
}

export interface FetchOptions {
  source: SourceConfig;
  emojis: string[];
  cacheDir: string;
  concurrency?: number;
  retries?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Downloads every glyph (or reads it from the cache) and returns a map of
 * emoji -> raw image bytes. Emoji that fail on every attempt are omitted.
 */
export async function fetchGlyphs({
  source,
  emojis,
  cacheDir,
  concurrency = 16,
  retries = 3,
  onProgress,
}: FetchOptions): Promise<Map<string, Buffer>> {
  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheKey = (emoji: string) => {
    // Filename-safe: code points only, never raw emoji.
    const key = [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join('_');
    return path.join(cacheDir, `${key}.bin`);
  };

  const out = new Map<string, Buffer>();
  const failed: string[] = [];
  let cursor = 0;
  let done = 0;

  async function grab(emoji: string): Promise<void> {
    const cached = cacheKey(emoji);
    if (fs.existsSync(cached)) {
      out.set(emoji, fs.readFileSync(cached));
      return;
    }

    const url = buildUrl(source, emoji);
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) throw new Error('empty response');
        fs.writeFileSync(cached, buf);
        out.set(emoji, buf);
        return;
      } catch (err) {
        if (attempt === retries - 1) {
          failed.push(emoji);
          console.warn(`  ! failed ${JSON.stringify(emoji)} from ${source.name}: ${(err as Error).message}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < emojis.length) {
        await grab(emojis[cursor++]);
        done++;
        onProgress?.(done, emojis.length);
      }
    })
  );

  if (failed.length) {
    console.warn(
      `  ${failed.length} glyph(s) could not be fetched. They will fall back to the OS emoji font at runtime.`
    );
  }
  return out;
}
