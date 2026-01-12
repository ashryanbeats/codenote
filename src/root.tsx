import { Link, Outlet, useLocation, useNavigation } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";

export function Root() {
  const nav = useNavigation();
  const location = useLocation();
  const isDashboard =
    location.pathname === "/dashboard" || location.pathname === "/";
  return (
    <div className="relative min-h-screen bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.25),_transparent_55%)]" />
      <div className="relative">
        <header className="border-b border-border/70 bg-white/80 backdrop-blur">
          <div className="container flex h-16 items-center gap-4">
            <Link to="/dashboard" className="text-lg font-semibold tracking-tight">
              Codenote
            </Link>
            {isDashboard ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            )}
            <div className="ml-auto flex items-center gap-3">
              {nav.state !== "idle" ? (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Loading...
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <main className="container py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
