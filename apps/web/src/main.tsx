import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { V5Dashboard } from "./v5/V5Dashboard";
import "./styles.css";

// Hash route: the spec_v5.1 dashboard is now the DEFAULT entry; the V4 App stays fully reachable at
// #v4 (and the legacy #v5 still works). V5 and V4 remain parallel — V4 is not removed.
function Root() {
  const [hash, setHash] = useState(typeof window !== "undefined" ? window.location.hash : "");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash === "#v4" ? <App /> : <V5Dashboard />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
