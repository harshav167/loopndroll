import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Client as Styletron } from "styletron-engine-atomic";
import { Provider as StyletronProvider } from "styletron-react";
import "./index.css";
import { router } from "./router";

const engine = new Styletron();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StyletronProvider value={engine}>
      <RouterProvider router={router} />
    </StyletronProvider>
  </StrictMode>,
);
