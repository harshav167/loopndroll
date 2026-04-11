import type { AppRpcSchema } from "../shared/app-rpc";

type AppRpc = {
  request: {
    getWindowState: AppRpcSchema["bun"]["requests"]["getWindowState"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["getWindowState"]["response"]>
      : never;
    windowControl: (
      params: AppRpcSchema["bun"]["requests"]["windowControl"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["windowControl"]["response"]>;
    ensureLoopndrollSetup: AppRpcSchema["bun"]["requests"]["ensureLoopndrollSetup"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["ensureLoopndrollSetup"]["response"]>
      : never;
    getLoopndrollState: AppRpcSchema["bun"]["requests"]["getLoopndrollState"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["getLoopndrollState"]["response"]>
      : never;
    saveDefaultPrompt: (
      params: AppRpcSchema["bun"]["requests"]["saveDefaultPrompt"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["saveDefaultPrompt"]["response"]>;
    setLoopScope: (
      params: AppRpcSchema["bun"]["requests"]["setLoopScope"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setLoopScope"]["response"]>;
    setGlobalPreset: (
      params: AppRpcSchema["bun"]["requests"]["setGlobalPreset"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setGlobalPreset"]["response"]>;
    setSessionPreset: (
      params: AppRpcSchema["bun"]["requests"]["setSessionPreset"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["setSessionPreset"]["response"]>;
    deleteSession: (
      params: AppRpcSchema["bun"]["requests"]["deleteSession"]["params"],
    ) => Promise<AppRpcSchema["bun"]["requests"]["deleteSession"]["response"]>;
    registerHooks: AppRpcSchema["bun"]["requests"]["registerHooks"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["registerHooks"]["response"]>
      : never;
    clearHooks: AppRpcSchema["bun"]["requests"]["clearHooks"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["clearHooks"]["response"]>
      : never;
    revealHooksFile: AppRpcSchema["bun"]["requests"]["revealHooksFile"]["params"] extends undefined
      ? () => Promise<AppRpcSchema["bun"]["requests"]["revealHooksFile"]["response"]>
      : never;
  };
};

let rpcPromise: Promise<AppRpc | null> | null = null;

function hasElectrobunBridge() {
  return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

export async function getAppRpc() {
  if (!hasElectrobunBridge()) {
    return null;
  }

  if (!rpcPromise) {
    rpcPromise = import("electrobun/view").then(({ Electroview }) => {
      const rpc = Electroview.defineRPC<AppRpcSchema>({
        handlers: {},
      });

      new Electroview({ rpc });

      return rpc as AppRpc;
    });
  }

  return rpcPromise;
}
