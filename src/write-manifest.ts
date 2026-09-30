import type { PackResult } from './pack-atlas.ts';

export interface ManifestOptions {
  atlas: PackResult;
  assetPath: string;
  fileName: string;
  className?: string;
}

/**
 * Emits the generated Dart manifest: emoji -> cell index, plus the geometry the
 * runtime needs. The asset path lives here too, so the Dart runtime itself stays
 * completely configuration-free.
 */
export function renderDartManifest({
  atlas,
  assetPath,
  fileName,
  className = 'EmojiAtlas',
}: ManifestOptions): string {
  const { columns, cellSize, width, height, extension } = atlas;
  const count = atlas.count;

  const lines: string[] = [];
  lines.push('// GENERATED FILE - DO NOT EDIT BY HAND.');
  lines.push('// Regenerate with: npx generate-emoji-atlas --picker <file.dart> ...');
  lines.push('//');
  lines.push(`// Maps each bundled emoji to its cell index inside ${assetPath}.`);
  lines.push('// Anything absent from this map is rendered with the platform emoji font.');
  lines.push('');
  lines.push(`/// Bundled asset path for the sprite sheet.`);
  lines.push(`const String k${className}AssetPath = '${assetPath}';`);
  lines.push('');
  lines.push(`/// Number of grid columns in the atlas image.`);
  lines.push(`const int k${className}Columns = ${columns};`);
  lines.push('');
  lines.push(`/// Edge length in pixels of one grid cell.`);
  lines.push(`const int k${className}Cell = ${cellSize};`);
  lines.push('');
  lines.push(`/// Full pixel width of the atlas image.`);
  lines.push(`const int k${className}ImageWidth = ${width};`);
  lines.push('');
  lines.push(`/// Full pixel height of the atlas image.`);
  lines.push(`const int k${className}ImageHeight = ${height};`);
  lines.push('');
  lines.push(`/// Total glyphs packed into the atlas.`);
  lines.push(`const int k${className}Count = ${count};`);
  lines.push('');
  lines.push(`/// Emoji to cell index.`);
  lines.push(`const Map<String, int> k${className}Index = <String, int>{`);

  for (let i = 0; i < count; i++) {
    const emoji = atlas.order[i];
    lines.push(`  '${escapeDartString(emoji)}': ${i},`);
  }

  lines.push('};');
  lines.push('');

  if (extension === 'webp') {
    lines.push('// This atlas was generated in WebP mode. Update the asset key in your');
    lines.push('// pubspec if you switch encoders.');
  }

  return lines.join('\n');
}

/** Escapes a Dart single-quoted string literal. */
function escapeDartString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$');
}
