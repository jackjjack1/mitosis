import type { Artifact, Cloner, CloneOutput, Genome, ImageInfo, Rng } from "./types";
import { baseName, clamp, num, percent, round } from "./util";

const COLOR_STEPS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

interface Palette {
  colors: [number, number, number][];
  lut: Uint8Array;
}

interface Paint {
  score: number;
  canvas: HTMLCanvasElement;
  cloneWidth: number;
  cloneHeight: number;
  colors: number;
  scale: number;
  blur: number;
}

function nearestColorStep(value: number): number {
  let best = COLOR_STEPS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of COLOR_STEPS) {
    const distance = Math.abs(step - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }
  return best;
}

function medianCut(pixels: Uint8ClampedArray, maxColors: number): [number, number, number][] {
  const total = pixels.length / 4;
  const stride = Math.max(1, Math.floor(total / 24000));
  const points: [number, number, number][] = [];
  for (let i = 0; i < total; i += stride) {
    if (pixels[i * 4 + 3] < 12) continue;
    points.push([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
  }
  if (!points.length) points.push([8, 8, 8]);

  let boxes: [number, number, number][][] = [points];
  while (boxes.length < maxColors) {
    let bestBox = -1;
    let bestChannel = 0;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      let minR = 255;
      let maxR = 0;
      let minG = 255;
      let maxG = 0;
      let minB = 255;
      let maxB = 0;
      for (const point of box) {
        if (point[0] < minR) minR = point[0];
        if (point[0] > maxR) maxR = point[0];
        if (point[1] < minG) minG = point[1];
        if (point[1] > maxG) maxG = point[1];
        if (point[2] < minB) minB = point[2];
        if (point[2] > maxB) maxB = point[2];
      }
      const ranges = [maxR - minR, maxG - minG, maxB - minB];
      const channel = ranges.indexOf(Math.max(...ranges));
      const score = ranges[channel] * Math.log2(box.length + 1);
      if (score > bestScore) {
        bestScore = score;
        bestBox = i;
        bestChannel = channel;
      }
    }
    if (bestBox < 0) break;
    const box = boxes[bestBox];
    box.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(box.length / 2);
    boxes.splice(bestBox, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const point of box) {
      r += point[0];
      g += point[1];
      b += point[2];
    }
    return [
      Math.round(r / box.length),
      Math.round(g / box.length),
      Math.round(b / box.length),
    ];
  });
}

function buildPalette(pixels: Uint8ClampedArray, count: number): Palette {
  const colors = medianCut(pixels, count);
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const rr = r * 8 + 4;
        const gg = g * 8 + 4;
        const bb = b * 8 + 4;
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < colors.length; i++) {
          const dr = rr - colors[i][0];
          const dg = gg - colors[i][1];
          const db = bb - colors[i][2];
          const distance = dr * dr + dg * dg * 1.15 + db * db * 0.7;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
          }
        }
        lut[(r << 10) | (g << 5) | b] = bestIndex;
      }
    }
  }
  return { colors, lut };
}

function blurPass(data: Uint8ClampedArray, width: number, height: number): void {
  const source = new Uint8ClampedArray(data);
  const weights = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      let index = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          index += 3;
          continue;
        }
        for (let dx = -1; dx <= 1; dx++, index++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const p = (yy * width + xx) * 4;
          const w = weights[index];
          r += source[p] * w;
          g += source[p + 1] * w;
          b += source[p + 2] * w;
          total += w;
        }
      }
      const p = (y * width + x) * 4;
      data[p] = r / total;
      data[p + 1] = g / total;
      data[p + 2] = b / total;
    }
  }
}

