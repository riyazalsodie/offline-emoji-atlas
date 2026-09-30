// Integration example: replacing per-glyph Image.network with the atlas.
//
//   1. npx generate-emoji-atlas \
//        --picker lib/widgets/emoji_picker.dart \
//        --out assets/emoji --dart-out lib/widgets
//   2. declare `assets/emoji/` under `flutter: assets:` in pubspec.yaml
//   3. copy dart/emoji_atlas.dart into lib/widgets/
//
// Emoji typed from the OS keyboard (and therefore not in the atlas) fall back to
// the platform's native colour emoji font, so tofu is impossible.

import 'package:flutter/material.dart';

// Adjust this import to wherever you copied emoji_atlas.dart, e.g.
//   import 'package:my_app/widgets/emoji_atlas.dart';
import '../dart/emoji_atlas.dart';

/// Option A - drop-in. Use this everywhere you previously used Image.network.
class PickerGrid extends StatelessWidget {
  const PickerGrid({super.key, required this.emojis, this.onSelected});

  final List<String> emojis;
  final void Function(String emoji)? onSelected;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7),
      itemCount: emojis.length,
      itemBuilder: (context, i) => InkWell(
        onTap: () => onSelected?.call(emojis[i]),
        child: AtlasEmoji(emoji: emojis[i], size: 28),
      ),
    );
  }
}

/// Option B - paint cells yourself, e.g. when you need a CustomPaint for effects.
class PaintedGlyph extends StatelessWidget {
  const PaintedGlyph({super.key, required this.emoji, this.size = 28});

  final String emoji;
  final double size;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<EmojiAtlas>(
      // ensureLoaded() dedupes, so many concurrent callers decode only once.
      future: EmojiAtlas.ensureLoaded(),
      builder: (context, snap) {
        final atlas = snap.data;
        final index = EmojiAtlas.indexOf(emoji);

        if (atlas == null || index == null) {
          return Text(
            emoji,
            style: const TextStyle(fontFamilyFallback: AtlasEmoji.nativeEmojiFonts),
          );
        }
        return SizedBox(
          width: size,
          height: size,
          child: CustomPaint(painter: EmojiAtlasPainter(atlas: atlas, index: index)),
        );
      },
    );
  }
}

/// Option C - emoji inside a TextField, as WidgetSpans.
///
/// This is the pattern that makes bundled colour *fonts* unnecessary: emoji are
/// widgets, not font glyphs, so neither flutter#119536 nor flutter#134897
/// applies.
class EmojiEditingController extends TextEditingController {
  EmojiEditingController({super.text});

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final spans = <InlineSpan>[];
    final buffer = StringBuffer();
    final emojiSize = (style?.fontSize ?? 14.5) * 1.35;

    for (final char in text.characters) {
      if (_isEmoji(char)) {
        if (buffer.isNotEmpty) {
          spans.add(TextSpan(text: buffer.toString(), style: style));
          buffer.clear();
        }
        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: AtlasEmoji(emoji: char, size: emojiSize),
        ));
      } else {
        buffer.write(char);
      }
    }
    if (buffer.isNotEmpty) {
      spans.add(TextSpan(text: buffer.toString(), style: style));
    }
    return TextSpan(children: spans, style: style);
  }

  static bool _isEmoji(String char) {
    for (final rune in char.runes) {
      if (rune >= 0x1F300 && rune <= 0x1FAFF) return true;
      if (rune >= 0x2600 && rune <= 0x27BF) return true;
      if (rune >= 0x2B00 && rune <= 0x2BFF) return true;
      if (rune == 0x200D) return true;
      if (rune >= 0xFE00 && rune <= 0xFE0F) return true;
    }
    return false;
  }
}
