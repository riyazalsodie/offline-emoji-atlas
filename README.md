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
```

### 2. Declare the asset

```yaml
# pubspec.yaml
flutter:
  assets:
    - assets/emoji/
```

### 3. Copy the runtime

```bash
cp node_modules/flutter-emoji-atlas/dart/emoji_atlas.dart lib/widgets/
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
--out <dir>             Where to write the atlas.          (default required)
--dart-out <dir>        Where to write the manifest.       (default required)

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
