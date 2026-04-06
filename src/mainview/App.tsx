import { NavLink, Outlet } from "react-router-dom";

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Desktop Starter</p>
          <h1>Loop N Roll</h1>
        </div>

        <nav className="nav" aria-label="Primary">
          <NavLink
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
            end
            to="/"
          >
            Home
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
            to="/about"
          >
            About
          </NavLink>
        </nav>
      </header>

      <Outlet />
    </main>
  );
}

export default App;
