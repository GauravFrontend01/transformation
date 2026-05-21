import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, useLocation, NavLink, Navigate } from "react-router-dom";
import StudioPage from "./pages/StudioPage.jsx";
import MatchPage from "./pages/MatchPage.jsx";
import { fetchSamples, fetchTransforms, uploadFile } from "./api.js";

function Layout() {
  const location = useLocation();
  const isLight = location.pathname.startsWith("/match");

  const [sources, setSources] = useState([]);
  const [output, setOutput] = useState(null);
  const [transforms, setTransforms] = useState([]);
  const [mappings, setMappings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([fetchSamples(), fetchTransforms()]);
        setSources(s.sources);
        setOutput(s.output);
        setTransforms(t);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function replaceSource(idx, file) {
    setError("");
    try {
      const src = sources[idx];
      const updated = await uploadFile({ file, role: "source", id: src.id, label: src.label });
      setSources((cur) => cur.map((s, i) => (i === idx ? updated : s)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function replaceOutput(file) {
    setError("");
    try {
      const updated = await uploadFile({ file, role: "output", id: "output", label: "Output schema" });
      setOutput(updated);
      // prune mappings that point to keys no longer in the new schema
      const validKeys = new Set(updated.keys.map((k) => k.name));
      setMappings((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => validKeys.has(k))));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={isLight ? "theme-light" : "theme-dark"}>
      <nav className="topnav">
        <div className="topnav__inner">
          <span className="topnav__brand">
            Transformation <em>Studio</em>
          </span>
          <div className="topnav__tabs">
            <NavLink to="/" end className={({ isActive }) => "topnav__tab" + (isActive ? " is-active" : "")}>
              Studio
            </NavLink>
            <NavLink to="/match" className={({ isActive }) => "topnav__tab" + (isActive ? " is-active" : "")}>
              Match the following
            </NavLink>
          </div>
        </div>
      </nav>
      {loading ? (
        <div className="state">Loading sample data…</div>
      ) : (
        <Outlet
          context={{
            sources,
            output,
            transforms,
            mappings,
            setMappings,
            replaceSource,
            replaceOutput,
            error,
            setError,
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<StudioPage />} />
          <Route path="match" element={<MatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
