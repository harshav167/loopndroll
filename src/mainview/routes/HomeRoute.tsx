import { useState } from "react";

const stack = ["Electrobun", "React 19", "React Router 7", "Vite", "OXC", "tsgo"];

export function HomeRoute() {
  const [laps, setLaps] = useState(1);

  return (
    <>
      <section className="hero">
        <p className="lede">
          A clean starting point for a desktop app powered by Electrobun, React 19, and a fast
          TypeScript toolchain.
        </p>

        <div className="actions">
          <button className="primary" onClick={() => setLaps((value) => value + 1)}>
            Log lap {laps}
          </button>
          <button className="secondary" onClick={() => setLaps(1)}>
            Reset
          </button>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Fast feedback loop</h2>
          <p>
            Run <code>pnpm run dev:hmr</code> while shaping the renderer, or use{" "}
            <code>pnpm run dev</code> for a simpler watch flow.
          </p>
        </article>

        <article className="panel">
          <h2>Tooling</h2>
          <ul className="stack-list">
            {stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Checks</h2>
          <p>
            <code>pnpm run check</code> runs Oxlint, Oxfmt verification, and{" "}
            <code>tsgo --noEmit</code>.
          </p>
        </article>
      </section>
    </>
  );
}
