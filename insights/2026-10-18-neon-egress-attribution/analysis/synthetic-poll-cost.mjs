// Illustrative scenarios only: no production samples, credentials or network calls.
// Decimal units: 1 kB = 1,000 bytes; 1 MB = 1,000,000 bytes.
import assert from 'node:assert/strict';

const intervalSeconds = 5;
const durationSeconds = 300;
// Idealized zero-latency schedule; real setTimeout polling also waits for each response.
const polls = Math.floor(durationSeconds / intervalSeconds);
assert.equal(polls, 60);
const rows = [100_000, 500_000, 1_000_000].map((bytesPerPoll) => ({
  hypotheticalBytesPerPoll: bytesPerPoll,
  polls,
  illustrativeTotalMB: (bytesPerPoll * polls) / 1_000_000,
}));
assert.deepEqual(
  rows.map((row) => row.illustrativeTotalMB),
  [6, 30, 60],
);
console.log(
  JSON.stringify(
    {
      classification: 'synthetic scenarios, not production measurements',
      intervalSeconds,
      durationSeconds,
      rows,
    },
    null,
    2,
  ),
);
