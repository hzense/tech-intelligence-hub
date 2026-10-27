import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutRadarCloud } from '../lib/radar-cloud-layout.ts';

const fixture = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `topic-${String(index).padStart(2, '0')}`,
    width: index === 0 ? 230 : 60 + ((index * 29) % 140),
    height: index === 0 ? 68 : 25 + ((index * 7) % 20),
    weight: count - index,
  }));

function assertReadableLayout(layout, expectedCount, gap = 14, padding = 16) {
  assert.equal(layout.placements.length, expectedCount);
  for (const [index, word] of layout.placements.entries()) {
    assert.ok(word.x >= padding - 0.000001, word.id);
    assert.ok(word.y >= padding - 0.000001, word.id);
    assert.ok(word.x + word.width <= layout.width - padding + 0.000001, word.id);
    assert.ok(word.y + word.height <= layout.height - padding + 0.000001, word.id);
    assert.ok(word.scale > 0 && word.scale <= 1, word.id);
    for (const other of layout.placements.slice(index + 1)) {
      const separated =
        word.x + word.width + gap <= other.x + 0.000001 ||
        other.x + other.width + gap <= word.x + 0.000001 ||
        word.y + word.height + gap <= other.y + 0.000001 ||
        other.y + other.height + gap <= word.y + 0.000001;
      assert.ok(separated, `${word.id} and ${other.id} overlap or lose the reading gap`);
    }
  }
  if (expectedCount) {
    const hottest = layout.placements[0];
    assert.equal(hottest.x + hottest.width / 2, layout.width / 2);
    assert.equal(hottest.y + hottest.height / 2, layout.height / 2);
  }
}

test('hottest term anchors the centre and the rest spread into all four directions', () => {
  const layout = layoutRadarCloud(fixture(37), { width: 1160 });
  assertReadableLayout(layout, 37);
  assert.equal(layout.height, 520);
  assert.ok(layout.placements.some((word) => word.x + word.width < layout.width / 2));
  assert.ok(layout.placements.some((word) => word.x > layout.width / 2));
  assert.ok(layout.placements.some((word) => word.y + word.height < layout.height / 2));
  assert.ok(layout.placements.some((word) => word.y > layout.height / 2));
});

test('mobile clouds grow vertically and keep all 50 terms without shrinking normal labels', () => {
  for (const width of [288, 358, 736, 1160]) {
    const layout = layoutRadarCloud(fixture(50), { width });
    assertReadableLayout(layout, 50);
    assert.ok(layout.placements.every((word) => word.scale === 1));
    if (width < 400) assert.ok(layout.height > 520);
  }
});

test('packing is deterministic, independent of input ordering, and leaves measurements unchanged', () => {
  const words = fixture(25);
  words[1].weight = words[2].weight;
  const original = words.map((word) => ({ ...word }));
  const one = layoutRadarCloud(words, { width: 800 });
  const two = layoutRadarCloud([...words].reverse(), { width: 800 });
  assert.deepEqual(one, two);
  assert.deepEqual(words, original);
});

test('an over-wide individual label can fit without scaling other words', () => {
  const words = fixture(5);
  words[0].width = 600;
  const layout = layoutRadarCloud(words, { width: 288 });
  assertReadableLayout(layout, 5);
  assert.equal(layout.placements[0].scale, 256 / 600);
  assert.equal(layout.placements[0].width, 256);
  assert.ok(layout.placements.slice(1).every((word) => word.scale === 1));
});

test('wide labels still fit on a narrow canvas without overlap or hiding words', () => {
  const words = fixture(30).map((word) => ({ ...word, width: 288, height: 40 }));
  const layout = layoutRadarCloud(words, { width: 320 });
  assertReadableLayout(layout, 30);
});

test('empty, duplicate and invalid measurements have explicit outcomes', () => {
  assert.deepEqual(layoutRadarCloud([], { width: 320 }), {
    width: 320,
    height: 520,
    placements: [],
  });
  const [word] = fixture(1);
  assertReadableLayout(layoutRadarCloud([word, word], { width: 320 }), 1);
  for (const options of [{ width: 0 }, { width: 20 }, { width: 320, height: Number.NaN }])
    assert.throws(() => layoutRadarCloud([word], options), RangeError);
  assert.throws(() => layoutRadarCloud([{ ...word, width: 0 }], { width: 320 }), RangeError);
  assert.throws(
    () => layoutRadarCloud([{ ...word, weight: Infinity }], { width: 320 }),
    RangeError,
  );
});
