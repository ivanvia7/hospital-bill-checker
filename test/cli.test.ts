import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const run = promisify(execFile);

function check(...args: string[]) {
    return run(process.execPath, ['src/cli.ts', 'check', ...args]);
}

test('prints one line and exits 1 when the bill is missing', async () => {
    await assert.rejects(check('--bill', 'test/fixtures/missing.csv', '--file', 'test/fixtures/tall.csv'), {
        code: 1,
        stderr: "ENOENT: no such file or directory, open 'test/fixtures/missing.csv'\n",
    });
});

test('refuses a price file that is not CSV or JSON', async () => {
    // A hospital .zip read as CSV would match nothing and print a clean-looking table.
    await assert.rejects(check('--bill', 'test/fixtures/bill.csv', '--file', 'test/fixtures/bill.pdf'), {
        code: 1,
        stderr: 'test/fixtures/bill.pdf: expected a .csv or .json price file\n',
    });
});

test('names the domain when the hospital website cannot be reached', async () => {
    // .invalid is reserved and never resolves, so this needs no network.
    await assert.rejects(run(process.execPath, ['src/cli.ts', 'find', 'no-such-hospital.invalid']), {
        code: 1,
        stderr: "Could not reach no-such-hospital.invalid. Check the spelling of the hospital's website\n",
    });
});
