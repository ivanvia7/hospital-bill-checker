import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const run = promisify(execFile);

test('the accuracy check agrees with the tool on a wide CSV and a JSON file', async () => {
    // wide.csv holds 5 billable codes cut from NYU Tisch; the CMS JSON example holds 8.
    const wide = await run(process.execPath, ['scripts/check-accuracy.ts', 'test/fixtures/wide.csv', 'Aetna AETNA PPO 1010', '--lines', '5']);
    const json = await run(process.execPath, ['scripts/check-accuracy.ts', 'test/fixtures/standard-charges.json', 'Platform Health Insurance PPO']);

    assert.match(wide.stdout, /^5 of 5 lines match/m);
    assert.match(json.stdout, /^8 of 8 lines match/m);
});

test('the accuracy check refuses part of a plan name', async () => {
    await assert.rejects(run(process.execPath, ['scripts/check-accuracy.ts', 'test/fixtures/tall.csv', 'platform']), {
        code: 1,
        stdout: 'Pass the full name of one plan. "platform" matches: Platform Health Insurance PPO\n',
    });
});

test('the accuracy check reads a tall CSV with spaces around the pipes', async () => {
    const tall = await run(process.execPath, ['scripts/check-accuracy.ts', 'test/fixtures/tall.csv', 'Platform Health Insurance PPO']);

    assert.match(tall.stdout, /^(\d+) of \1 lines match/m);
});
