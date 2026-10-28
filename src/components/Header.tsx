import { useState } from "react";
import type { Mind } from "../engine/types";

export function Header({
  mind,
  live,
  onReset,
}: {
  mind: Mind;
  live: boolean;
  onReset: () => void;
}) {
  const [confirm, setConfirm] = useState(false);

  const reset = () => {
    if (!confirm) {
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 2800);
      return;
    }
    setConfirm(false);
    onReset();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="brand-text">
          <h1>MITOSIS</h1>
          <p>artifact cloning lab</p>
        </div>
      </div>

      <div className="topbar-right">
        <div className={`lab-status ${live ? "is-live" : ""}`}>
          <i className="pulse-dot" />
          {live ? "LAB AWAKE" : "LAB QUIESCENT"}
        </div>
        <div className="topstats">
          <div>
            <span>GENERATIONS</span>
            <b>{mind.generations.toLocaleString()}</b>
          </div>
          <div>
            <span>SPECIMENS</span>
            <b>{mind.runs}</b>
          </div>
          <div>
            <span>MUTATIONS KEPT</span>
            <b>{mind.accepted.toLocaleString()}</b>
          </div>
        </div>
        <button
          type="button"
          className={`reset-mind ${confirm ? "confirm" : ""}`}
          onClick={reset}
          title="Clear local memory and the current run"
        >
          {confirm ? "CONFIRM?" : "RESET MIND"}
        </button>
      </div>
    </header>
  );
}
