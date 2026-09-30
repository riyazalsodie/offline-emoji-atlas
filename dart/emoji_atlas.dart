import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'emoji_atlas_manifest.dart';

/// Loads a bundled emoji sprite sheet once and paints individual glyph cells out
/// of it, so a chat UI can render hundreds of emoji with **zero** network
/// requests and a single shared bitmap.
///
/// Replace per-glyph `Image.network` calls with [EmojiAtlasPainter].
class EmojiAtlas {
  EmojiAtlas._(this.image);

  final ui.Image image;

  static EmojiAtlas? _instance;
  static Future<EmojiAtlas>? _loading;

  /// Returns the atlas, decoding it on first use. Safe to call repeatedly;
  /// concurrent callers share a single in-flight load.
  static Future<EmojiAtlas> ensureLoaded() {
    final cached = _instance;
    if (cached != null) return Future<EmojiAtlas>.value(cached);
    return _loading ??= _load();
  }

  static Future<EmojiAtlas> _load() async {
    final data = await rootBundle.load(kEmojiAtlasAssetPath);
    final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
    final frame = await codec.getNextFrame();
    final atlas = EmojiAtlas._(frame.image);
    _instance = atlas;
    return atlas;
  }

  /// Cell index for [emoji], or null when it is not in the atlas.
  ///
  /// Callers should fall back to the platform's native colour emoji font so that
  /// an emoji typed from the OS keyboard (and therefore absent from the atlas)
  /// still renders instead of showing an empty box.
  static int? indexOf(String emoji) => kEmojiAtlasIndex[emoji];

  /// Source rectangle for a cell index within the atlas bitmap.
  static Rect sourceRect(int index) {
    final column = index % kEmojiAtlasColumns;
    final row = index ~/ kEmojiAtlasColumns;
    return Rect.fromLTWH(
      (column * kEmojiAtlasCell).toDouble(),
      (row * kEmojiAtlasCell).toDouble(),
      kEmojiAtlasCell.toDouble(),
      kEmojiAtlasCell.toDouble(),
    );
  }
}

/// Paints a single emoji glyph out of the atlas.
///
/// One shared [ui.Image] backs every painter, so memory stays flat no matter how
/// many emoji are on screen. This also avoids the `ImageCache` thrash that
/// hundreds of separate `Image` widgets cause.
class EmojiAtlasPainter extends CustomPainter {
  const EmojiAtlasPainter({
    required this.atlas,
    required this.index,
    this.quality = FilterQuality.medium,
  });

  final EmojiAtlas atlas;
  final int index;
  final FilterQuality quality;

  @override
  void paint(Canvas canvas, Size size) {
    final src = EmojiAtlas.sourceRect(index);
    // Defensive: a regenerated atlas with fewer glyphs must not paint garbage.
    if (src.left >= atlas.image.width || src.top >= atlas.image.height) return;

    canvas.drawImageRect(
      atlas.image,
      src,
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint()..filterQuality = quality,
    );
  }

  @override
  bool shouldRepaint(EmojiAtlasPainter oldDelegate) =>
      oldDelegate.index != index ||
      oldDelegate.atlas != atlas ||
      oldDelegate.quality != quality;
}

/// A ready-to-use emoji widget: paints from the atlas when available and
/// otherwise falls back to the platform's native colour emoji font.
///
/// ```dart
/// AtlasEmoji(emoji: '🔥', size: 28)
/// ```
class AtlasEmoji extends StatefulWidget {
  const AtlasEmoji({
    super.key,
    required this.emoji,
    this.size = 28,
    this.fallbackFontSize,
  });

  final String emoji;
  final double size;
  final double? fallbackFontSize;

  /// The native colour fonts to fall back to. Android ships Noto Color Emoji and
  /// iOS ships Apple Color Emoji, so this renders in full colour with no network.
  static const List<String> nativeEmojiFonts = <String>[
    'Apple Color Emoji',
    'Noto Color Emoji',
    'Segoe UI Emoji',
    'Android Emoji',
  ];

  @override
  State<AtlasEmoji> createState() => _AtlasEmojiState();
}

class _AtlasEmojiState extends State<AtlasEmoji> {
  EmojiAtlas? _atlas;
  int? _index;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  @override
  void didUpdateWidget(AtlasEmoji oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.emoji != widget.emoji) _resolve();
  }

  void _resolve() {
    final index = EmojiAtlas.indexOf(widget.emoji);
    if (index == null) {
      if (_index != null || _atlas != null) {
        setState(() {
          _index = null;
          _atlas = null;
        });
      }
      return;
    }

    EmojiAtlas.ensureLoaded().then((atlas) {
      if (!mounted) return;
      setState(() {
        _atlas = atlas;
        _index = index;
      });
    }).catchError((Object error) {
      // Missing asset or undecodable image: fall back to the native font rather
      // than rendering an empty box.
      debugPrint('[EmojiAtlas] Failed to load atlas: $error');
    });
  }

  @override
  Widget build(BuildContext context) {
    final atlas = _atlas;
    final index = _index;

    if (atlas != null && index != null) {
      return SizedBox(
        width: widget.size,
        height: widget.size,
        child: CustomPaint(
          painter: EmojiAtlasPainter(atlas: atlas, index: index),
        ),
      );
    }

    return Text(
      widget.emoji,
      style: TextStyle(
        fontSize: widget.fallbackFontSize ?? widget.size * 0.88,
        fontFamilyFallback: AtlasEmoji.nativeEmojiFonts,
      ),
    );
  }
}
