import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import "./App.css";

// WebKit/WebView compatibility for pdf.js URL helpers.
if (typeof (URL as { parse?: unknown; }).parse !== "function") {
  (URL as typeof URL & { parse: (input: string, base?: string | URL) => URL | null; }).parse = (
    input,
    base
  ) => {
    try {
      return new URL(input, base);
    } catch {
      return null;
    }
  };
}

if (typeof (URL as { canParse?: unknown; }).canParse !== "function") {
  (URL as typeof URL & { canParse: (input: string, base?: string | URL) => boolean; }).canParse = (
    input,
    base
  ) => {
    try {
      // eslint-disable-next-line no-new
      new URL(input, base);
      return true;
    } catch {
      return false;
    }
  };
}

if (typeof (Promise as { try?: unknown; }).try !== "function") {
  (
    Promise as typeof Promise & {
      try: <T>(fn: () => T | PromiseLike<T>) => Promise<T>;
    }
  ).try = (fn) => Promise.resolve().then(fn);
}

if (typeof (Promise as { withResolvers?: unknown; }).withResolvers !== "function") {
  (
    Promise as typeof Promise & {
      withResolvers: () => {
        promise: Promise<unknown>;
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
      };
    }
  ).withResolvers = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
