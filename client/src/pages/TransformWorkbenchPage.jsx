import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import CodeView from "../components/CodeView.jsx";
import TransformPicker from "../components/TransformPicker.jsx";
import { generate } from "../api.js";
import { addInput, normalize, removeInput as removeMappedInput, setSeparator } from "../lib/mapping.js";

const SOURCE_INK = ["#1d3557", "#7a5530", "#3f6b3a", "#8a4d76"];

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function singular(value) {
  const v = String(value || "").toLowerCase();
  return v.endsWith("s") ? v.slice(0, -1) : v;
}

function displayValue(value) {
  if (value === "") return '""';
  if (value === undefined) return "missing";
  if (value === null) return "null";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 42 ? `${text.slice(0, 41)}...` : text;
}

function sampleFor(sources, sourceId, field) {
  const source = sources.find((s) => s.id === sourceId);
  return source?.fields.find((f) => f.name === field)?.sample;
}

function fieldMeta(sources, sourceId, field) {
  const source = sources.find((s) => s.id === sourceId);
  const meta = source?.fields.find((f) => f.name === field);
  return { source, meta };
}

function inferTransform(outputKey, field) {
  const outName = outputKey.name.toLowerCase();
  const fieldName = field.name.toLowerCase();
  if (outputKey.type === "number" && fieldName.includes("cents")) return "centsToDollars";
  if (outputKey.type === "number" && field.type !== "number") return "toNumber";
  if (outputKey.type === "boolean" && field.type !== "boolean") return "toBoolean";
  if (field.type === "date" && /(date|at|time)/.test(outName)) return outName.endsWith("date") ? "toDateOnly" : "isoDate";
  if (outputKey.type === "string" && field.type === "number") return "toString";
  return "identity";
}

function sourceAffinity(outputKey, source) {
  const name = `${outputKey.name} ${source.id} ${source.label}`.toLowerCase();
  let score = 0;
  if (/(customer|user|email|country|signup)/.test(outputKey.name.toLowerCase()) && /(user|customer)/.test(name)) score += 18;
  if (/(product|sku|category|price)/.test(outputKey.name.toLowerCase()) && /product/.test(name)) score += 18;
  if (/(order|status|total|amount|placed)/.test(outputKey.name.toLowerCase()) && /order/.test(name)) score += 18;
  return score;
}

function scoreField(outputKey, source, field) {
  const outNorm = norm(outputKey.name);
  const fieldNorm = norm(field.name);
  const outWords = new Set(words(outputKey.name));
  const fieldWords = words(field.name);
  let score = sourceAffinity(outputKey, source);

  if (outNorm === fieldNorm) score += 120;
  if (outNorm.includes(fieldNorm) || fieldNorm.includes(outNorm)) score += 44;
  for (const word of fieldWords) {
    if (outWords.has(word)) score += 24;
    if (word === "id" && outNorm.endsWith("id")) score += 18;
    if (word === "email" && outNorm.includes("email")) score += 45;
    if (word === "title" && outNorm.includes("title")) score += 40;
    if (word === "status" && outNorm.includes("status")) score += 40;
    if (word === "country" && outNorm.includes("country")) score += 40;
  }
  if (outputKey.type === field.type) score += 10;
  if (outputKey.type === "number" && field.name.toLowerCase().includes("cents")) score += 22;
  if (/(date|at|time)/.test(outputKey.name.toLowerCase()) && field.type === "date") score += 24;
  if (outNorm === "customername" && /(first|last).*name|name/.test(field.name.toLowerCase())) score += 26;
  if (outNorm === "totaldollars" && /(amount|total|price).*cents/.test(field.name.toLowerCase())) score += 70;

  return score;
}

function specialSuggestion(outputKey, sources) {
  const keyNorm = norm(outputKey.name);
  if (keyNorm === "customername" || keyNorm === "fullname") {
    for (const source of sources) {
      const first = source.fields.find((field) => /^(first_?name|given_?name)$/i.test(field.name));
      const last = source.fields.find((field) => /^(last_?name|surname|family_?name)$/i.test(field.name));
      if (first && last) {
        return {
          id: `${source.id}:name-combo`,
          label: `${source.label}.first + last`,
          score: 98,
          separator: " ",
          reason: "name combo",
          inputs: [
            { sourceId: source.id, field: first.name, transform: "identity" },
            { sourceId: source.id, field: last.name, transform: "identity" },
          ],
        };
      }
    }
  }
  return null;
}

