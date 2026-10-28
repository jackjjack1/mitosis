export function EmptyState({
  loading,
  error,
  dragging,
  onBrowse,
  onSample,
}: {
  loading: boolean;
  error: string | null;
  dragging: boolean;
  onBrowse: () => void;
  onSample: (kind: "image" | "text" | "binary") => void;
}) {
  return (
    <section className="empty-state">
      <div className="empty-copy">
        <p className="eyebrow">CLONING LAB / SELF-IMPROVING / LOCAL ONLY</p>
        <h2>
          Drop anything.
          <br />
          Watch it <em>replicate</em>.
        </h2>
        <p className="lede">
          Images, text, code, raw binaries, artifacts that refuse to say what they
          are. MITOSIS dissects the file, rebuilds it, scores the match, then mutates
          its own strategy until the copy gets better.
        </p>
      </div>

      <div
        className={`drop-plate ${loading ? "is-loading" : ""} ${
          dragging ? "is-dragging" : ""
        }`}
        role="button"
        tabIndex={0}
        aria-label="Drop a file or browse to choose one"
        onClick={() => !loading && onBrowse()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !loading) {
            event.preventDefault();
            onBrowse();
          }
        }}
      >
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <div className="dish" aria-hidden="true">
          <span className="ring ring-a" />
          <span className="ring ring-b" />
          <span className="cell cell-a" />
          <span className="cell cell-b" />
          {loading ? (
            <span className="dish-label scanning">DISSECTING</span>
          ) : (
            <span className="dish-label">DROP</span>
          )}
          {loading && <span className="scanline" />}
        </div>
        <p className="drop-title">
          {loading
            ? "READING THE SURFACE"
            : dragging
              ? "RELEASE TO DISSECT"
              : "DRAG A FILE FROM ANYWHERE"}
        </p>
        <p className="drop-sub">
          or click to browse <span>·</span> any format <span>·</span> stays on this
          device
        </p>
        <span className="plate-code">SPECIMEN INTAKE / 00</span>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="specimen-strip">
        <span>NO FILE HANDY?</span>
        <button type="button" onClick={() => onSample("image")} disabled={loading}>
          CELL IMAGE
        </button>
        <button type="button" onClick={() => onSample("text")} disabled={loading}>
          FIELD NOTES
        </button>
        <button type="button" onClick={() => onSample("binary")} disabled={loading}>
          UNKNOWN BINARY
        </button>
      </div>

      <div className="primer-grid">
        <article>
          <span>01 / DISSECT</span>
          <h3>Read the evidence.</h3>
          <p>
            Magic bytes, entropy, section tables, palette samples, token cadence. No
            flattery, no claims past what the file actually shows.
          </p>
        </article>
        <article>
          <span>02 / RECALL</span>
          <h3>Start from memory.</h3>
          <p>
            Every run is retained in this browser. New artifacts inherit the strongest
            genome found for their class instead of starting blank.
          </p>
        </article>
        <article>
          <span>03 / REFLECT</span>
          <h3>Keep what survives.</h3>
          <p>
            A selection loop mutates palette, context order, and entropy blend. Only
            mutations that improve the match are written back to the lab&apos;s mind.
          </p>
        </article>
      </div>
    </section>
  );
}
