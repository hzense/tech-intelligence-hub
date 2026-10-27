/** The dimensions are measured from the actual rendered, unrotated word buttons. */
export interface RadarCloudWord {
  id: string;
  width: number;
  height: number;
  weight: number;
}

export interface RadarCloudPlacement extends RadarCloudWord {
  /** Top-left coordinates and dimensions after the optional individual scale. */
  x: number;
  y: number;
  scale: number;
}

export interface RadarCloudLayout {
  width: number;
  height: number;
  placements: RadarCloudPlacement[];
}

export interface RadarCloudLayoutOptions {
  width: number;
  height?: number;
  gap?: number;
  padding?: number;
}

const epsilon = 0.000001;
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function pack(
  words: (RadarCloudWord & { scale: number })[],
  width: number,
  height: number,
  gap: number,
  padding: number,
): RadarCloudPlacement[] | undefined {
  const placed: RadarCloudPlacement[] = [];
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  for (const [index, word] of words.entries()) {
    const placeAt = (dx: number, dy: number): RadarCloudPlacement | undefined => {
      const x = (width - word.width) / 2 + dx;
      const y = (height - word.height) / 2 + dy;
      if (
        x < padding - epsilon ||
        y < padding - epsilon ||
        x + word.width > width - padding + epsilon ||
        y + word.height > height - padding + epsilon
      )
        return undefined;
      if (
        placed.some(
          (other) =>
            x < other.x + other.width + gap - epsilon &&
            x + word.width + gap > other.x + epsilon &&
            y < other.y + other.height + gap - epsilon &&
            y + word.height + gap > other.y + epsilon,
        )
      )
        return undefined;
      return { ...word, x: Math.max(padding, x), y: Math.max(padding, y) };
    };

    // The highest-weight word is the stable visual anchor, exactly in the centre.
    let placement = index === 0 ? placeAt(0, 0) : undefined;
    // A free rectangle can be reached by touching an already placed word.
    // Search those edges from the centre out instead of scanning every pixel.
    // Different text dimensions keep this a typographic cloud, not a cell grid.
    let bestRadius = Number.POSITIVE_INFINITY;
    const originX = (width - word.width) / 2;
    const originY = (height - word.height) / 2;
    for (const other of placed) {
      const xs = [
        other.x - gap - word.width,
        other.x,
        other.x + (other.width - word.width) / 2,
        other.x + other.width - word.width,
        other.x + other.width + gap,
      ];
      const ys = [
        other.y - gap - word.height,
        other.y,
        other.y + (other.height - word.height) / 2,
        other.y + other.height - word.height,
        other.y + other.height + gap,
      ];
      for (const [xi, x] of xs.entries()) {
        for (const [yi, y] of ys.entries()) {
          if (xi > 0 && xi < 4 && yi > 0 && yi < 4) continue;
          const dx = x - originX;
          const dy = y - originY;
          const radius = (dx / (usableWidth / 2)) ** 2 + (dy / (usableHeight / 2)) ** 2;
          if (
            radius > bestRadius + epsilon ||
            (Math.abs(radius - bestRadius) <= epsilon &&
              placement &&
              (y > placement.y || (y === placement.y && x >= placement.x)))
          )
            continue;
          const candidate = placeAt(dx, dy);
          if (candidate) {
            placement = candidate;
            bestRadius = radius;
          }
        }
      }
    }
    if (!placement) return undefined;
    placed.push(placement);
  }
  return placed;
}

/**
 * Deterministic, centre-outward packing for a real typographic cloud.
 * It grows the canvas instead of shrinking all text or dropping less-hot words.
 * `scale` only handles an individually over-wide label; the caller can instead
 * measure wrapped labels at its minimum readable font size before calling.
 */
export function layoutRadarCloud(
  words: readonly RadarCloudWord[],
  options: RadarCloudLayoutOptions,
): RadarCloudLayout {
  const { width, height: requestedHeight = 520, gap = 14, padding = 16 } = options;
  if (
    ![width, requestedHeight, gap, padding].every(Number.isFinite) ||
    width <= 0 ||
    requestedHeight <= 0 ||
    gap < 0 ||
    padding < 0 ||
    width <= padding * 2
  )
    throw new RangeError('Word cloud needs positive, finite dimensions and usable width.');
  const seen = new Set<string>();
  const usableWidth = width - padding * 2;
  const measured = words
    .filter((word) => {
      if (seen.has(word.id)) return false;
      seen.add(word.id);
      if (![word.width, word.height, word.weight].every(Number.isFinite))
        throw new RangeError('Word cloud measurements and weights must be finite.');
      if (word.width <= 0 || word.height <= 0)
        throw new RangeError('Word cloud measurements must be positive.');
      return true;
    })
    .map((word) => {
      const scale = Math.min(1, usableWidth / word.width);
      return { ...word, width: word.width * scale, height: word.height * scale, scale };
    })
    .sort((a, b) => b.weight - a.weight || compareId(a.id, b.id));
  if (!measured.length) return { width, height: requestedHeight, placements: [] };

  const area = measured.reduce((sum, word) => sum + (word.width + gap) * (word.height + gap), 0);
  let height = Math.ceil(
    Math.max(
      requestedHeight,
      ...measured.map((word) => word.height + padding * 2),
      (area * 1.5) / usableWidth + padding * 2,
    ),
  );
  // The upper bound can accommodate every word on the central vertical axis.
  // Repacking when height grows keeps the hottest word centred at every size.
  const maximumHeight = Math.max(
    height,
    measured.reduce((sum, word) => sum + 2 * (word.height + gap), 0) + padding * 2,
  );
  while (height <= maximumHeight) {
    const placements = pack(measured, width, height, gap, padding);
    if (placements) return { width, height, placements };
    if (height === maximumHeight) break;
    height = Math.min(maximumHeight, Math.ceil(height * 1.25));
  }
  // This should be unreachable for measured UI labels; fail explicitly instead
  // of silently hiding words or returning overlapping click targets.
  throw new RangeError('Unable to fit the measured words into the cloud.');
}
