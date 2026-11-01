import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerAppWorker } from "./pwa";
import "./styles.css";

registerAppWorker(window);

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
