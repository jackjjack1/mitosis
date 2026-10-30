import { useEffect, useRef, useState } from "react";
import type { Feature, FeatureSet } from "../engine/features";
import type { Artifact } from "../engine/types";
import { copyText, downloadFeatureBundle, featureBundleName } from "../features/featureBundle";
import { fmtBytes } from "../engine/util";

export function FeatureSheet({
  artifact,
  set,
  onBrowse,
}: {
  artifact: Artifact;
  set: FeatureSet;
  onBrowse: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy(feature: Feature): Promise<void> {
    const ok = await copyText(feature.copy);
    setCopied(ok ? feature.id : null);
    setNote(ok ? null : "Clipboard is unavailable — download the bundle instead.");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(null);
      setNote(null);
    }, 2400);
  }

  return (
    <section className="sheet">
      <header className="sheet-head">
        <div className="sheet-copy">
          <p className="eyebrow">FEATURES / {artifact.format}</p>
          <h2 title={artifact.name}>{artifact.name}</h2>
          <p className="lede">
            {set.headline}. Copy any block, or take every file in one bundle.
          </p>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="primary sheet-download"
            onClick={() => downloadFeatureBundle(set)}
          >
            DOWNLOAD FEATURES
            <span>.ZIP</span>
          </button>
          <button type="button" className="sheet-again" onClick={onBrowse}>
            DROP ANOTHER
          </button>
        </div>
      </header>

      <div className="sheet-meta">
        {set.summary.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
        <div>
          <span>SHA-256</span>
          <b title={artifact.hash}>{artifact.hash.slice(0, 12).toUpperCase()}…</b>
        </div>
        <div>
          <span>BUNDLE</span>
          <b>{featureBundleName(set)}</b>
        </div>
      </div>

      <div className="feature-grid">
        {set.features.map((feature, index) => (
          <article className="feature-card" key={feature.id}>
            <header>
              <span className="feature-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="feature-label">{feature.label}</span>
              <span className="feature-format">{feature.copyLabel}</span>
            </header>
            <h3>{feature.title}</h3>
            <p>{feature.detail}</p>
            <div className="feature-foot">
              <button
                type="button"
                className={copied === feature.id ? "is-copied" : ""}
                onClick={() => {
                  void handleCopy(feature);
                }}
              >
                {copied === feature.id ? "COPIED" : "COPY"}
              </button>
              <span>{feature.files.join(" · ")}</span>
            </div>
          </article>
        ))}
      </div>

      {note && <p className="error-message">{note}</p>}

      <div className="sheet-foot">
        <span>
          {set.files.length} files · {fmtBytes(set.size)} artifact · nothing uploaded
        </span>
        <span>plain text · JSON · CSS · Markdown</span>
      </div>
    </section>
  );
}
