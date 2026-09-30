export type EmojiAtlasManifest = {
  asset: string;
  fileName: string;
  columns: number;
  cellSize: number;
  width: number;
  height: number;
  count: number;
  index: Record<string, number>;
};

export type EmojiCell = {
  x: number;
  y: number;
  size: number;
};

export type EmojiAtlasRuntime = {
  manifest: EmojiAtlasManifest;
  assetUrl: string;
  indexOf(emoji: string): number | undefined;
  cellFor(emoji: string): EmojiCell | undefined;
  createSvg(emoji: string, size?: number, className?: string): SVGElement;
  createSpan(emoji: string, size?: number, className?: string): HTMLSpanElement;
  markup(emoji: string, size?: number): string;
};

export declare function loadEmojiAtlas(manifestUrl: string): Promise<EmojiAtlasRuntime>;
export declare function createEmojiAtlas(
  manifest: EmojiAtlasManifest,
  assetUrl?: string
): EmojiAtlasRuntime;
export declare function resetEmojiAtlasCache(): void;
export declare function hydrateEmojiAtlas(
  atlas: EmojiAtlasRuntime,
  root?: ParentNode,
  selector?: string
): void;
export declare const NATIVE_EMOJI_FONTS: string[];
