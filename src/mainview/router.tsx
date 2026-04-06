import { createHashRouter } from "react-router-dom";
import App from "./App";
import { AboutRoute } from "./routes/AboutRoute";
import { HomeRoute } from "./routes/HomeRoute";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <HomeRoute />,
      },
      {
        path: "about",
        element: <AboutRoute />,
      },
    ],
  },
]);
