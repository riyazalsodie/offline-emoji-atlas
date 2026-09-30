# flutter-emoji-atlas

**Stop downloading emoji one at a time.** Bundle them into a single sprite sheet
and get **zero** runtime network requests.

If your Flutter chat, comment box, or reaction picker renders emoji as
`Image.network('https://some-cdn/...')`, this is for you.

| | Before | After |
|---|---|---|
| Network requests to open a picker | 40–70 | **0** |
| Third-party CDN dependency | Yes, fragile | **None** |
| Extra APK size | 0 | ~2 MB (typically) |
| Image cache behaviour | Hundreds of images thrash `ImageCache` | One shared bitmap |

---

## The problem

The obvious way to get "real" emoji is to load each glyph as a small image from
a CDN. It works, but at scale it is a reliability problem, not a bandwidth one:

- **One request per glyph.** A picker showing 50 emoji opens 50 connections.
- **You don't own the endpoint.** If the CDN rate-limits, goes down, or changes
  its URL scheme, your emoji break instantly. No SLA, no monitoring, no fix.
- **`ImageCache` thrash.** Flutter's image cache is 1000 entries / 100 MB. With
  several hundred unique emoji, entries evict each other — so *re-opening the
  picker re-downloads everything*.
- **It can be in your TextField too.** If your input field renders emoji
  inline, those fire on **every keystroke**.

The instinct is to "just bundle an emoji font". That is a trap. See below.

---

## Why bundling a font does not work (and doesn't matter)

