import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { parse } from 'yaml';

const workflow = parse(
  await readFile(new URL('../../../.github/workflows/neon-usage.yml', import.meta.url), 'utf8'),
);
test('daily workflow selects exactly the Berlin midnight UTC slot in both seasons', async (t) => {
  assert.deepEqual(
    workflow.on.schedule.map((s) => s.cron),
    ['0 22 * * *', '0 23 * * *'],
  );
  const steps = workflow.jobs.sample.steps;
  const guard = steps.find((s) => s.id === 'midnight');
  assert.equal(
    steps.find((s) => s.env?.HZENSE_NEON_USAGE_CRON_SECRET).if,
    "steps.midnight.outputs.sample == 'true'",
  );
  assert.match(guard.run, /TZ=Europe\/Berlin date/);
  const directory = await mkdtemp(join(tmpdir(), 'neon-midnight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, [event, cron, offset, expected]] of [
    ['schedule', '0 22 * * *', '+0200', true],
    ['schedule', '0 23 * * *', '+0200', false],
    ['schedule', '0 22 * * *', '+0100', false],
    ['schedule', '0 23 * * *', '+0100', true],
    ['workflow_dispatch', '', '+0100', true],
  ].entries()) {
    const output = join(directory, `${index}.txt`);
    execFileSync('bash', ['-c', `date() { printf '%s\\n' "$TEST_OFFSET"; }\n${guard.run}`], {
      env: {
        ...process.env,
        EVENT_NAME: event,
        SCHEDULE_CRON: cron,
        TEST_OFFSET: offset,
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal((await readFile(output, 'utf8')).trim(), `sample=${expected}`);
  }
});
