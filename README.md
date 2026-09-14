# Farm Cost Planner

A local-first farm planning app built with React, TypeScript, and Vite. Farmers can enter their own crops, equipment, prices, costs, and cash timing. UC Davis cost studies are optional starting points, with citations retained for review.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:5173. The development server reloads as files change. Plans and the selected language are saved in the browser on that device.

## Planning flow

1. Enter farm details and shared costs.
2. Add your own crops or start with a study. Enter yield, selling unit, price, growing costs, and cost/sales months.
3. Add your own equipment or select a cited equipment row. Enter actual purchase, operating, and resale amounts.
4. Review annual sales, costs, and net return. The cash chart has monthly movement and cumulative balance views.

Blank inputs remain distinct from an entered zero. Incomplete plans can be saved; Results lists the missing inputs and labels the estimate as provisional. Custom monthly timing is retained when a saved plan is reopened.

The cash chart includes only crops with valid cost and sales schedules. It starts cumulative balance at zero and spreads allocated shared overhead evenly across the year. Its scope differs from annual net return; the app displays the assumptions and included crops next to the chart.

## Studies, sources, and downloads

Study selection is optional. Crop studies can be filtered by region, year, and explicitly stated production method. County sorting uses literal metadata mentions, which may describe an adviser’s territory rather than the study location. Equipment browsing groups description keywords and lets you choose an individual study row.

Source tags show whether a number matches its study, was entered by the farmer, or is missing. Open the tag to inspect the source and restore that field. Restoration preserves other entries and is disabled for crop yield or price when the selling unit differs from the original study.

Results offers local PDF and Excel (`.xlsx`) downloads. These are snapshots of the plan at the time of the download, including inputs, annual results, cash timing, and source references. The workbook contains typed numeric values; it is not a separate recalculating copy of the app. Missing input amounts remain blank and incomplete reports are labeled as provisional. Export libraries load only when a download is requested.

## Data and verification

```sh
npm run build
npm test
npm run lint
```

The study pipeline is separate from normal development:

```sh
npm run studies:fetch
npm run studies:parse
npm run studies:build
npm run studies:verify
```

`data/studies/manifest-current.json` identifies the source PDFs. Parsed records live in `data/studies/parsed`; `src/data/studies.generated.json` is the application bundle. Rebuilding study data does not replace values a farmer has entered into a saved plan.

The calculation engine is in `src/lib/engine.ts`. Missing-input handling and migration live in `src/lib/inputs.ts` and `src/lib/store.ts`. English and Spanish interface text lives in `src/i18n`.
