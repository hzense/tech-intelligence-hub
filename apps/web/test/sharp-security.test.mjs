import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve('next/package.json'));
const sharp = nextRequire('sharp');
const atLeast = (actual, minimum) => {
  const a = actual.split('.').map(Number),
    b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
};

test('Next uses patched sharp/librsvg and still converts a trusted local SVG without network', async () => {
  assert.ok(atLeast(sharp.versions.sharp, '0.35.5'));
  assert.ok(atLeast(sharp.versions.rsvg, '2.63.2'));
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
  );
  const { info } = await sharp(input).resize(4, 4).png().toBuffer({ resolveWithObject: true });
  assert.equal(info.format, 'png');
  assert.equal(info.width, 4);
  assert.equal(info.height, 4);
});
