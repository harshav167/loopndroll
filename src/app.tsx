import { Gear } from "@phosphor-icons/react";
import { Outlet, useNavigate } from "react-router-dom";
import { WindowTrafficLights } from "@/components/window-traffic-lights";
import { Button } from "@/components/ui/button";

function App() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[12px] border border-white/10 bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <header className="electrobun-webkit-app-region-drag relative z-20 h-14 flex-none bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <WindowTrafficLights />
        <div className="electrobun-webkit-app-region-no-drag absolute inset-y-0 right-4 flex items-center gap-2 md:right-8">
          <Button
            onClick={() => navigate("/design-system")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Design System
          </Button>
          <Button size="sm" type="button" variant="outline">
            <Gear data-icon="inline-start" weight="regular" />
            Settings
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-transparent">
        <div className="min-h-0 h-full overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default App;