function suggestionsFor(outputKey, sources) {
  const suggestions = [];
  const special = specialSuggestion(outputKey, sources);
  if (special) suggestions.push(special);

  for (const source of sources) {
    for (const field of source.fields) {
      const score = scoreField(outputKey, source, field);
      if (score < 32) continue;
      suggestions.push({
        id: `${source.id}:${field.name}`,
        label: `${source.label}.${field.name}`,
        score: Math.min(99, score),
        separator: " ",
        reason: score >= 85 ? "strong match" : "candidate",
        inputs: [{ sourceId: source.id, field: field.name, transform: inferTransform(outputKey, field) }],
      });
    }
  }

  return suggestions
    .sort((a, b) => b.score - a.score)
    .filter((item, index, arr) => arr.findIndex((other) => other.id === item.id) === index)
    .slice(0, 5);
}

function bestRuleFor(source, primary) {
  if (!source || !primary) return { sourceField: "", targetField: "", confidence: 0 };
  const sourceRoot = singular(source.id || source.label);
  let best = { sourceField: "", targetField: "", confidence: 0 };

  for (const sourceField of source.fields) {
    for (const targetField of primary.fields) {
      const sourceNorm = norm(sourceField.name);
      const targetNorm = norm(targetField.name);
      let confidence = 0;

      if (sourceNorm === targetNorm) confidence += 68;
      if (sourceNorm === "id" && targetNorm === `${sourceRoot}id`) confidence += 120;
      if (sourceNorm.endsWith("id") && sourceNorm === targetNorm) confidence += 110;
      if (targetNorm.endsWith("id") && targetNorm.includes(sourceRoot) && sourceNorm.endsWith("id")) confidence += 80;
      if (sourceField.type === targetField.type) confidence += 8;

      if (confidence > best.confidence) {
        best = { sourceField: sourceField.name, targetField: targetField.name, confidence };
      }
    }
  }

  return best;
}

function buildSmartRules(sources, primarySourceId, existing = []) {
  const primary = sources.find((source) => source.id === primarySourceId);
  return sources
    .filter((source) => source.id !== primarySourceId)
    .map((source) => {
      const current = existing.find((rule) => rule.sourceId === source.id);
      const best = bestRuleFor(source, primary);
      return {
        sourceId: source.id,
        targetSourceId: primarySourceId,
        sourceField: current?.sourceField ?? best.sourceField,
        targetField: current?.targetField ?? best.targetField,
        confidence: best.confidence,
      };
    });
}

function jsonFromConstant(value, type) {
  if (value === "") return undefined;
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") return value === "true";
  if (value === "null") return null;
  return value;
}

