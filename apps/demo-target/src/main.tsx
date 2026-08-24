import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { parseBreakMode } from "./domain";
import "./styles.css";

const breakMode = parseBreakMode(new URLSearchParams(window.location.search).get("breakMode"));
createRoot(document.getElementById("root")!).render(<StrictMode><App initialBreakMode={breakMode} /></StrictMode>);
