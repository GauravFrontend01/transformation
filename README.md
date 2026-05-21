# Transformation Studio

React + Node tool for mapping fields from multiple source files onto an output schema, then generating a dynamic JavaScript `transform()` function you can drop into any loop.

## Run

```bash
npm run install:all
npm run dev
```

- Backend on `http://localhost:4000`
- Frontend on `http://localhost:5173` (proxies `/api` → backend)

## How it works

1. The app preloads three dummy sources (`users.json`, `orders.csv`, `products.json`) and one output schema (`output_schema.json`). Replace any of them via the "Replace" button on each card.
2. In **Match the following**, for each output key choose a source, a field, and (optionally) a transform (uppercase, cents→dollars, ISO date, etc.).
3. Click **Generate code**. The backend produces a self-contained `transform({ users, orders, products })` function. Copy it or download `transform.js`.

The generated function is designed to run inside a loop, one call per output record. Pass one record per source on each iteration.

## Stack

- Backend: Express, multer, papaparse
- Frontend: Vite + React, prismjs for syntax highlighting

## File support

- `.json` — single object or array of objects (first object's keys define the schema)
- `.csv` / `.tsv` — first row = headers
