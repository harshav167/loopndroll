import { createHashRouter } from "react-router-dom";
import App from "./app";
import { DesignSystemRoute } from "./pages/design-system";
import { HomeRoute } from "./pages/home";

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
        path: "design-system",
        element: <DesignSystemRoute />,
      },
    ],
  },
]);
