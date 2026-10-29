# hospital-bill-checker

Check your hospital bill line by line against the hospital's own posted prices.

**Use it in your browser:** https://ivanvia7.github.io/hospital-bill-checker/ Your files stay on your computer.

US hospitals must post every price they charge in one public file.
This tool finds that file, reads it, and puts each line of your bill next to the hospital's cash price and your plan's rate.

```
$ node src/cli.ts check --bill bill.csv --hospital nyulangone.org --location Tisch --payer aetna
Reading NYU Langone Tisch Hospital: https://standard-charges-prod.s3.amazonaws.com/pricing_files/133971298-1801992631_nyu-langone-tisch_standardcharges.csv
┌─────────┬─────────┬─────┬────────┬────────────────────────────────┬─────────┬─────────┬──────────────┐
│ (index) │ code    │ qty │ billed │ hospital                       │ cash    │ plan    │ flag         │
├─────────┼─────────┼─────┼────────┼────────────────────────────────┼─────────┼─────────┼──────────────┤
│ 0       │ '70551' │ 1   │ 3250   │ 'HC MRI BRAIN W/O DYE'         │ 1042.8  │ 5488.42 │ ''           │
│ 1       │ '99285' │ 1   │ 2840.5 │ 'EMERGENCY DEPT VISIT HI MDM'  │ 1121.78 │ 5904.1  │ ''           │
│ 2       │ '80053' │ 1   │ 412    │ 'COMPREHEN METABOLIC PANEL'    │ 12.67   │ 325.51  │ 'ABOVE BOTH' │
│ 3       │ '85025' │ 2   │ 186.75 │ 'COMPLETE CBC W/AUTO DIFF WBC' │ 9.32    │ 138.61  │ 'ABOVE BOTH' │
│ 4       │ '36415' │ 2   │ 45     │ 'HC ROUTINE VENIPUNCTURE'      │ 10.91   │ 45.93   │ ''           │
└─────────┴─────────┴─────┴────────┴────────────────────────────────┴─────────┴─────────┴──────────────┘
```

On this sample bill the metabolic panel is billed at $412. The hospital's own file lists $12.67 cash and at most $325.51 for an Aetna plan.
That run streamed a 482 MB price file in 40 seconds.

## Quick start

Needs Node 22.18 or newer, which runs the TypeScript files directly.

```sh
git clone https://github.com/ivanvia7/hospital-bill-checker
cd hospital-bill-checker && npm install
node src/cli.ts check --bill bill.pdf --hospital nyulangone.org --location Tisch
```

More examples:

```sh
node src/cli.ts find nyulangone.org
node src/cli.ts check --bill bill.csv --file prices.csv --payer "blue cross"
```

## Commands

`find <domain>` lists every location the hospital posts a price file for, with the file's URL.

`check --bill <file>` compares your bill with one price file:

- `--hospital <domain>` finds the price file through the hospital's site.
- `--location <name>` picks one location when the hospital lists several. Part of the name is enough if only one location matches.
- `--file <path>` reads a price file already on your disk instead.
- `--payer <text>` matches your insurer and plan, such as `aetna` or `cigna ppo`. Leave it out to compare with the cash price only.

## Your bill

A CSV bill needs three columns. `amount` is the price of one unit.

```csv
code,amount,qty
70551,"$3,250.00",1
85025,186.75,2
```

A PDF bill works if it has text you can select. Scanned bills are pictures and give no text.
The tool reads each line with a CPT code (5 digits) or HCPCS code (letter plus 4 digits) and an amount.
It shows the lines it found and asks before checking them.

## What the columns mean

- `cash` is the hospital's discounted cash price.
- `plan` is the negotiated rate for plans that match `--payer`.
- When the file lists several prices for one code, the highest one is shown. A flag never rests on a cheaper row.
- `flag` says `ABOVE CASH`, `ABOVE PLAN` or `ABOVE BOTH` when the bill is above every price the hospital lists.
- `not in file` means the hospital posted no price for that code.

## How it works

Every hospital posts `cms-hpt.txt` at the root of its site, listing its price files.
The tool reads that list, then streams the CSV or JSON price file once.
It keeps only the rows whose codes are on your bill, so memory stays low even for files over 500 MB.
Your bill never leaves your machine. The only network requests go to the hospital's own files.

Some hospital sites block plain downloads.
The tool then fetches the file through a headless Firefox, which downloads once on first use.

## Limits

- Zip price files are not read yet. Unzip the file and pass the CSV with `--file`.
- A plan rate shows only if the hospital lists it as a dollar amount. Some files list a percentage or a formula instead.
- The price file is the hospital's own claim. A line below every listed price can still be a billing error.

## License

MIT