export function createImageCloner(artifact: Artifact): Cloner {
  const info: ImageInfo = artifact.image as ImageInfo;
  const paletteCache = new Map<number, Palette>();
  const scoreCache = new Map<string, number>();

  const defaults: Genome = { colors: 4, scale: 0.3, blur: 0, gamma: 1 };

  function paletteFor(count: number): Palette {
    const existing = paletteCache.get(count);
    if (existing) return existing;
    const palette = buildPalette(info.pixels, count);
    paletteCache.set(count, palette);
    return palette;
  }

  function paint(genome: Genome): Paint {
    const colors = clamp(Math.round(num(genome, "colors", 16)), 2, 64);
    const scale = clamp(num(genome, "scale", 1), 0.08, 1);
    const blur = clamp(Math.round(num(genome, "blur", 0)), 0, 2);
    const gamma = clamp(num(genome, "gamma", 1), 0.85, 1.15);

    const cloneWidth = Math.max(2, Math.round(info.sampleWidth * scale));
    const cloneHeight = Math.max(2, Math.round(info.sampleHeight * scale));

    const small = document.createElement("canvas");
    small.width = cloneWidth;
    small.height = cloneHeight;
    const smallCtx = small.getContext("2d", { willReadFrequently: true });
    if (!smallCtx) throw new Error("2D canvas unavailable");
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = "high";
    smallCtx.drawImage(info.sourceCanvas, 0, 0, cloneWidth, cloneHeight);
    const scaled = smallCtx.getImageData(0, 0, cloneWidth, cloneHeight);
    const palette = paletteFor(colors);

    const gammaMap = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      gammaMap[i] = Math.round(255 * Math.pow(i / 255, gamma));
    }

    const mapped = smallCtx.createImageData(cloneWidth, cloneHeight);
    const data = scaled.data;
    const out = mapped.data;
    for (let p = 0; p < data.length; p += 4) {
      const alpha = data[p + 3];
      const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
      const color = palette.colors[palette.lut[key]];
      out[p] = gammaMap[color[0]];
      out[p + 1] = gammaMap[color[1]];
      out[p + 2] = gammaMap[color[2]];
      out[p + 3] = alpha;
    }

    for (let pass = 0; pass < blur; pass++) {
      blurPass(out, cloneWidth, cloneHeight);
    }
    smallCtx.putImageData(mapped, 0, 0);

    const big = document.createElement("canvas");
    big.width = info.sampleWidth;
    big.height = info.sampleHeight;
    const bigCtx = big.getContext("2d", { willReadFrequently: true });
    if (!bigCtx) throw new Error("2D canvas unavailable");
    bigCtx.imageSmoothingEnabled = true;
    bigCtx.imageSmoothingQuality = "high";
    bigCtx.drawImage(small, 0, 0, info.sampleWidth, info.sampleHeight);
    const cloneData = bigCtx.getImageData(0, 0, info.sampleWidth, info.sampleHeight).data;

    let difference = 0;
    for (let p = 0; p < cloneData.length; p += 4) {
      difference += Math.abs(cloneData[p] - info.pixels[p]);
      difference += Math.abs(cloneData[p + 1] - info.pixels[p + 1]);
      difference += Math.abs(cloneData[p + 2] - info.pixels[p + 2]);
      difference += Math.abs(cloneData[p + 3] - info.pixels[p + 3]);
    }
    const score = 1 - difference / (info.sampleWidth * info.sampleHeight * 4 * 255);
    return {
      score: round(clamp(score, 0, 1), 4),
      canvas: big,
      cloneWidth,
      cloneHeight,
      colors: palette.colors.length,
      scale,
      blur,
    };
  }

  const cacheKey = (genome: Genome) =>
    [
      Math.round(num(genome, "colors", 16)),
      num(genome, "scale", 1).toFixed(3),
      Math.round(num(genome, "blur", 0)),
      num(genome, "gamma", 1).toFixed(3),
    ].join("|");

  return {
    kind: "image",
    defaults,
    evaluate(genome) {
      const key = cacheKey(genome);
      const cached = scoreCache.get(key);
      if (cached !== undefined) return cached;
      const score = paint(genome).score;
      scoreCache.set(key, score);
      return score;
    },
    materialize(genome): CloneOutput {
      const result = paint(genome);
      return {
        score: result.score,
        dataUrl: result.canvas.toDataURL("image/png"),
        filename: `${baseName(artifact.name)}.clone.png`,
        mime: "image/png",
        facts: [
          { label: "PALETTE", value: `${result.colors} colors` },
          {
            label: "RENDER",
            value: `${result.cloneWidth}×${result.cloneHeight}`,
          },
          { label: "SAMPLE", value: `${info.sampleWidth}×${info.sampleHeight}` },
          { label: "SMOOTHING", value: `${result.blur} pass${result.blur === 1 ? "" : "es"}` },
        ],
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.52) {
        const current = nearestColorStep(num(genome, "colors", 16));
        const index = COLOR_STEPS.indexOf(current);
        const jump = rng() < 0.7 ? 1 : rng() < 0.9 ? 2 : -1;
        const updated = COLOR_STEPS[clamp(index + jump, 0, COLOR_STEPS.length - 1)];
        next.colors = updated;
        changed = `palette ${current} → ${updated}`;
      } else if (roll < 0.82) {
        const current = clamp(num(genome, "scale", 1), 0.08, 1);
        const updated = clamp(current + (rng() < 0.76 ? 0.08 : -0.05), 0.12, 1);
        next.scale = round(updated, 2);
        changed = `resolution ${Math.round(current * 100)}% → ${Math.round(updated * 100)}%`;
      } else if (roll < 0.92) {
        const current = clamp(Math.round(num(genome, "blur", 0)), 0, 2);
        const updated = (current + 1 + Math.floor(rng() * 2)) % 3;
        next.blur = updated;
        changed = `smoothing ${current} → ${updated}`;
      } else {
        const current = clamp(num(genome, "gamma", 1), 0.85, 1.15);
        const updated = clamp(current + (rng() < 0.5 ? 0.03 : -0.03), 0.85, 1.15);
        next.gamma = round(updated, 2);
        changed = `gamma ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      }
      return { genome: next, changed };
    },
    describe(genome: Genome) {
      const colors = clamp(Math.round(num(genome, "colors", 16)), 2, 64);
      const scale = clamp(num(genome, "scale", 1), 0.08, 1);
      const blur = clamp(Math.round(num(genome, "blur", 0)), 0, 2);
      const gamma = clamp(num(genome, "gamma", 1), 0.85, 1.15);
      return [
        {
          key: "colors",
          label: "PALETTE",
          value: `${colors} colors`,
          raw: colors,
          min: 2,
          max: 64,
        },
        {
          key: "scale",
          label: "RESOLUTION",
          value: `${Math.round(scale * 100)}%`,
          raw: scale,
          min: 0.08,
          max: 1,
        },
        {
          key: "blur",
          label: "SMOOTHING",
          value: blur === 0 ? "none" : `${blur} pass${blur === 1 ? "" : "es"}`,
          raw: blur,
          min: 0,
          max: 2,
        },
        {
          key: "gamma",
          label: "GAMMA",
          value: gamma.toFixed(2),
          raw: gamma,
          min: 0.85,
          max: 1.15,
        },
      ];
    },
    reflect(seed, best, baseline, score) {
      return `Selection pushed the palette from ${Math.round(seed.colors)} to ${Math.round(
        best.colors,
      )} colors and resolution from ${percent(seed.scale, 0)} to ${percent(
        best.scale,
        0,
      )}, gaining ${((score - baseline) * 100).toFixed(1)} points of pixel match. The image class now starts at this genome.`;
    },
  };
}
