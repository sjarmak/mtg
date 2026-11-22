import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePng } from '@mtg/raster';
import type { RasterImage } from '@mtg/raster';
import { stageSetArt } from '../../tools/stage-set-art';
import { WEB_ART_LONGEST_EDGE, publishWebRaster } from '../../tools/web-raster';

function dimensions(path: string): readonly [number, number] {
  const output = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(output) as { streams: { width: number; height: number }[] };
  const stream = parsed.streams[0];
  if (stream === undefined) throw new Error(`${path} has no video stream`);
  return [stream.width, stream.height];
}

/** A render the size the flagship's art run actually writes, in miniature. */
function render(width: number, height: number): RasterImage {
  const data = new Uint8Array(width * height * 4);
  let state = 0x12345678;
  for (let i = 0; i < width * height; i += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    data[i * 4] = state & 0xff;
    data[i * 4 + 1] = (state >>> 8) & 0xff;
    data[i * 4 + 2] = (state >>> 16) & 0xff;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

let directory = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mtg-web-raster-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('staging a generated raster for the web', () => {
  it('shrinks a render that is wider than the page ever draws it', async () => {
    const from = join(directory, 'big.png');
    const to = join(directory, 'served', 'big.png');
    await writeFile(from, encodePng(render(1600, 1067)));
    const published = publishWebRaster(from, to);

    expect(published.resized, 'the render was over budget').toBe(true);
    expect(published.outputPath).toBe(join(directory, 'served', 'big.webp'));
    const [width, height] = dimensions(published.outputPath);
    expect(Math.max(width, height)).toBe(WEB_ART_LONGEST_EDGE);
    // The shape is kept: a card's art window is a ratio, and a squashed picture
    // would be a worse bug than a heavy one.
    expect(width / height).toBeCloseTo(1600 / 1067, 2);
    expect(published.bytes, 'the served copy is smaller than the render').toBeLessThan(published.sourceBytes);
  });

  it('encodes a raster already inside the pixel budget as WebP', async () => {
    const from = join(directory, 'small.png');
    const to = join(directory, 'served', 'small.png');
    const bytes = encodePng(render(320, 213));
    await writeFile(from, bytes);
    const published = publishWebRaster(from, to);

    expect(published.resized).toBe(false);
    expect(published.outputPath).toBe(join(directory, 'served', 'small.webp'));
    expect(published.bytes).toBeLessThan(bytes.byteLength);
    expect((await readFile(published.outputPath)).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('keeps the encoded output when a PNG source already has a WebP suffix', async () => {
    const from = join(directory, 'misnamed.webp');
    const to = join(directory, 'served', 'misnamed.webp');
    await writeFile(from, encodePng(render(320, 213)));

    const published = publishWebRaster(from, to);

    expect(published.outputPath).toBe(to);
    expect((await readFile(to)).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('leaves a served copy that is already newer than its source alone', async () => {
    const from = join(directory, 'stable.png');
    const to = join(directory, 'served', 'stable.png');
    await writeFile(from, encodePng(render(1600, 1067)));
    const first = publishWebRaster(from, to);
    expect(first.resized).toBe(true);

    const again = publishWebRaster(from, to);
    expect(again.reused, 'the second pass re-encoded nothing').toBe(true);
    expect(again.bytes).toBe(first.bytes);

    // A regenerated raster is newer than the copy made from it, which is the
    // whole reason the gate is a timestamp rather than existence.
    await writeFile(from, encodePng(render(1600, 1067)));
    await utimes(from, new Date(), new Date(Date.now() + 60_000));
    expect(publishWebRaster(from, to).resized, 'a newer render is published').toBe(true);
  });

  it('reuses a valid served copy without decoding an unchanged source', async () => {
    const from = join(directory, 'unchanged.png');
    const to = join(directory, 'served', 'unchanged.png');
    await writeFile(from, encodePng(render(320, 213)));
    const first = publishWebRaster(from, to);
    const source = await readFile(from);
    await writeFile(from, source.subarray(0, 33));
    await utimes(first.outputPath, new Date(), new Date(Date.now() + 60_000));

    expect(publishWebRaster(from, to)).toMatchObject({ reused: true, outputPath: first.outputPath });
  });

  it('replaces a newer WebP that exceeds the pixel budget', async () => {
    const from = join(directory, 'cached.png');
    const to = join(directory, 'served', 'cached.png');
    await writeFile(from, encodePng(render(1600, 1067)));
    const first = publishWebRaster(from, to);
    execFileSync('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=size=1600x1066',
      '-frames:v',
      '1',
      first.outputPath,
    ]);
    await utimes(first.outputPath, new Date(), new Date(Date.now() + 60_000));

    const published = publishWebRaster(from, to);

    expect(published.reused).toBe(false);
    expect(Math.max(...dimensions(published.outputPath))).toBe(WEB_ART_LONGEST_EDGE);
  });

  it('replaces a newer malformed WebP', async () => {
    const from = join(directory, 'malformed.png');
    const to = join(directory, 'served', 'malformed.png');
    await writeFile(from, encodePng(render(320, 213)));
    const first = publishWebRaster(from, to);
    await writeFile(first.outputPath, 'RIFF malformed WEBP');
    await utimes(first.outputPath, new Date(), new Date(Date.now() + 60_000));

    const published = publishWebRaster(from, to);

    expect(published.reused).toBe(false);
    expect(dimensions(published.outputPath)).toEqual([320, 213]);
  });

  it('republishes a served copy that is newer than its source and still over budget', async () => {
    // The state every machine that staged a bundle before mtg-cax8 is in: the
    // copy is the newest file on disk and is the full-resolution render.
    const from = join(directory, 'legacy.png');
    const to = join(directory, 'served', 'legacy.png');
    const raster = encodePng(render(1600, 1067));
    await writeFile(from, raster);
    await writeFile(to, raster);
    await utimes(to, new Date(), new Date(Date.now() + 60_000));

    const published = publishWebRaster(from, to);
    expect(published.resized, 'the stale full-resolution copy was replaced').toBe(true);
    const [width, height] = dimensions(published.outputPath);
    expect(Math.max(width, height)).toBe(WEB_ART_LONGEST_EDGE);
  });

  it('copies a file that is not a PNG at all rather than refusing it', async () => {
    const from = join(directory, 'not-a-png.bin');
    const to = join(directory, 'served', 'not-a-png.bin');
    await writeFile(from, 'GIF89a and then some');
    const published = publishWebRaster(from, to);

    expect(published.resized).toBe(false);
    expect(published.outputPath).toBe(to);
    expect(await readFile(to, 'utf8')).toBe('GIF89a and then some');
  });
});

describe('staging a set with the default copy', () => {
  it('reports what the bundle weighs after the pass, not what the renders weighed', async () => {
    const manifestDir = join(directory, 'run');
    const publicDir = join(directory, 'bundle');
    const raster = encodePng(render(1600, 1067));
    await mkdir(manifestDir, { recursive: true });
    await writeFile(join(manifestDir, 'xmp-one.png'), raster);

    const staged = stageSetArt(
      {
        formatVersion: 2,
        art: { 'xmp-one': [{ href: './xmp-one.png', alt: 'a shrine' }] },
      },
      { manifestDir, publicDir, servedPrefix: 'sets/xmp/art' },
    );

    expect(staged.copied).toBe(1);
    expect(staged.resized, 'the render was shrunk on the way in').toBe(1);
    expect(staged.sourceBytes).toBe(raster.byteLength);
    expect(staged.bytes).toBeLessThan(staged.sourceBytes);
    expect(staged.manifest.art['xmp-one']?.[0]?.href).toBe('sets/xmp/art/xmp-one.webp');
    const [width, height] = dimensions(join(publicDir, 'xmp-one.webp'));
    expect(Math.max(width, height)).toBe(WEB_ART_LONGEST_EDGE);
  });
});
