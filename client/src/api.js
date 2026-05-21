const BASE = "";

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchSamples() {
  return jsonOrThrow(await fetch(`${BASE}/api/samples`));
}

export async function fetchTransforms() {
  return jsonOrThrow(await fetch(`${BASE}/api/transforms`));
}

export async function uploadFile({ file, role, id, label }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("role", role);
  if (id) fd.append("id", id);
  if (label) fd.append("label", label);
  return jsonOrThrow(await fetch(`${BASE}/api/parse`, { method: "POST", body: fd }));
}

export async function generate(payload) {
  return jsonOrThrow(
    await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}
