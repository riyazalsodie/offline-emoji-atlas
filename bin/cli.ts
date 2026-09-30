#!/usr/bin/env node
/**
 * generate-emoji-atlas
 *
 * Bundles your emoji into a single sprite sheet so the running app performs
 * zero network requests, instead of fetching every glyph from a CDN at runtime.
 *
 *   npx generate-emoji-atlas \
 *     --picker lib/widgets/chat_emoji_picker.dart \
 *     --out assets/emoji \
 *     --dart-out lib/widgets
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractEmojiFromDart } from '../src/extract-emoji.ts';
import { fetchGlyphs, SOURCE_NOTES, type SourceName } from '../src/fetch-glyphs.ts';
import { packAtlas, type EncodeMode } from '../src/pack-atlas.ts';
import { renderDartManifest } from '../src/write-manifest.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Args {
  pickers: string[];
  out: string;
  dartOut: string;
  cellSize: number;
  columns: number;
  mode: EncodeMode;
  colours: number;
  dither: number;
  webpQuality: number;
  source: SourceName;
  urlTemplate?: string;
  regionStart?: string;
  regionEnd?: string;
  manifestName: string;
  className: string;
  cacheDir: string;
  force: boolean;
}

const USAGE = `
generate-emoji-atlas - bundle emoji into one sprite sheet (zero runtime HTTP requests)

Usage:
  generate-emoji-atlas --picker <file.dart> [more.dart...] --out <dir> --dart-out <dir> [options]

Required:
  --picker <file>        Dart file containing emoji string literals. Repeatable.
  --out <dir>            Where to write emoji_atlas.<png|webp>  (e.g. assets/emoji)
  --dart-out <dir>       Where to write the generated manifest  (e.g. lib/widgets)

Optional:
  --cell <px>            Cell size in the grid. Default 96.
  --columns <n>          Grid width. Default 32.
  --mode <m>             lossless (default) | palette | webp
  --colours <n>          Palette mode colours. Default 128.
  --dither <0..1>        Palette mode dither. Default 0.
  --webp-quality <n>     WebP quality. Default 85.
  --source <s>           apple (default) | noto | custom
  --url-template <tpl>   Required for --source custom. Use {encoded} and {codepoints}.
  --region-start <s>     Only scan text after this marker.
  --region-end <s>       Only scan text before this marker.
  --manifest-name <f>    Manifest filename. Default emoji_atlas_manifest.dart
  --class-name <n>       Dart class prefix. Default EmojiAtlas
  --cache-dir <dir>      Glyph cache. Default .emoji-cache
  --force                Rebuild even if the atlas looks up to date
  -h, --help             Show this help

After generating:
  1. Declare the asset in pubspec.yaml under "assets:"
  2. Copy dart/emoji_atlas.dart into your project
  3. Paint glyphs with EmojiAtlasPainter instead of Image.network
`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    pickers: [],
    out: '',
    dartOut: '',
    cellSize: 96,
    columns: 32,
    mode: 'lossless',
    colours: 128,
    dither: 0,
    webpQuality: 85,
    source: 'apple',
    manifestName: 'emoji_atlas_manifest.dart',
    className: 'EmojiAtlas',
    cacheDir: '.emoji-cache',
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value.`);
      return value;
    };

    switch (arg) {
      case '--picker': args.pickers.push(next()); break;
      case '--out': args.out = next(); break;
      case '--dart-out': args.dartOut = next(); break;
      case '--cell': args.cellSize = parseInt(next(), 10); break;
      case '--columns': args.columns = parseInt(next(), 10); break;
      case '--mode': args.mode = next() as EncodeMode; break;
      case '--colours': args.colours = parseInt(next(), 10); break;
      case '--dither': args.dither = parseFloat(next()); break;
      case '--webp-quality': args.webpQuality = parseInt(next(), 10); break;
      case '--source': args.source = next() as SourceName; break;
      case '--url-template': args.urlTemplate = next(); break;
      case '--region-start': args.regionStart = next(); break;
      case '--region-end': args.regionEnd = next(); break;
      case '--manifest-name': args.manifestName = next(); break;
      case '--class-name': args.className = next(); break;
      case '--cache-dir': args.cacheDir = next(); break;
      case '--force': args.force = true; break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\nRun with --help for usage.`);
    }
  }

  if (args.pickers.length === 0) throw new Error('At least one --picker is required.');
  if (!args.out) throw new Error('--out is required.');
  if (!args.dartOut) throw new Error('--dart-out is required.');
  if (args.source === 'custom' && !args.urlTemplate) {
    throw new Error('--url-template is required when --source is "custom".');
  }
  if (args.regionStart && !args.regionEnd) {
    throw new Error('--region-start also needs --region-end.');
  }
  if (Number.isNaN(args.cellSize) || args.cellSize < 16) throw new Error('--cell must be >= 16.');
  if (Number.isNaN(args.columns) || args.columns < 1) throw new Error('--columns must be >= 1.');

  return args;
}

function copyRuntime(): void {
  const src = path.join(HERE, '..', 'dart', 'emoji_atlas.dart');
  console.log(`\nRuntime widget: ${src}`);
  console.log('Copy it into your project, e.g.:');
  console.log(`  cp ${path.basename(src)} <your-pkg>/lib/widgets/`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('generate-emoji-atlas');
  console.log(`  source        : ${args.source}`);
  console.log(`  cell / columns: ${args.cellSize}px x ${args.columns}`);
  console.log(`  mode          : ${args.mode}`);
  console.log(`  cache         : ${args.cacheDir}\n`);
  console.log(`  ${SOURCE_NOTES[args.source]}\n`);

  // 1. Collect emoji from every picker file.
  const seen = new Set<string>();
  for (const picker of args.pickers) {
    if (!fs.existsSync(picker)) throw new Error(`Picker not found: ${picker}`);
    const source = fs.readFileSync(picker, 'utf8');
    const region =
      args.regionStart && args.regionEnd
        ? { start: args.regionStart, end: args.regionEnd }
        : undefined;
    const found = extractEmojiFromDart(source, region);
    for (const emoji of found) seen.add(emoji);
    console.log(`  ${picker} -> ${found.length} emoji literals`);
  }

  const emojis = [...seen];
  if (emojis.length === 0) throw new Error('No emoji found. Use --region-start/--region-end if the file has unrelated literals.');
  console.log(`\n  ${emojis.length} unique emoji total.`);

  // 2. Fetch glyphs (build time only).
  console.log('\nFetching glyphs...');
  const glyphs = await fetchGlyphs({
    source: { name: args.source, urlTemplate: args.urlTemplate },
    emojis,
    cacheDir: args.cacheDir,
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) console.log(`  ... ${done}/${total}`);
    },
  });
  console.log(`  ${glyphs.size} glyphs ready.`);

  // 3. Pack.
  const atlas = await packAtlas({
    glyphs,
    cellSize: args.cellSize,
    columns: args.columns,
    mode: args.mode,
    colours: args.colours,
    dither: args.dither,
    webpQuality: args.webpQuality,
  });
  const fileName = `emoji_atlas.${atlas.extension}`;
  console.log(
    `\nAtlas: ${atlas.width}x${atlas.height} (${atlas.columns}x${atlas.rows} cells) ` +
      `-> ${(atlas.buffer.length / 1024).toFixed(0)} KB`
  );

  // 4. Write outputs.
  fs.mkdirSync(args.out, { recursive: true });
  fs.mkdirSync(args.dartOut, { recursive: true });

  const assetPath = `${args.out.replace(/\\/g, '/').replace(/\/+$/, '')}/${fileName}`;
  fs.writeFileSync(path.join(args.out, fileName), atlas.buffer);

  const manifest = renderDartManifest({
    atlas,
    assetPath,
    fileName,
    className: args.className,
  });
  fs.writeFileSync(path.join(args.dartOut, args.manifestName), manifest);

  console.log(`\nWrote ${path.join(args.out, fileName)}`);
  console.log(`Wrote ${path.join(args.dartOut, args.manifestName)}`);

  console.log('\nNext steps:');
  console.log(`  1. pubspec.yaml -> assets:`);
  console.log(`       - ${args.out.replace(/\\/g, '/').replace(/\/+$/, '')}/`);
  console.log(`  2. Copy dart/emoji_atlas.dart into your package.`);
  console.log(`  3. Replace Image.network with EmojiAtlasPainter (see README).`);
  console.log('\nAnything not in the manifest falls back to the OS emoji font, so tofu is impossible.');
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
