import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const mq = window.matchMedia("(prefers-color-scheme: dark)");
const applyDark = () => document.documentElement.classList.toggle("dark", mq.matches);
applyDark();
mq.addEventListener("change", applyDark);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
