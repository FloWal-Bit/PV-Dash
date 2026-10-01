"use client";

/**
 * Must not use root layout providers (e.g. next-themes) — this tree replaces
 * the root layout when an uncaught error is shown.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          background: "#171d2c",
          color: "#fbf9f5",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          Etwas ist schiefgelaufen
        </h1>
        <p style={{ opacity: 0.85 }}>PV Dash konnte die Seite nicht laden.</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            cursor: "pointer",
          }}
        >
          Erneut versuchen
        </button>
      </body>
    </html>
  );
}
