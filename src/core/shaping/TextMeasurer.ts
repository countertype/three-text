import type { LoadedFont } from '../types';
import { convertFontFeaturesToString } from './fontFeatures';

export class TextMeasurer {
  // Shape once and return per-codepoint widths aligned with Array.from(text)
  // Groups glyph advances by HarfBuzz cluster (cl)
  // Includes trailing per-glyph letter spacing like measureTextWidth
  public static measureTextWidths(
    loadedFont: LoadedFont,
    text: string,
    letterSpacing: number = 0
  ): number[] {
    const chars = Array.from(text);
    if (chars.length === 0) return [];

    // HarfBuzz clusters are UTF-16 code unit indices
    const startToCharIndex = new Map<number, number>();
    let codeUnitIndex = 0;
    for (let i = 0; i < chars.length; i++) {
      startToCharIndex.set(codeUnitIndex, i);
      codeUnitIndex += chars[i].length;
    }

    const widths = new Array<number>(chars.length).fill(0);
    const buffer = loadedFont.hb.createBuffer();
    try {
      buffer.addText(text);
      buffer.guessSegmentProperties();

      const featuresString = convertFontFeaturesToString(
        loadedFont.fontFeatures
      );
      loadedFont.hb.shape(loadedFont.font, buffer, featuresString);

      const glyphInfos = buffer.json(loadedFont.font);
      const letterSpacingInFontUnits = letterSpacing * loadedFont.upem;

      for (let i = 0; i < glyphInfos.length; i++) {
        const glyph: any = glyphInfos[i];
        const cl: number = glyph.cl ?? 0;
        let charIndex = startToCharIndex.get(cl);

        // Fallback if cl lands mid-codepoint
        if (charIndex === undefined) {
          // Find the closest start <= cl
          for (let back = cl; back >= 0; back--) {
            const candidate = startToCharIndex.get(back);
            if (candidate !== undefined) {
              charIndex = candidate;
              break;
            }
          }
        }

        if (charIndex === undefined) continue;

        widths[charIndex] += glyph.ax;
        if (letterSpacingInFontUnits !== 0) {
          widths[charIndex] += letterSpacingInFontUnits;
        }
      }

      return widths;
    } finally {
      buffer.destroy();
    }
  }

  public static measureTextWidth(
    loadedFont: LoadedFont,
    text: string,
    letterSpacing: number = 0
  ): number {
    const buffer = loadedFont.hb.createBuffer();
    try {
      buffer.addText(text);
      buffer.guessSegmentProperties();

      const featuresString = convertFontFeaturesToString(
        loadedFont.fontFeatures
      );
      loadedFont.hb.shape(loadedFont.font, buffer, featuresString);

      const glyphInfos = buffer.json(loadedFont.font);
      const letterSpacingInFontUnits = letterSpacing * loadedFont.upem;

      let totalWidth = 0;
      for (let i = 0; i < glyphInfos.length; i++) {
        totalWidth += glyphInfos[i].ax;
      }
      totalWidth += letterSpacingInFontUnits * glyphInfos.length;

      return totalWidth;
    } finally {
      buffer.destroy();
    }
  }
}