export default function TransformWorkbenchPage() {
  const { sources, output, transforms, mappings, setMappings, replaceSource, replaceOutput, error } = useOutletContext();
  const defaultPrimary = useMemo(
    () => sources.find((source) => /order/i.test(`${source.id} ${source.label}`))?.id || sources[0]?.id || "",
    [sources]
  );

  const [selectedKey, setSelectedKey] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [primarySourceId, setPrimarySourceId] = useState(defaultPrimary);
  const [matchRules, setMatchRules] = useState([]);
  const [constants, setConstants] = useState({});
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [localError, setLocalError] = useState("");
  const [jsonQuery, setJsonQuery] = useState("");
  const [selectedRecord, setSelectedRecord] = useState("all");
  const [denseJson, setDenseJson] = useState(false);

  useEffect(() => {
    if (!primarySourceId && defaultPrimary) setPrimarySourceId(defaultPrimary);
  }, [defaultPrimary, primarySourceId]);

  useEffect(() => {
    if (!output?.keys.length) return;
    setSelectedKey((current) => current || output.keys[0].name);
  }, [output]);

  useEffect(() => {
    if (!primarySourceId) return;
    setMatchRules((current) => buildSmartRules(sources, primarySourceId, current));
  }, [sources, primarySourceId]);

  const suggestions = useMemo(() => {
    if (!output) return {};
    return Object.fromEntries(output.keys.map((key) => [key.name, suggestionsFor(key, sources)]));
  }, [output, sources]);

  const mappedCount = useMemo(() => {
    if (!output) return 0;
    return output.keys.filter((key) => normalize(mappings[key.name])?.inputs.some((input) => input.sourceId && input.field)).length;
  }, [mappings, output]);

  const selectedOutputKey = output?.keys.find((key) => key.name === selectedKey) || output?.keys[0];
  const totalInputs = useMemo(() => {
    if (!output) return 0;
    return output.keys.reduce((sum, key) => sum + (normalize(mappings[key.name])?.inputs.filter((input) => input.sourceId && input.field).length || 0), 0);
  }, [mappings, output]);

  if (!output) return null;

  function applySuggestion(outputKey, suggestion) {
    setSelectedKey(outputKey);
    setMappings((current) => ({
      ...current,
      [outputKey]: {
        inputs: suggestion.inputs,
        separator: suggestion.separator ?? " ",
      },
    }));
  }

  function addFieldToSelected(sourceId, field) {
    if (!selectedOutputKey) return;
    setSelectedKey(selectedOutputKey.name);
    setMappings((current) =>
      addInput(current, selectedOutputKey.name, {
        sourceId,
        field: field.name,
        transform: inferTransform(selectedOutputKey, field),
      })
    );
  }

  function setInputTransform(outputKey, index, transform) {
    setMappings((current) => {
      const cur = normalize(current[outputKey]);
      if (!cur) return current;
      return {
        ...current,
        [outputKey]: {
          ...cur,
          inputs: cur.inputs.map((input, idx) => (idx === index ? { ...input, transform } : input)),
        },
      };
    });
  }

  function moveInput(outputKey, index, direction) {
    setMappings((current) => {
      const cur = normalize(current[outputKey]);
      if (!cur) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= cur.inputs.length) return current;
      const inputs = [...cur.inputs];
      const [input] = inputs.splice(index, 1);
      inputs.splice(nextIndex, 0, input);
      return { ...current, [outputKey]: { ...cur, inputs } };
    });
  }

  function removeInput(outputKey, input) {
    setMappings((current) => removeInputFromMapping(current, outputKey, input));
  }

  function removeInputFromMapping(current, outputKey, input) {
    return removeMappedInput(current, outputKey, input.sourceId, input.field);
  }

  function changeSeparator(outputKey, separator) {
    setMappings((current) => setSeparator(current, outputKey, separator));
  }

  function clearOutputKey(outputKey) {
    setMappings((current) => {
      const next = { ...current };
      delete next[outputKey];
      return next;
    });
  }

  function autoMatchAll() {
    const next = { ...mappings };
    for (const key of output.keys) {
      const best = suggestions[key.name]?.[0];
      if (best) {
        next[key.name] = { inputs: best.inputs, separator: best.separator ?? " " };
      }
    }
    setMappings(next);
  }

  function updateConstant(outputKey, value) {
    setConstants((current) => ({ ...current, [outputKey]: value }));
  }

  function updateRule(sourceId, patch) {
    setMatchRules((current) => current.map((rule) => (rule.sourceId === sourceId ? { ...rule, ...patch } : rule)));
  }

  async function onGenerate() {
    setLocalError("");
    setGenerating(true);
    try {
      const parsedConstants = Object.fromEntries(
        output.keys
          .map((key) => [key.name, jsonFromConstant(constants[key.name] ?? "", key.type)])
          .filter(([, value]) => value !== undefined)
      );
      const res = await generate({
        sources: sources.map((source) => ({ id: source.id, label: source.label })),
        outputKeys: output.keys,
        mappings,
        constants: parsedConstants,
        primarySourceId,
        matchRules: matchRules.filter((rule) => rule.sourceField && rule.targetField),
      });
      setCode(res.code);
      setPreview(res.preview || null);
      setSelectedRecord("all");
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="workbench">
      <header className="workbench__hero">
        <div>
          <p className="match__eyebrow">Transformation workbench</p>
          <h1 className="match__title">
            Shape many inputs <span className="match__title-em">into one output.</span>
          </h1>
        </div>
        <div className="workbench__metrics">
          <Metric value={sources.length} label="sources" />
          <Metric value={output.keys.length} label="outputs" />
          <Metric value={mappedCount} label="mapped" />
          <Metric value={totalInputs} label="inputs" />
        </div>
      </header>

      {(error || localError) && <div className="match__banner">{error || localError}</div>}

      <div className="workbench__grid">
        <aside className="workbench__pane workbench__pane--sources">
          <PaneHeader title="Input sources" meta={`${sources.length} loaded`} />
          <RecordMatching
            sources={sources}
            primarySourceId={primarySourceId}
            matchRules={matchRules}
            onPrimaryChange={(id) => {
              setPrimarySourceId(id);
              setMatchRules(buildSmartRules(sources, id, []));
            }}
            onRuleChange={updateRule}
          />
          <div className="workbench__search">
            <input
              value={sourceQuery}
              placeholder="Search fields"
              onChange={(event) => setSourceQuery(event.target.value)}
            />
          </div>
          <div className="workbench__source-list">
            {sources.map((source, index) => (
              <SourceBlock
                key={source.id}
                source={source}
                query={sourceQuery}
                ink={SOURCE_INK[index % SOURCE_INK.length]}
                selectedKey={selectedOutputKey?.name}
                onReplace={(file) => replaceSource(index, file)}
                onAddField={addFieldToSelected}
              />
            ))}
          </div>
        </aside>

        <main className="workbench__pane workbench__pane--recipes">
          <PaneHeader title="Output recipe" meta={output.label}>
            <button className="lbtn lbtn--ghost" onClick={autoMatchAll}>Auto-match</button>
            <button className="lbtn lbtn--ghost" onClick={() => setMappings({})}>Clear</button>
          </PaneHeader>
          <div className="workbench__output-file">
            <span>{output.filename}</span>
            <ReplaceFileButton onReplace={replaceOutput} />
          </div>
          <div className="workbench__recipe-list">
            {output.keys.map((key) => (
              <RecipeCard
                key={key.name}
                outputKey={key}
                selected={selectedKey === key.name}
                mapping={normalize(mappings[key.name])}
                sources={sources}
                transforms={transforms}
                suggestions={suggestions[key.name] || []}
                constant={constants[key.name] ?? ""}
                onSelect={() => setSelectedKey(key.name)}
                onSuggestion={(suggestion) => applySuggestion(key.name, suggestion)}
                onTransform={(index, transform) => setInputTransform(key.name, index, transform)}
                onMove={(index, direction) => moveInput(key.name, index, direction)}
                onRemove={(input) => removeInput(key.name, input)}
                onSeparator={(separator) => changeSeparator(key.name, separator)}
                onConstant={(value) => updateConstant(key.name, value)}
                onClear={() => clearOutputKey(key.name)}
              />
            ))}
          </div>
        </main>

        <aside className="workbench__pane workbench__pane--inspector">
          <PaneHeader title="Output inspector" meta={preview?.total ? `${preview.total} generated rows` : "ready"}>
            <button className="lbtn lbtn--primary" disabled={mappedCount === 0 || generating} onClick={onGenerate}>
              {generating ? "Generating..." : "Generate"}
            </button>
          </PaneHeader>

          <div className="workbench__inspector-split">
            <section className="workbench__code-panel">
              <div className="workbench__section-head">
                <span>Transform code</span>
                <span>{code ? "transform.js" : "waiting"}</span>
              </div>
              <CodeView code={code} filename="transform.js" language="javascript" />
            </section>

            <section className="workbench__result-panel">
              <div className="workbench__section-head">
                <span>Result JSON</span>
                <span>{preview?.records ? `${preview.records.length}/${preview.total || preview.records.length}` : "preview"}</span>
              </div>
              <PreviewExplorer
                preview={preview}
                query={jsonQuery}
                onQuery={setJsonQuery}
                selectedRecord={selectedRecord}
                onSelectedRecord={setSelectedRecord}
                dense={denseJson}
                onDense={setDenseJson}
              />
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ value, label }) {
  return (
    <div className="workbench__metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function PaneHeader({ title, meta, children }) {
  return (
    <div className="workbench__pane-head">
      <div>
        <h2>{title}</h2>
        {meta && <p>{meta}</p>}
      </div>
      {children && <div className="workbench__pane-actions">{children}</div>}
    </div>
  );
}

function ReplaceFileButton({ onReplace }) {
  const inputRef = useRef(null);
  return (
    <>
      <button className="lbtn lbtn--xs" onClick={() => inputRef.current?.click()}>Replace</button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv,.tsv"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onReplace(file);
          event.target.value = "";
        }}
      />
    </>
  );
}

