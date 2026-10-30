export function contractTint(contract: string) {
  let hash = 0;
  for (const character of contract.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 65% 55%)`;
}

export function dominantColour(pixels: Uint8ClampedArray): string | null {
  const bins = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  return dominant
    ? `rgb(${Math.round(dominant.r / dominant.count)} ${Math.round(dominant.g / dominant.count)} ${Math.round(dominant.b / dominant.count)})`
    : null;
}
