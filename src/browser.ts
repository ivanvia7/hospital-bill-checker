import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Camoufox } from 'camoufox';

// Some hospitals sit behind Cloudflare, which answers 403 to plain fetch but lets a real browser through.
export const BLOCKED_STATUS = 403;

export async function readTextInBrowser(url: URL) {
    const browser = await Camoufox({ headless: true });

    try {
        const page = await browser.newPage();
        const response = await page.goto(url.href);

        if (!response?.ok()) {
            throw new Error(`${url} answered ${response?.status()} in the browser too`);
        }

        return await response.text();
    } finally {
        await browser.close();
    }
}

// A price file opens as a download, so it is saved to a temp folder and read from there.
export async function downloadInBrowser(url: URL) {
    const browser = await Camoufox({ headless: true });

    try {
        const page = await browser.newPage();
        const downloadStarted = page.waitForEvent('download');
        // Firefox aborts the navigation once the download begins; that error is expected.
        await page.goto(url.href).catch(() => null);
        const download = await downloadStarted;
        const folder = await mkdtemp(join(tmpdir(), 'hospital-bill-checker-'));
        const filePath = join(folder, download.suggestedFilename());

        await download.saveAs(filePath);

        return filePath;
    } finally {
        await browser.close();
    }
}
