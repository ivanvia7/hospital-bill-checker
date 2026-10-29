import type { Readable } from 'node:stream';
import chain from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';

// One item of standard_charge_information, only the fields this tool reads.
type JsonItem = {
    description: string;
    code_information: { code: string; type: string }[];
    standard_charges: {
        setting: string;
        gross_charge?: number;
        discounted_cash?: number;
        payers_information?: { payer_name: string; plan_name: string; standard_charge_dollar?: number }[];
    }[];
};

const ITEMS_FIELD = 'standard_charge_information';

export async function* readJsonItems(input: Readable): AsyncGenerator<JsonItem> {
    const pipeline = chain([
        input,
        parser(),
        pick({ filter: ITEMS_FIELD }),
        streamArray(),
    ]);

    for await (const { value } of pipeline) {
        yield value as JsonItem;
    }
}

// One item can list inpatient and outpatient prices, so it gives one price per setting.
export function readJsonPrices(item: JsonItem) {
    return item.standard_charges.map((charge) => ({
        codes: item.code_information,
        description: item.description,
        setting: charge.setting.toLowerCase(),
        gross: charge.gross_charge ?? null,
        cash: charge.discounted_cash ?? null,
        payers: (charge.payers_information ?? []).flatMap((payer) =>
            payer.standard_charge_dollar === undefined
                ? []
                : [{ payer: payer.payer_name, plan: payer.plan_name, dollar: payer.standard_charge_dollar }],
        ),
    }));
}
