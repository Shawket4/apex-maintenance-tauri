import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./shared/i18n";
import { App } from "./app/App";

import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  (window as any).global = window;
  (window as any).Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