function RecordMatching({ sources, primarySourceId, matchRules, onPrimaryChange, onRuleChange }) {
  const primary = sources.find((source) => source.id === primarySourceId);
  return (
    <section className="workbench__match-logic">
      <div className="workbench__label-row">
        <span>Record matching</span>
        <span>{matchRules.filter((rule) => rule.sourceField && rule.targetField).length}/{Math.max(0, sources.length - 1)}</span>
      </div>
      <label className="workbench__field-label">
        <span>Primary output grain</span>
        <select value={primarySourceId} onChange={(event) => onPrimaryChange(event.target.value)}>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.label}</option>
          ))}
        </select>
      </label>

      <div className="workbench__rule-list">
        {matchRules.map((rule) => {
          const source = sources.find((item) => item.id === rule.sourceId);
          if (!source || !primary) return null;
          return (
            <div key={rule.sourceId} className="workbench__rule">
              <span className="workbench__rule-source">{source.label}</span>
              <select value={rule.sourceField} onChange={(event) => onRuleChange(rule.sourceId, { sourceField: event.target.value })}>
                <option value="">source key</option>
                {source.fields.map((field) => (
                  <option key={field.name} value={field.name}>{field.name}</option>
                ))}
              </select>
              <span className="workbench__rule-eq">=</span>
              <select value={rule.targetField} onChange={(event) => onRuleChange(rule.sourceId, { targetField: event.target.value })}>
                <option value="">primary key</option>
                {primary.fields.map((field) => (
                  <option key={field.name} value={field.name}>{field.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SourceBlock({ source, query, ink, selectedKey, onReplace, onAddField }) {
  const q = norm(query);
  const visibleFields = source.fields.filter((field) => !q || norm(`${field.name} ${field.type} ${field.sample}`).includes(q));

  return (
    <section className="workbench__source-card" style={{ "--ink": ink }}>
      <div className="workbench__source-head">
        <div>
          <span>Source</span>
          <strong>{source.label}</strong>
          <em>{source.recordCount} rows</em>
        </div>
        <ReplaceFileButton onReplace={onReplace} />
      </div>
      <div className="workbench__field-list">
        {visibleFields.map((field) => (
          <button
            key={field.name}
            className="workbench__field-row"
            onClick={() => onAddField(source.id, field)}
            title={selectedKey ? `Add to ${selectedKey}` : "Select an output key first"}
          >
            <span className="workbench__field-main">
              <code>{field.name}</code>
              <span className={`match__pill match__pill--${field.type}`}>{field.type}</span>
            </span>
            <span className="workbench__field-sample">{displayValue(field.sample)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RecipeCard({
  outputKey,
  selected,
  mapping,
  sources,
  transforms,
  suggestions,
  constant,
  onSelect,
  onSuggestion,
  onTransform,
  onMove,
  onRemove,
  onSeparator,
  onConstant,
  onClear,
}) {
  const inputs = (mapping?.inputs || []).filter((input) => input.sourceId && input.field);

  return (
    <section className={"workbench__recipe" + (selected ? " is-selected" : "")} onClick={onSelect}>
      <div className="workbench__recipe-head">
        <div>
          <button className="workbench__recipe-title" onClick={onSelect}>
            <code>{outputKey.name}</code>
            <span className={`match__pill match__pill--${outputKey.type}`}>{outputKey.type}</span>
          </button>
          <span className="workbench__recipe-sub">{inputs.length ? `${inputs.length} input${inputs.length === 1 ? "" : "s"}` : "unmapped"}</span>
        </div>
        <button className="workbench__text-btn" onClick={(event) => { event.stopPropagation(); onClear(); }}>Clear</button>
      </div>

      <div className="workbench__suggestions">
        {suggestions.slice(0, 3).map((suggestion) => (
          <button key={suggestion.id} onClick={(event) => { event.stopPropagation(); onSuggestion(suggestion); }}>
            <span>{suggestion.label}</span>
            <em>{suggestion.score}</em>
          </button>
        ))}
      </div>

      {inputs.length > 0 ? (
        <div className="workbench__input-list">
          {inputs.map((input, index) => {
            const { source, meta } = fieldMeta(sources, input.sourceId, input.field);
            return (
              <div key={`${input.sourceId}:${input.field}`} className="workbench__input-row" onClick={(event) => event.stopPropagation()}>
                <div className="workbench__input-main">
                  <span className="workbench__source-chip">{source?.label || input.sourceId}</span>
                  <code>{input.field}</code>
                  <span className="workbench__sample-chip">{displayValue(sampleFor(sources, input.sourceId, input.field))}</span>
                </div>
                <TransformPicker
                  value={input.transform || "identity"}
                  onChange={(transform) => onTransform(index, transform)}
                  sampleValue={meta?.sample}
                  options={transforms}
                />
                <div className="workbench__input-actions">
                  <button onClick={() => onMove(index, -1)} disabled={index === 0} title="Move up">↑</button>
                  <button onClick={() => onMove(index, 1)} disabled={index === inputs.length - 1} title="Move down">↓</button>
                  <button onClick={() => onRemove(input)} title="Remove input">×</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="workbench__empty-line">Use a suggestion, or click a source field while this output is selected.</div>
      )}

      <div className="workbench__recipe-foot" onClick={(event) => event.stopPropagation()}>
        {inputs.length >= 2 && (
          <label>
            <span>Join</span>
            <input value={mapping?.separator ?? " "} onChange={(event) => onSeparator(event.target.value)} placeholder=" " />
          </label>
        )}
        <label>
          <span>Default</span>
          <input value={constant} onChange={(event) => onConstant(event.target.value)} placeholder={outputKey.type === "number" ? "0" : "null"} />
        </label>
      </div>
    </section>
  );
}

function PreviewExplorer({ preview, query, onQuery, selectedRecord, onSelectedRecord, dense, onDense }) {
  if (!preview) {
    return (
      <div className="workbench__preview-empty">
        <p>Generated JSON will appear here with row selection, filtering, and compact view.</p>
      </div>
    );
  }

  if (preview.error) {
    return <div className="match__banner">Could not run transform: {preview.error}</div>;
  }

  const records = preview.records || [];
  const values = records.map((record, index) => ({
    index,
    ok: record.ok,
    value: record.ok ? record.value : { __error: record.error },
    text: JSON.stringify(record.ok ? record.value : { __error: record.error }, null, 2),
  }));
  const q = query.trim().toLowerCase();
  const filtered = q ? values.filter((item) => item.text.toLowerCase().includes(q)) : values;
  const selected = selectedRecord === "all" ? filtered : filtered.filter((item) => item.index === selectedRecord);
  const outputValue = selectedRecord === "all" ? selected.map((item) => item.value) : selected[0]?.value ?? {};
  const json = JSON.stringify(outputValue, null, dense ? 0 : 2);
  const okCount = records.filter((record) => record.ok).length;

  return (
    <div className="workbench__preview">
      <div className="workbench__json-tools">
        <input value={query} placeholder="Filter JSON" onChange={(event) => onQuery(event.target.value)} />
        <button className={selectedRecord === "all" ? "is-active" : ""} onClick={() => onSelectedRecord("all")}>All</button>
        <button className={dense ? "is-active" : ""} onClick={() => onDense(!dense)}>Compact</button>
      </div>

      <div className="workbench__record-strip">
        {values.map((item) => (
          <button
            key={item.index}
            className={(selectedRecord === item.index ? "is-active " : "") + (item.ok ? "" : "is-error")}
            onClick={() => onSelectedRecord(item.index)}
          >
            #{item.index + 1}
          </button>
        ))}
        <span>{okCount}/{records.length} ok</span>
      </div>

      {filtered.length === 0 ? (
        <div className="workbench__preview-empty"><p>No rows match the current filter.</p></div>
      ) : (
        <CodeView code={json} filename="result-output.json" language="json" />
      )}
    </div>
  );
}
