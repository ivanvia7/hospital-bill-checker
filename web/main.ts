import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { compareLine, findBillPrices, findPlans, readBill, readPdfBill } from '../src/bill.ts';

const MEGABYTE = 1024 * 1024;

// index.html and this file ship together, so a missing element is a build mistake worth a loud error.
function find<T extends Element = Element>(selector: string) {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`index.html has no ${selector}`);
    }

    return element;
}

const form = find<HTMLFormElement>('form');
const status = find('#status');
const results = find<HTMLTableSectionElement>('tbody');
const bar = find<HTMLProgressElement>('progress');
const checkButton = find<HTMLButtonElement>('#check');
const sampleButton = find<HTMLButtonElement>('#sample');
const payerInput = find<HTMLInputElement>('#payer');
const planSelect = find<HTMLSelectElement>('#plan');
const planField = find<HTMLElement>('#plan-field');
const domainInput = find<HTMLInputElement>('#domain');
const indexLink = find<HTMLAnchorElement>('#index-link');
const indexHelp = find<HTMLElement>('#index-help');

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

// The last check stays in memory, so picking another plan does not read the 500 MB file again.
let checked: { bill: Awaited<ReturnType<typeof readBillFile>>; prices: Awaited<ReturnType<typeof findBillPrices>> } | undefined;

function showResults(plan: string) {
    results.replaceChildren();
    for (const line of checked?.bill ?? []) {
        const result = compareLine(line, checked?.prices ?? [], plan);
        showRow([result.code, result.qty, result.billed, result.hospital, result.cash, result.plan, result.flag]);
    }
}

function showPlanChoice(plans: string[]) {
    planSelect.replaceChildren(new Option(`Pick your plan, ${plans.length} match`, ''), ...plans.map((plan) => new Option(plan, plan)));
    planField.hidden = false;
}

async function checkBill(billFile: File, priceFile: File, payer: string) {
    const bill = await readBillFile(billFile);

    planField.hidden = true;
    if (bill.length === 0) {
        status.textContent = 'No bill lines found. A scanned PDF has no text to read.';
        return;
    }

    const format = priceFile.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    const prices = await findBillPrices(Readable.from(readChunks(priceFile)), format, new Set(bill.map((line) => line.code)));
    const plans = findPlans(prices, payer);

    checked = { bill, prices };
    showResults(plans.length === 1 ? plans[0] : '');
    status.textContent = `Checked ${bill.length} bill lines against ${priceFile.name}${plans.length === 1 ? `, plan ${plans[0]}` : ''}.`;

    if (plans.length > 1) {
        showPlanChoice(plans);
        status.textContent += ` "${payer}" matches ${plans.length} plans that pay different rates. Pick yours to compare with its rate.`;
    } else if (payer && plans.length === 0) {
        status.textContent += ` No plan matches "${payer}", so only the cash price is compared.`;
    }
}

// The sample files sit next to this page, so the browser may read them without a download.
async function fetchSample(name: string) {
    const response = await fetch(`sample/${name}`);

    if (!response.ok) {
        throw new Error(`Could not load the sample file ${name}.`);
    }
    return new File([await response.blob()], name);
}

async function runCheck(check: () => Promise<void>) {
    checkButton.disabled = true;
    sampleButton.disabled = true;

    try {
        await check();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
        checkButton.disabled = false;
        sampleButton.disabled = false;
    }
}

// Most hospitals block other sites from reading cms-hpt.txt, so the patient opens it in a new tab.
domainInput.addEventListener('input', () => {
    // Accepts "https://nyulangone.org/billing" and keeps only "nyulangone.org".
    const domain = domainInput.value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

    indexHelp.hidden = !domain;
    indexLink.href = `https://${domain}/cms-hpt.txt`;
    indexLink.textContent = indexLink.href;
});

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);

    runCheck(() => checkBill(fields.get('bill') as File, fields.get('prices') as File, String(fields.get('payer'))));
});

planSelect.addEventListener('change', () => {
    showResults(planSelect.value);
    status.textContent = planSelect.value ? `Compared with ${planSelect.value}.` : 'Compared with the cash price only.';
});

sampleButton.addEventListener('click', () => {
    payerInput.value = 'aetna ppo';
    runCheck(async () => {
        const [bill, prices] = await Promise.all([fetchSample('bill.csv'), fetchSample('nyu-tisch-prices.csv')]);

        await checkBill(bill, prices, payerInput.value);
    });
});
