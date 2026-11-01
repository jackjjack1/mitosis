export function DropZone({
  loading,
  error,
  dragging,
  onBrowse,
  onSample,
  onBatch,
  onFolder,
}: {
  loading: boolean;
  error: string | null;
  dragging: boolean;
  onBrowse: () => void;
  onSample: (kind: "image" | "text" | "binary" | "audio" | "pdf" | "sheet") => void;
  onBatch: () => void;
  onFolder: () => void;
}) {
  return (
    <section className="empty-state">
      <div className="empty-copy">
        <p className="eyebrow">DROP · DISSECT · REUSE</p>
        <h2>
          Drop a file.
          <br />
          Take the <em>useful parts</em>.
        </h2>
        <p className="lede">
          MITOSIS reads the artifact and hands back plain, reusable pieces: palettes,
          voice profiles, API surfaces, dependencies, structure, strings. Evolve a
          reconstruction, export it, or save the run as a .clone session.
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
            <span className="dish-label scanning">READING</span>
          ) : (
            <span className="dish-label">DROP</span>
          )}
          {loading && <span className="scanline" />}
        </div>
        <p className="drop-title">
          {loading
            ? "EXTRACTING FEATURES"
            : dragging
              ? "RELEASE TO EXTRACT"
              : "DRAG A FILE FROM ANYWHERE"}
        </p>
        <p className="drop-sub">
          or click to browse <span>·</span> any format <span>·</span> stays on this
          device
        </p>
        <span className="plate-code">ONE FILE IN / USABLE PARTS OUT</span>
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
        <button type="button" onClick={() => onSample("audio")} disabled={loading}>
          WAVE
        </button>
        <button type="button" onClick={() => onSample("pdf")} disabled={loading}>
          PAGE
        </button>
        <button type="button" onClick={() => onSample("sheet")} disabled={loading}>
          TABLE
        </button>
        <button type="button" onClick={onBatch} disabled={loading}>
          TRY A BATCH
        </button>
        <button type="button" onClick={onFolder} disabled={loading}>
          FOLDER
        </button>
      </div>
    </section>
  );
}
