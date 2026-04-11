import type {
  WindowControlAction,
  WindowControlsRpcSchema,
  WindowControlsState,
} from "../shared/window-controls-rpc";

type WindowControlsRpc = {
  request: {
    getWindowState: (params?: undefined) => Promise<WindowControlsState>;
    windowControl: (params: { action: WindowControlAction }) => Promise<WindowControlsState>;
  };
};

let rpcPromise: Promise<WindowControlsRpc | null> | null = null;

function hasElectrobunBridge() {
  return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

async function getWindowControlsRpc() {
  if (!hasElectrobunBridge()) {
    return null;
  }

  if (!rpcPromise) {
    rpcPromise = import("electrobun/view").then(({ Electroview }) => {
      const rpc = Electroview.defineRPC<WindowControlsRpcSchema>({
        handlers: {},
      });

      new Electroview({ rpc });

      return rpc as WindowControlsRpc;
    });
  }

  return rpcPromise;
}

export async function getWindowControlsState() {
  const rpc = await getWindowControlsRpc();
  return rpc?.request.getWindowState();
}

export async function runWindowControl(action: WindowControlAction) {
  const rpc = await getWindowControlsRpc();
  return rpc?.request.windowControl({ action });
}