The obvious fix: ship a `NotoColorEmoji.ttf` (or Apple's) as an asset and let
Flutter render emoji as text. No network. Except:

| Problem | Detail |
|---|---|
| [flutter#119536](https://github.com/flutter/flutter/issues/119536) | Emoji **inside a `TextField`** do not render with a bundled colour font: *"entering emojis into a TextField does not work as expected"* |
| [flutter#134897](https://github.com/flutter/flutter/issues/134897) | The `COLRv1` build — the only one that works on Android — is **broken on iOS**. Still open. |
| Size | Noto Color Emoji is **~22 MB**. Per APK. |

### The part people miss

**If your app renders emoji as widgets, not font glyphs, none of that applies
to you.** Both Flutter bugs only affect the *font glyph* path.

A very common pattern — including in codebases that already fixed this problem —
is to render emoji as small widgets everywhere, including inside a `TextField`
via `WidgetSpan`:

```dart
// Emoji inside an input field, as a widget - NOT a font glyph
TextSpan(children: [
  TextSpan(text: 'hello '),
  WidgetSpan(child: MyEmojiWidget(emoji: '🔥', size: 20)),
]);
```

If that's your setup, bundling a font is solving a problem you don't have — for
22 MB, and broken on iOS.

**So: keep rendering emoji as widgets, and just change where the image comes
from.** That's the whole idea.

---

## How it works

1. The generator **parses emoji string literals straight out of your Dart
   source**, so the atlas can never drift out of sync with your UI.
2. It downloads each glyph **once, at build time**, and packs them into a single
   grid image (a *sprite sheet*).
3. Your app ships that one image and paints individual cells out of it with
   `canvas.drawImageRect`.

```
┌────┬────┬────┬────┬────┬────┐
│ 😀 │ 😃 │ 😄 │ 😁 │ 😅 │ 🤣 │   ← each box is one 96×96 "cell"
├────┼────┼────┼────┼────┼────┤
│ 😂 │ 🙂 │ 🙃 │ 😉 │ 😊 │ 😇 │
└────┴────┴────┴────┴────┴────┘
  32 columns × N rows
```

Because there is exactly **one** decoded `ui.Image` shared by every painter,
memory stays flat no matter how many emoji are on screen.

---

## Install

```bash
npm install flutter-emoji-atlas
# sharp is the only dependency (image compositing)
```

Or clone it and run the CLI directly — it needs no install step.

---

## Usage

### 1. Generate the atlas

```bash
npx generate-emoji-atlas \
  --picker lib/widgets/chat_emoji_picker.dart \
  --out assets/emoji \
  --dart-out lib/widgets
```

Produces:

```
assets/emoji/emoji_atlas.png          ← the sprite sheet
lib/widgets/emoji_atlas_manifest.dart ← generated: emoji -> cell index
assets/emoji/emoji_atlas.json         ← the universal manifest
```

For a web project, `--emit json` alone is enough and `--dart-out` is not needed:

```bash
npx generate-emoji-atlas \
  --picker src/emoji-picker.ts \
  --out public/emoji \
  --emit json
```

### 2. Declare the asset

```yaml
# pubspec.yaml
flutter:
  assets:
    - assets/emoji/
```

On the web, just keep the PNG and JSON next to your HTML.

### 3. Copy the runtime

```bash
cp node_modules/flutter-emoji-atlas/dart/emoji_atlas.dart lib/widgets/
# or
cp node_modules/flutter-emoji-atlas/runtime/web/emoji-atlas.js public/
```

### 4. Replace `Image.network`

Before:

```dart
Image.network('https://cdn.example/${Uri.encodeComponent(emoji)}?style=apple')
```

After:

```dart
AtlasEmoji(emoji: emoji, size: 28)   // drop-in
```

Or paint cells yourself:

```dart
final index = EmojiAtlas.indexOf('🔥');
if (index != null) {
  CustomPaint(
    painter: EmojiAtlasPainter(atlas: atlas, index: index),
    size: Size.square(28),
  );
}
```

---

## Tofu is impossible

If an emoji **isn't** in the atlas — e.g. a user types one from their phone
keyboard that your picker never offered — `AtlasEmoji` falls back to the
platform's native colour emoji font:

```dart
fontFamilyFallback: ['Apple Color Emoji', 'Noto Color Emoji', ...]
```

Android ships Noto Color Emoji and iOS ships Apple Color Emoji, so the fallback
renders in full colour with no network. **Either the atlas has it, or the OS
renders it.** You can never end up with an empty box.

---

## Options

```
--picker <file.dart>    Dart file with emoji literals. Repeatable for multiple apps.
--out <dir>             Where to write the atlas.           (required)
--emit <formats>        dart | json | both.                 default both
--dart-out <dir>        Where to write the Dart manifest.   (required if dart)
--json-out <dir>        Where to write the JSON manifest.   (default: --out)

--cell <px>             Cell size.              default 96
--columns <n>           Grid width.             default 32
--mode <m>              lossless | palette | webp          default lossless
--colours <n>           Palette colours.        default 128
--dither <0..1>         Palette dither.         default 0
--webp-quality <n>      WebP quality.           default 85
--source <s>            apple | noto | custom              default apple
--url-template <tpl>    For --source custom: {encoded}, {codepoints}
--region-start <s>      Only scan text after this marker
--region-end <s>        Only scan text before this marker
--manifest-name <f>     default emoji_atlas_manifest.dart
--class-name <n>        Dart class prefix.      default EmojiAtlas
--cache-dir <dir>       Glyph cache.            default .emoji-cache
```

### Encoder trade-offs

Measured on 935 glyphs at 96px cells:

| Mode | Size | Notes |
|---|---|---|
| **`lossless`** | **2060 KB** | **Default. Pixel-identical to source.** |
| `palette` (256) | 1820 KB | Visually identical, saves only 240 KB |
| `palette` (128) | 789 KB | **Visible speckling** on soft gradients |
| `webp` q85 | 2804 KB | Lossy and the largest |

`lossless` is the default on purpose: 2 MB is a rounding error on a mobile app,
while speckly emoji are visible to every single user. If you want the smaller
option:

```bash
npx generate-emoji-atlas ... --mode palette --colours 128
```

`--mode palette` shrinks to roughly 789 KB but produces noticeable grain on
Apple's gradient-heavy glyphs. Look at the output before you ship it.

### Scoping to just your picker tables

If your file has unrelated emoji literals (labels, test fixtures), narrow the
scan:

```bash
npx generate-emoji-atlas \
  --picker lib/widgets/chat_emoji_picker.dart \
  --region-start 'static const List<_EmojiCategory> _categories' \
  --region-end '];' \
  --out assets/emoji --dart-out lib/widgets
```

---

## Runtimes

The **generator is universal.** It emits a sprite sheet (a plain PNG) plus a plain
**JSON manifest** — both framework-agnostic. Only the ~100-line renderer that
draws a cell is platform-specific, and any language can write one in about 20
lines from the manifest.

### JSON manifest (the canonical format)

```json
{
  "asset": "assets/emoji/emoji_atlas.png",
  "fileName": "emoji_atlas.png",
  "columns": 32,
  "cellSize": 96,
  "width": 3072,
  "height": 2688,
  "count": 887,
  "index": { "😀": 0, "😃": 1 }
}
```

To crop cell `i`: `x = (i % columns) * cellSize`, `y = floor(i / columns) * cellSize`.

### Included

| Runtime | Path | Status |
|---|---|---|
| **Flutter / Dart** | `dart/emoji_atlas.dart` | Verified — `flutter analyze` clean, glyph mapping checked |
| **Web (any framework)** | `runtime/web/emoji-atlas.js` | Verified — SVG crop math and fallback checked; see `runtime/web/index.html` for a runnable demo |

The web runtime is dependency-free ES module and only touches the DOM, so it
works unchanged in vanilla JS, React, Vue, Svelte, Angular and Astro. Two
strategies:

```js
import { loadEmojiAtlas } from './emoji-atlas.js';

const atlas = await loadEmojiAtlas('./emoji_atlas.json');

el.appendChild(atlas.createSvg('🔥', 28));   // inline SVG, scales for free
el.appendChild(atlas.createSpan('🔥', 28));  // CSS background-position
el.innerHTML = atlas.markup('🔥', 28);       // for templating

// Server-rendered markup: <span data-emoji="🔥" data-emoji-size="28">
hydrateEmojiAtlas(atlas, document);
```

The SVG strategy is the default because an `<svg viewBox>` performs the cropping
and scaling natively — no CSS, no JS on the hot path:

```html
<svg width="28" height="28" viewBox="96 0 96 96">
  <image href="emoji_atlas.png" width="3072" height="2688" />
</svg>
```

### Writing your own runtime

The manifest is all you need. For example in Kotlin:

```kotlin
val i = manifest.index[emoji] ?: return  // fall back to system font
val left = (i % manifest.columns) * manifest.cellSize
val top  = (i / manifest.columns) * manifest.cellSize
canvas.drawBitmap(bitmap, Rect(left, top, left + cell, top + cell),
                  RectF(0f, 0f, size, size), paint)
```

Roughly equivalent shapes work for Swift (`CGContext` clip + `draw(in:from:)`),
Unity (its native Sprite Atlas importer reads the same grid), .NET MAUI, and
anything else with a 2D drawing API.

> React Native has no built-in sprite primitive, so it needs `react-native-svg` or
> a small native module. It is deliberately not included here — shipping an
> adapter I cannot run would be worse than not shipping one.

---

## ⚠️ Artwork licensing — read this

**This repo ships no emoji artwork and no prebuilt atlas.** The generator fetches
glyphs from whichever source you configure, at your build time.

| Source | Licence | Safe to bundle in a shipped app? |
|---|---|---|
| `--source apple` (default) | Apple artwork. Third-party CDN (`emojicdn.elk.sh`). | **Your call.** Apple Color Emoji is Apple's property and is *not* licensed for third-party redistribution. Also note the upstream service may rate-limit or disappear. |
| `--source noto` | SIL Open Font License 1.1 | **Yes.** Explicitly redistributable. Different artwork. |
| `--source custom` | Whatever you point at | Depends on your source |

If you want a clearly safe default, use `--source noto`.

---

## Tips

- **Cache your glyphs.** Downloads are cached in `.emoji-cache/` (gitignored),
  so re-packing after adding emoji takes seconds instead of minutes.
- **Regenerate on picker changes.** Since the manifest is derived from your Dart
  source, treat it like a build artifact: re-run the generator whenever you add
  or remove emoji.
- **Consider Git LFS** for the atlas if you regenerate often — each rebuild is a
  new binary blob, and history never forgets. Note that identical files are
  content-addressed, so if two packages share the atlas you only pay for one.
- **Verify before shipping.** Render a strip of emoji straight out of the
  manifest and confirm the index→cell mapping lines up. It's a one-line check
  that catches a mis-sorted manifest immediately.

---

## How the numbers in this README were measured

They come from a real production codebase (a Flutter chat with ~935 emoji across
9 picker categories, 2 apps). Encoder sizes were measured against the actual
pipeline with `sharp`, and the three PNG/WebP variants were rendered side by
side and compared visually — the 789 KB option was rejected because speckling
was clearly visible on the gradient-heavy glyphs, which a size table alone would
not have revealed.

## License

MIT — see [LICENSE](LICENSE), including the artwork note.
