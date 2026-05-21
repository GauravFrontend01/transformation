import express from "express";
import cors from "cors";
import multer from "multer";
import Papa from "papaparse";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, "samples");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------- parsing helpers ----------

function inferType(value) {
  if (value === null || value === undefined || value === "") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  const s = String(value).trim();
  if (/^-?\d+$/.test(s)) return "number";
  if (/^-?\d*\.\d+$/.test(s)) return "number";
  if (/^(true|false)$/i.test(s)) return "boolean";
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return "date";
  return "string";
}

function parseBuffer(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  const text = buffer.toString("utf8");

  if (ext === ".json") {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [data];
  }
  if (ext === ".csv" || ext === ".tsv") {
    const delimiter = ext === ".tsv" ? "\t" : ",";
    const parsed = Papa.parse(text, { header: true, delimiter, skipEmptyLines: true });
    if (parsed.errors?.length) {
      const first = parsed.errors[0];
      throw new Error(`CSV parse error: ${first.message} (row ${first.row})`);
    }
    return parsed.data;
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

function describeRecords(records) {
  if (!records.length) return { fields: [], recordCount: 0, sample: null };
  const first = records[0];
  const keys = Object.keys(first);
  const fields = keys.map((name) => ({
    name,
    type: inferType(first[name]),
    sample: first[name],
  }));
  return { fields, recordCount: records.length, sample: first };
}

function describeOutputSchema(records) {
  // Schema file can be: array of objects (use first), or a single object.
  const obj = Array.isArray(records) ? records[0] : records;
  if (!obj || typeof obj !== "object") return { keys: [] };
  return {
    keys: Object.keys(obj).map((name) => ({
      name,
      type: inferType(obj[name]),
      example: obj[name],
    })),
  };
}

// ---------- routes ----------

app.get("/api/samples", async (_req, res) => {
  try {
    const files = [
      { id: "users", filename: "users.json", role: "source", label: "Users" },
      { id: "orders", filename: "orders.csv", role: "source", label: "Orders" },
      { id: "products", filename: "products.json", role: "source", label: "Products" },
      { id: "output", filename: "output_schema.json", role: "output", label: "Output schema" },
    ];

    const result = await Promise.all(
      files.map(async (f) => {
        const buf = await fs.readFile(path.join(SAMPLES_DIR, f.filename));
        const records = parseBuffer(f.filename, buf);
        if (f.role === "source") {
          return { ...f, ...describeRecords(records) };
        }
        return { ...f, ...describeOutputSchema(records) };
      })
    );

    res.json({ sources: result.filter((r) => r.role === "source"), output: result.find((r) => r.role === "output") });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/parse", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const role = req.body.role || "source";
    const records = parseBuffer(req.file.originalname, req.file.buffer);
    const meta = { id: req.body.id || req.file.originalname, filename: req.file.originalname, label: req.body.label || req.file.originalname, role };
    if (role === "output") return res.json({ ...meta, ...describeOutputSchema(records) });
    res.json({ ...meta, ...describeRecords(records) });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ---------- code generation ----------

const TRANSFORM_LIBRARY = {
  identity: { label: "— none —", fn: "(v) => v" },
  toUpperCase: { label: "UPPERCASE", fn: "(v) => (v == null ? v : String(v).toUpperCase())" },
  toLowerCase: { label: "lowercase", fn: "(v) => (v == null ? v : String(v).toLowerCase())" },
  trim: { label: "trim whitespace", fn: "(v) => (v == null ? v : String(v).trim())" },
  toNumber: { label: "→ number", fn: "(v) => (v == null || v === '' ? null : Number(v))" },
  toString: { label: "→ string", fn: "(v) => (v == null ? v : String(v))" },
  toBoolean: { label: "→ boolean", fn: "(v) => v === true || v === 'true' || v === 1 || v === '1'" },
  centsToDollars: { label: "cents → dollars", fn: "(v) => (v == null || v === '' ? null : Number(v) / 100)" },
  isoDate: { label: "→ ISO date", fn: "(v) => (v == null || v === '' ? null : new Date(v).toISOString())" },
  toDateOnly: { label: "→ YYYY-MM-DD", fn: "(v) => (v == null || v === '' ? null : new Date(v).toISOString().slice(0, 10))" },
};

app.get("/api/transforms", (_req, res) => {
  res.json(Object.entries(TRANSFORM_LIBRARY).map(([id, { label }]) => ({ id, label })));
});

function safeIdent(name) {
  // Only used inside the generated code as a property accessor — we never eval mapping names.
  // We still validate to avoid producing broken code if someone uses weird header chars.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function accessor(sourceVar, field) {
  return safeIdent(field) ? `${sourceVar}.${field}` : `${sourceVar}[${JSON.stringify(field)}]`;
}

function normalizeMapping(m) {
  if (!m) return null;
  if (Array.isArray(m.inputs)) return m;
  // legacy single-input shape — keep accepting it
  if (m.sourceId && m.field) {
    return { inputs: [{ sourceId: m.sourceId, field: m.field, transform: m.transform || "identity" }], separator: " " };
  }
  return null;
}

function inputExpr(input, sourceVars) {
  if (!input?.sourceId || !input?.field) return null;
  if (!sourceVars.includes(input.sourceId)) return null;
  const acc = accessor(input.sourceId, input.field);
  if (!input.transform || input.transform === "identity") return acc;
  return `transforms.${input.transform}(${acc})`;
}

function generateCode({ sources, outputKeys, mappings, constants = {} }) {
  const sourceVars = sources.map((s) => s.id);

  const usedTransforms = new Set();
  for (const k of outputKeys) {
    const m = normalizeMapping(mappings[k.name]);
    if (!m) continue;
    for (const inp of m.inputs) {
      if (inp.transform && inp.transform !== "identity") usedTransforms.add(inp.transform);
    }
  }

  const transformBlock = usedTransforms.size
    ? `const transforms = {\n${[...usedTransforms]
        .map((t) => `  ${t}: ${TRANSFORM_LIBRARY[t].fn},`)
        .join("\n")}\n};\n\n`
    : "";

  const bodyLines = outputKeys.map((k) => {
    const m = normalizeMapping(mappings[k.name]);
    const keyOut = safeIdent(k.name) ? k.name : JSON.stringify(k.name);

    const validExprs = (m?.inputs || [])
      .map((inp) => inputExpr(inp, sourceVars))
      .filter(Boolean);

    if (validExprs.length === 0) {
      const def = JSON.stringify(constants[k.name] ?? null);
      return `    ${keyOut}: ${def},`;
    }

    if (validExprs.length === 1) {
      return `    ${keyOut}: ${validExprs[0]},`;
    }

    // Combine multiple inputs: drop null/empty, then join with the chosen separator.
    const sep = JSON.stringify(m.separator ?? " ");
    return `    ${keyOut}: [${validExprs.join(", ")}].filter((v) => v != null && v !== "").join(${sep}),`;
  });

  const paramsList = sourceVars.join(", ");

  const code = `// Auto-generated transform — drop into your loop.
// Each call produces ONE output record from ONE record per source.
//
// Usage:
//   const { transform } = require('./transform');
//   for (let i = 0; i < orders.length; i++) {
//     const out = transform({ ${sourceVars.map((v) => `${v}: ${v}List[i]`).join(", ")} });
//     // ...write 'out' wherever you need it
//   }

${transformBlock}function transform({ ${paramsList} } = {}) {
  return {
${bodyLines.join("\n")}
  };
}

// CommonJS export (works in Node .js files by default).
// For ESM, rename to .mjs and change the next line to: export { transform };
module.exports = { transform };
`;

  return code;
}

app.post("/api/generate", (req, res) => {
  try {
    const { sources, outputKeys, mappings, constants } = req.body || {};
    if (!Array.isArray(sources) || !sources.length) return res.status(400).json({ error: "sources required" });
    if (!Array.isArray(outputKeys) || !outputKeys.length) return res.status(400).json({ error: "outputKeys required" });
    const code = generateCode({ sources, outputKeys, mappings: mappings || {}, constants: constants || {} });
    res.json({ code });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`);
});
