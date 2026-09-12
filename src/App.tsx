import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function App() {
  const health = useQuery(api.health.ping);

  return (
    <main>
      <p className="eyebrow">Kadr</p>
      <h1>Source is wired to Convex</h1>
      <p>
        Public repo talks to the <code>kadr-ai</code> Convex project. Functions
        live in <code>convex/</code> next to the Vite app.
      </p>
      <p className="status" data-state={health === undefined ? "loading" : "ok"}>
        {health === undefined
          ? "Connecting…"
          : health.ok
            ? "Convex query ok"
            : "Convex query failed"}
      </p>
    </main>
  );
}
