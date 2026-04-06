export function AboutRoute() {
  return (
    <section className="panel page-copy">
      <h2>About This Setup</h2>
      <p>
        This renderer now uses React Router with a hash-based history, which is a good match for
        packaged desktop apps where server-style path rewrites are not guaranteed.
      </p>
      <p>
        Add more screens under <code>src/mainview/routes</code> and extend the router definition in{" "}
        <code>src/mainview/router.tsx</code>.
      </p>
    </section>
  );
}
