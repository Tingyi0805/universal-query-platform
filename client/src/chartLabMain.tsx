// Dedicated static Stage-18 test entry. Does not import App, auth or API.
import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {DashboardChartSyntheticLabPage} from "./pages/DashboardChartSyntheticLabPage";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
 <StrictMode>
  <MemoryRouter>
   <DashboardChartSyntheticLabPage standalone />
  </MemoryRouter>
 </StrictMode>
);
