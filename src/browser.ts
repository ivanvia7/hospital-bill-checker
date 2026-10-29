import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Camoufox } from 'camoufox';

// Some hospitals sit behind Cloudflare, which answers 403 to plain fetch but lets a real browser through.
export const BLOCKED_STATUS = 403;
const DOWNLOAD_STARTED = 'Download is starting';

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
        // Firefox aborts the navigation once the download begins; only that error is expected.
        // Promise.all stops at a real goto error, such as DNS, instead of waiting out the download timeout.
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.goto(url.href).catch((error: Error) => {
                if (!error.message.includes(DOWNLOAD_STARTED)) {
                    throw error;
                }
            }),
        ]);
        const folder = await mkdtemp(join(tmpdir(), 'hospital-bill-checker-'));
        const filePath = join(folder, download.suggestedFilename());

        await download.saveAs(filePath);

        return filePath;
    } finally {
        await browser.close();
    }
}
