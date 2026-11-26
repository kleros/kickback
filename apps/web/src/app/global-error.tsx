"use client";

import { useEffect } from "react";

/** A crash in the root layout or its providers: replaces the whole page, so it brings its own plain styles. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("App error", error.digest ?? "");
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#faf8fd",
          color: "#17131f",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          display: "grid",
          placeItems: "center",
          padding: "16px",
          boxSizing: "border-box",
        }}
      >
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 26, lineHeight: "32px", margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", lineHeight: "22px" }}>
            Reload the page to try again. If it happens again, try another browser or wallet.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 44,
              padding: "0 20px",
              border: 0,
              borderRadius: 8,
              background: "#4d00b4",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload the page
          </button>
        </main>
      </body>
    </html>
  );
}
