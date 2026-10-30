const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function ogText(text: string) {
  return Array.from(graphemes.segment(text), ({ segment }) =>
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20e3]/u.test(segment) ? "" : segment,
  ).join("");
}
