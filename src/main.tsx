import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import App from "./App.tsx";
import { chooseConvexScreen } from "./convexUrl.ts";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element is missing");
}

const boot = chooseConvexScreen(import.meta.env.VITE_CONVEX_URL);

createRoot(root).render(
  <StrictMode>
    {boot.screen === "provider" ? (
      <ConvexAuthProvider client={new ConvexReactClient(boot.url)}>
        <App />
      </ConvexAuthProvider>
    ) : (
      <main className="page">
        <h1>Нет Convex URL</h1>
        <p>
          Задайте <code>VITE_CONVEX_URL</code>. Без него приложение не
          подключается и не показывает фиктивный проект.
        </p>
      </main>
    )}
  </StrictMode>,
);
