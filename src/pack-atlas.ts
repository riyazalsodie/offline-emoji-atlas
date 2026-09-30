import sharp from 'sharp';

export type EncodeMode = 'lossless' | 'palette' | 'webp';

export interface PackOptions {
  glyphs: Map<string, Buffer>;
  cellSize: number;
  columns: number;
  mode: EncodeMode;
  colours?: number;
  dither?: number;
  webpQuality?: number;
}

export interface PackResult {
  buffer: Buffer;
  extension: 'png' | 'webp';
  columns: number;
  rows: number;
  width: number;
  height: number;
  cellSize: number;
  /** Emoji in cell-index order. `order[i]` is the emoji painted at cell `i`. */
  order: string[];
  count: number;
}

/**
 * Normalises every glyph into an identical transparent cell and composites them
 * into a single grid image.
 *
 * Encoder trade-offs (measured on ~935 Apple glyphs at 96px cells):
 *   lossless  2060 KB  visually identical to source  <- default
 *   palette256 1820 KB  visually identical, saves 240KB
 *   palette128  789 KB  visible speckling on soft gradients
 *   webp q85   2804 KB  lossy and largest
 *
 * "lossless" is the default because 2MB is a rounding error on a mobile app
 * while speckly emoji are visible to every user.
 */
export async function packAtlas({
  glyphs,
  cellSize,
  columns,
  mode,
  colours = 128,
  dither = 0,
  webpQuality = 85,
}: PackOptions): Promise<PackResult> {
  const entries = [...glyphs.keys()];
  if (entries.length === 0) throw new Error('No glyphs to pack.');

  const rows = Math.ceil(entries.length / columns);
  const width = columns * cellSize;
  const height = rows * cellSize;

  const tiles: sharp.OverlayOptions[] = [];
  for (let i = 0; i < entries.length; i++) {
    const normalised = await sharp(glyphs.get(entries[i])!)
      .resize(cellSize, cellSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    tiles.push({
      input: normalised,
      left: (i % columns) * cellSize,
      top: Math.floor(i / columns) * cellSize,
    });
  }

  const pipeline = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(tiles);

  let buffer: Buffer;
  let extension: 'png' | 'webp';

  switch (mode) {
    case 'palette':
      buffer = await pipeline
        .png({ palette: true, colours, quality: 90, effort: 9, dither })
        .toBuffer();
      extension = 'png';
      break;
    case 'webp':
      buffer = await pipeline.webp({ quality: webpQuality, alphaQuality: 100, effort: 6 }).toBuffer();
      extension = 'webp';
      break;
    default:
      buffer = await pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer();
      extension = 'png';
  }

  return { buffer, extension, columns, rows, width, height, cellSize, order: entries, count: entries.length };
}
