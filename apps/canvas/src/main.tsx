import React from "react";
import { createRoot } from "react-dom/client";
import Regions from "./regions/Regions";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Regions />
  </React.StrictMode>,
);
