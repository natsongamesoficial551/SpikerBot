// Monochrome shapes of the YouTube subscription bell at a common scale.
const outline = [
  '.......#####......',
  '.....#########....',
  '...###########....',
  '...####...#####...',
  '..####......###...',
  '..###........###..',
  '..###........###..',
  '..###........###..',
  '..###........###..',
  '..###........###..',
  '..###........###..',
  '..###........###..',
  '.###.........####.',
  '.###..........###.',
  '###...........####',
  '##################',
  '##################',
  '.################.',
  '.....########.....',
  '.....#######......',
  '......######......',
];
const solid = outline.map(row => row.replace(/#.*#/, span => '#'.repeat(span.length)));
const templates = [outline, solid].flatMap(shape =>
  [shape, shape.slice(0, 18)].map(rows => rows.map(row => [...row].map(pixel => Number(pixel === '#'))))
);

function bellScore(mask, stride, box, template) {
  let overlap = 0;
  let union = 0;
  for (let y = 0; y < template.length; y++) {
    const offset = (box.y0 + Math.floor((y + 0.5) * box.height / template.length)) * stride + box.x0;
    for (let x = 0; x < template[y].length; x++) {
      const pixel = mask[offset + Math.floor((x + 0.5) * box.width / template[y].length)];
      const expected = template[y][x];
      overlap += pixel & expected;
      union += pixel | expected;
    }
  }
  return overlap / union;
}

function hasNotificationBell(pixels, stride, imageHeight, channel, nearChannel) {
  const textHeight = channel.y1 - channel.y0;
  const left = Math.max(0, Math.floor(channel.x0 - textHeight * 4.5));
  const top = Math.max(0, Math.floor(channel.y0 - textHeight * 2));
  const right = Math.min(stride, Math.ceil(channel.x1 + textHeight * 18));
  const bottom = Math.min(imageHeight, Math.ceil(channel.y1 + textHeight * 9));
  const width = right - left;
  const height = bottom - top;
  const minSize = Math.max(7, textHeight * 0.45);
  const maxSize = textHeight * 3.1;

  for (const light of [true, false]) {
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = pixels[(top + y) * stride + left + x];
        mask[y * width + x] = light ? Number(value >= 142) : Number(value <= 115);
      }
    }
    const seen = new Uint8Array(mask.length);
    const queue = new Int32Array(mask.length);
    for (let index = 0; index < mask.length; index++) {
      if (!mask[index] || seen[index]) continue;
      queue[0] = index;
      seen[index] = 1;
      let x0 = width, x1 = 0, y0 = height, y1 = 0;
      let end = 1;
      for (let head = 0; head < end; head++) {
        const y = Math.floor(queue[head] / width);
        const x = queue[head] % width;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
            const neighbor = ny * width + nx;
            if (!mask[neighbor] || seen[neighbor]) continue;
            seen[neighbor] = 1;
            queue[end++] = neighbor;
          }
        }
      }
      const glyphWidth = x1 - x0 + 1;
      const glyphHeight = y1 - y0 + 1;
      if (glyphWidth < minSize || glyphHeight < minSize || glyphWidth > maxSize || glyphHeight > maxSize ||
          glyphWidth / glyphHeight < 0.64 || glyphWidth / glyphHeight > 1.25 ||
          !nearChannel(left + (x0 + x1) / 2, top + (y0 + y1) / 2)) continue;

      const box = { x0, y0, width: glyphWidth, height: glyphHeight };
      const withClapper = { ...box, height: Math.min(height - y0, Math.round(glyphHeight * 1.16)) };
      if (templates.some(template => bellScore(mask, width, box, template) >= 0.67 ||
          bellScore(mask, width, withClapper, template) >= 0.67)) return true;
    }
  }
  return false;
}

module.exports = { hasNotificationBell };
