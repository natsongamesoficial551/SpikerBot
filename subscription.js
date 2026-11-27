const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
const { hasNotificationBell } = require('./subscription-bell');

const run = promisify(execFile);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;
const imageOptions = { limitInputPixels: 24_000_000 };

const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const channelName = /^@?sp[il1]k[e3]rh[a4]k(?:ofc)?$/;
const possibleChannelName = /^@?[s5]p[a-z0-9]{3,9}[a4]k(?:ofc)?$/;
const subscribed = /^(?:[il1]nscr[il1]t[oa0]|subscr[il1]bed|suscr[il1]t[oa0])$/;
const subscribe = /^(?:[il1]nscrever(?:se)?|[il1]nscreva(?:se)?|subscribe|suscribirse)$/;

class ProofInputError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}

function mediaType(attachment) {
  if (attachment.contentType?.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(attachment.name || '')) return 'video';
  if (attachment.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(attachment.name || '')) return 'image';
  return null;
}

async function download(attachment) {
  if (attachment.size > MAX_BYTES) throw new ProofInputError('O arquivo deve ter até 25 MB.');
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error(`Falha ao baixar anexo: HTTP ${response.status}`);

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new ProofInputError('O arquivo deve ter até 25 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = require('ffmpeg-static');
    return bundled && existsSync(bundled) ? bundled : 'ffmpeg';
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return 'ffmpeg';
  }
}

async function* videoFrames(buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'spiker-proof-'));
  const input = path.join(directory, 'input');
  const ffmpeg = ffmpegPath();
  const common = [
    '-nostdin', '-hide_banner', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
    '-threads', '2', '-i', input, '-map', '0:V:0', '-an', '-sn'
  ];
  try {
    await writeFile(input, buffer);
    const { stderr } = await run(ffmpeg, [...common, '-frames:v', '0', '-f', 'null', '-'], { timeout: 10_000 });
    const duration = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
    if (seconds > MAX_VIDEO_SECONDS) throw new ProofInputError('O vídeo deve ter até dois minutos.');

    // Keep the first frame, then sample across the clip. Live recordings may omit duration metadata.
    const interval = Math.max(0.5, (seconds || 12) / 12);
    const filter = `select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval}),scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease`;
    await run(ffmpeg, [
      '-loglevel', 'error', ...common, '-t', String(MAX_VIDEO_SECONDS), '-filter_threads', '2',
      '-vf', filter, '-fps_mode', 'vfr', '-frames:v', '13', '-threads', '2', path.join(directory, '%02d.png')
    ], { timeout: 30_000 });
    const seen = new Set();
    for (const frame of (await readdir(directory)).filter(name => name.endsWith('.png')).sort()) {
      const image = await readFile(path.join(directory, frame));
      const hash = createHash('sha256').update(image).digest('hex');
      if (seen.has(hash)) continue;
      seen.add(hash);
      yield image;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function wordsFrom(data) {
  const words = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) words.push(...line.words);
    }
  }
  return words.map(({ text, bbox }) => ({
    text: normalize(text).replace(/^[^@a-z0-9]+|[^a-z0-9]+$/g, ''),
    ...bbox
  }));
}

function channelLabels(words) {
  return words.flatMap((word, index) => {
    if (channelName.test(word.text)) return [word];
    const next = words[index + 1];
    const height = word.y1 - word.y0;
    if (next && Math.abs(word.y0 - next.y0) <= height / 2 &&
        next.x0 >= word.x1 && next.x0 - word.x1 <= height) {
      const combined = word.text + next.text;
      const box = { ...word, x1: next.x1, y1: Math.max(word.y1, next.y1) };
      if (channelName.test(combined)) return [box];
      if (possibleChannelName.test(combined)) return [{ ...box, needsConfirmation: true }];
    }
    // Blurred text can suggest where the label is. Confirm it with a separate
    // OCR pass on the small region before accepting the proof.
    if (possibleChannelName.test(word.text)) return [{ ...word, needsConfirmation: true }];
    return [];
  });
}

function nearChannel(channel, x, y) {
  const height = channel.y1 - channel.y0;
  const center = (channel.y0 + channel.y1) / 2;
  return (x >= channel.x1 - height * 0.35 && x <= channel.x1 + height * 16 &&
    y >= center - height * 1.1 && y <= center + height * 2.1) ||
    (x >= channel.x0 - height * 4 && x <= channel.x1 + height * 13 &&
      y > center + height * 0.35 && y <= center + height * 8);
}

