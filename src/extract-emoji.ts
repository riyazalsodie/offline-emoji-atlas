/**
 * Extracts emoji literals from Dart source.
 *
 * The generator deliberately reads the emoji straight out of your picker file
 * rather than shipping a hardcoded list, so the atlas can never drift out of
 * sync with the UI.
 */

/** True when the string contains at least one emoji-ish codepoint. */
export function containsEmoji(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1f000 && cp <= 0x1faff) return true;
    if (cp >= 0x2600 && cp <= 0x27bf) return true;
    if (cp >= 0x2b00 && cp <= 0x2bff) return true;
  }
  return false;
}

/** True when the string is *only* emoji (plus selectors / ZWJ joins). */
export function isEmojiOnly(value: string): boolean {
  if (!containsEmoji(value)) return false;
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    const isEmoji = (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);
    const isJoiner = cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f);
    if (!isEmoji && !isJoiner) return false;
  }
  return true;
}

/**
 * Pull every emoji-only string literal out of a Dart file.
 *
 * `region` optionally restricts the scan to the text between two markers, which
 * keeps unrelated literals (labels, asset paths, URLs) from leaking in.
 */
export function extractEmojiFromDart(source: string, region?: { start: string; end: string }): string[] {
  let text = source;

  if (region) {
    const start = source.indexOf(region.start);
    if (start === -1) {
      throw new Error(`Region start marker not found: ${JSON.stringify(region.start)}`);
    }
    const end = source.indexOf(region.end, start);
    if (end === -1) {
      throw new Error(`Region end marker not found: ${JSON.stringify(region.end)}`);
    }
    text = source.slice(start, end);
  }

  const found: string[] = [];
  // Single- and double-quoted Dart string literals without escapes.
  for (const match of text.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
    const literal = match[1] ?? match[2];
    if (literal && isEmojiOnly(literal)) found.push(literal);
  }
  return found;
}
