import { BrowserWindow, Updater, defineElectrobunRPC } from "electrobun/bun";
import type {
  WindowControlAction,
  WindowControlsRpcSchema,
  WindowControlsState,
} from "../shared/window-controls-rpc";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const DEV_SERVER_WAIT_MS = 15000;
const DEV_SERVER_RETRY_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevServer() {
  const deadline = Date.now() + DEV_SERVER_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return true;
    } catch {
      await sleep(DEV_SERVER_RETRY_MS);
    }
  }

  return false;
}

async function getRendererUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();

  if (channel === "dev") {
    if (await waitForDevServer()) {
      console.log(`Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    }

    console.log("Vite dev server was not reachable in time. Falling back to bundled renderer.");
  }

  return "views://app/index.html";
}

const isMac = process.platform === "darwin";

let mainWindow: BrowserWindow<ReturnType<typeof createWindowRpc>>;

function getWindowState(): WindowControlsState {
  return {
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
    platform: process.platform,
  };
}

function createWindowRpc() {
  return defineElectrobunRPC<WindowControlsRpcSchema>("bun", {
    handlers: {
      requests: {
        getWindowState() {
          return getWindowState();
        },
        windowControl({ action }: { action: WindowControlAction }) {
          switch (action) {
            case "close":
              mainWindow.close();
              break;
            case "minimize":
              mainWindow.minimize();
              break;
            case "toggle-primary":
              if (isMac) {
                mainWindow.setFullScreen(!mainWindow.isFullScreen());
              } else if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
              } else {
                mainWindow.maximize();
              }
              break;
          }

          return getWindowState();
        },
      },
    },
  });
}

const windowRpc = createWindowRpc();

mainWindow = new BrowserWindow({
  title: "Loop N Roll",
  url: await getRendererUrl(),
  rpc: windowRpc,
  titleBarStyle: isMac ? "hidden" : "default",
  transparent: isMac,
  frame: {
    width: 1180,
    height: 820,
    x: 160,
    y: 120,
  },
});

console.log(`Started Electrobun window ${mainWindow.id}`);