function onSameLine(first, second) {
  const height = first.y1 - first.y0;
  const firstCenter = (first.y0 + first.y1) / 2;
  const secondCenter = (second.y0 + second.y1) / 2;
  return Math.abs(firstCenter - secondCenter) <= height * 0.55;
}

function hasSubscriptionText(words) {
  return words.some(word => {
    if (!subscribed.test(word.text)) return false;
    const height = word.y1 - word.y0;
    // "1 inscrito" is a subscriber count, not the member's subscription state.
    return !words.some(previous => /^\d+(?:[.,]\d+)?$/.test(previous.text) &&
      onSameLine(word, previous) && previous.x1 <= word.x0 && word.x0 - previous.x1 < height * 1.5);
  });
}

async function scanFrame(worker, frame, thorough) {
  const input = sharp(frame, imageOptions).rotate().flatten({ background: '#fff' });
  const gray = await input.clone().resize({ width: 2200, height: 2200, fit: 'inside' })
    .toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = gray.info;
  const source = () => sharp(gray.data, { raw: { width, height, channels: 1 } });

  // On desktop watch pages, the player fills most of the image and can hide the
  // much smaller channel row from OCR. Read that area separately before the full frame.
  const captionTop = Math.floor(height * 0.48);
  const caption = source().extract({ left: 0, top: captionTop, width: Math.ceil(width * 0.66), height: height - captionTop });
  const portrait = height > width;
  const passes = [{ image: source(), top: 0 }, { image: caption.clone().normalise().sharpen(), top: captionTop }];
  if (!portrait) passes.reverse();
  if (thorough) {
    if (!portrait) passes.push({ image: caption.negate().normalise().sharpen(), top: captionTop });
    passes.push({ image: source().normalise().sharpen(), top: 0 });
  }

  let foundChannel = false;
  for (const { image, top } of passes) {
    const { data } = await worker.recognize(await image.png().toBuffer(), {}, { blocks: true });
    const words = wordsFrom(data).map(word => ({ ...word, y0: word.y0 + top, y1: word.y1 + top }));
    for (const channel of channelLabels(words)) {
      if (!channel.needsConfirmation) foundChannel = true;
      const nearby = words.filter(word => word !== channel && nearChannel(channel, word.x0, (word.y0 + word.y1) / 2));
      if (nearby.some(word => subscribe.test(word.text.replace(/-/g, '')))) continue;
      const proof = hasSubscriptionText(nearby) ||
        hasNotificationBell(gray.data, width, height, channel, (x, y) => nearChannel(channel, x, y));
      if (!proof) continue;
      if (channel.needsConfirmation) {
        const padding = Math.ceil((channel.y1 - channel.y0) / 3);
        const left = Math.max(0, channel.x0 - padding);
        const labelTop = Math.max(0, channel.y0 - padding);
        const label = await source().extract({
          left, top: labelTop,
          width: Math.min(width, channel.x1 + padding) - left,
          height: Math.min(height, channel.y1 + padding) - labelTop
        }).resize({ width: 330 }).normalise().sharpen().png().toBuffer();
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
        try {
          const reread = await worker.recognize(label);
          if (!channelName.test(normalize(reread.data.text).replace(/\s+/g, ''))) continue;
        } finally {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        }
      }
      return { valid: true, foundChannel: true };
    }
  }
  return { valid: false, foundChannel };
}

async function verifyAttachment(attachment, hasOtherOwner) {
  const buffer = await download(attachment);
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (hasOtherOwner(hash)) {
    return { hash, valid: false, reason: 'Esse arquivo já foi usado por outro membro. Envie um comprovante da sua própria tela.' };
  }
  const isVideo = mediaType(attachment) === 'video';
  const frames = isVideo ? videoFrames(buffer) : [buffer];
  let worker;
  let foundChannel = false;
  try {
    for await (const frame of frames) {
      if (!worker) {
        worker = await createWorker('por+eng');
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      }
      const result = await scanFrame(worker, frame, !isVideo);
      if (result.valid) return { hash, valid: true };
      foundChannel ||= result.foundChannel;
    }
  } finally {
    if (worker) await worker.terminate();
  }
  const reason = foundChannel
    ? 'O status “Inscrito” ou o sininho do canal não ficou visível.'
    : 'O canal @spikerhakofc não foi identificado no comprovante.';
  return { hash, valid: false, reason };
}

function checkVideoSupport() {
  return run(ffmpegPath(), ['-version'], { timeout: 5_000 });
}

module.exports = { checkVideoSupport, mediaType, verifyAttachment };
