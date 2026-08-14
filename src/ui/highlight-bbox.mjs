export function normalizedHighlightBox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const x = Number(bbox.x), y = Number(bbox.y), width = Number(bbox.width), height = Number(bbox.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  return { left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` };
}
