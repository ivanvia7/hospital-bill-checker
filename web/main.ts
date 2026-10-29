import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { compareLine, findBillPrices, readBill, readPdfBill } from '../src/bill.ts';

const MEGABYTE = 1024 * 1024;

const form = document.querySelector('form')!;
const status = document.querySelector('#status')!;
const results = document.querySelector('tbody')!;
const bar = document.querySelector('progress')!;
const checkButton = document.querySelector('button')!;
const domainInput = document.querySelector<HTMLInputElement>('#domain')!;
const indexLink = document.querySelector<HTMLAnchorElement>('#index-link')!;
const indexHelp = document.querySelector<HTMLElement>('#index-help')!;

// The readers parse Node-style Buffers, so each browser chunk is wrapped without a copy.
async function* readChunks(file: File) {
    const reader = file.stream().getReader();
    let bytesRead = 0;

    bar.max = file.size;

    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        bytesRead += chunk.value.byteLength;
        bar.value = bytesRead;
        status.textContent = `Reading ${file.name}: ${Math.round(bytesRead / MEGABYTE)} of ${Math.round(file.size / MEGABYTE)} MB`;
        yield Buffer.from(chunk.value.buffer, chunk.value.byteOffset, chunk.value.byteLength);
    }
}

async function readBillFile(file: File) {
    if (file.name.toLowerCase().endsWith('.pdf')) {
        return readPdfBill(new Uint8Array(await file.arrayBuffer()));
    }

    return readBill(Readable.from(readChunks(file)));
}

function showRow(cells: (string | number | null)[]) {
    const row = results.insertRow();

    for (const cell of cells) {
        row.insertCell().textContent = cell === null ? '' : String(cell);
    }
}

async function checkBill() {
    const fields = new FormData(form);
    const billFile = fields.get('bill') as File;
    const priceFile = fields.get('prices') as File;
    const bill = await readBillFile(billFile);

    if (bill.length === 0) {
        status.textContent = 'No bill lines found. A scanned PDF has no text to read.';
        return;
    }

    const format = priceFile.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    const prices = await findBillPrices(Readable.from(readChunks(priceFile)), format, new Set(bill.map((line) => line.code)));

    results.replaceChildren();
    for (const line of bill) {
        const result = compareLine(line, prices, String(fields.get('payer')));
        showRow([result.code, result.qty, result.billed, result.hospital, result.cash, result.plan, result.flag]);
    }
    status.textContent = `Checked ${bill.length} bill lines against ${priceFile.name}.`;
}

// Most hospitals block other sites from reading cms-hpt.txt, so the patient opens it in a new tab.
domainInput.addEventListener('input', () => {
    // Accepts "https://nyulangone.org/billing" and keeps only "nyulangone.org".
    const domain = domainInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    indexHelp.hidden = !domain;
    indexLink.href = `https://${domain}/cms-hpt.txt`;
    indexLink.textContent = indexLink.href;
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    checkButton.disabled = true;

    try {
        await checkBill();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
        checkButton.disabled = false;
    }
});
