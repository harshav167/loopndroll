import {
  ApplicationMenu,
  BrowserWindow,
  Utils,
  Updater,
  defineElectrobunRPC,
  type UpdateStatusEntry,
} from "electrobun/bun";
import type {
  AppRpcSchema,
  AppUpdateState,
  WindowControlAction,
  WindowControlsState,
} from "../shared/app-rpc";
import {
  clearHooks,
  createCompletionCheck,
  createLoopNotification,
  deleteCompletionCheck,
  deleteLoopNotification,
  ensureLoopndrollSetup,
  getTelegramChats as fetchTelegramChats,
  getLoopndrollSnapshot,
  registerHooks,
  revealHooksFile,
  saveDefaultPrompt,
  deleteSession,
  setGlobalCompletionCheckConfig,
  setGlobalNotification,
  setGlobalPreset,
  setSessionArchived as persistSessionArchived,
  setSessionCompletionCheckConfig,
  setSessionNotifications as persistSessionNotifications,
  setLoopScope,
  setSessionPreset,
  startLoopndrollTelegramBridge,
  updateCompletionCheck,
  updateLoopNotification,
} from "./loopndroll";

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
const APP_UPDATE_CHECK_DELAY_MS = 5000;
const APP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let mainWindow: BrowserWindow<ReturnType<typeof createWindowRpc>>;
let updateCheckPromise: Promise<AppUpdateState> | null = null;
let updateDownloadPromise: Promise<void> | null = null;

let appUpdateState: AppUpdateState = {
  currentVersion: null,
  currentChannel: null,
  releaseBaseUrl: null,
  availableVersion: null,
  stage: "idle",
  isConfigured: false,
  isChecking: false,
  isDownloading: false,
  isUpdateAvailable: false,
  isUpdateReady: false,
  statusMessage: null,
  errorMessage: null,
  lastCheckedAt: null,
};

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function setAppUpdateState(nextState: Partial<AppUpdateState>) {
  appUpdateState = {
    ...appUpdateState,
    ...nextState,
  };

  return appUpdateState;
}

async function syncLocalUpdateState() {
  const [currentVersion, currentChannel, releaseBaseUrl] = await Promise.all([
    Updater.localInfo.version(),
    Updater.localInfo.channel(),
    Updater.localInfo.baseUrl(),
  ]);
  const normalizedBaseUrl = releaseBaseUrl.trim();

  return setAppUpdateState({
    currentVersion,
    currentChannel,
    releaseBaseUrl: normalizedBaseUrl || null,
    isConfigured: normalizedBaseUrl.length > 0,
  });
}

function applyUpdaterStatus(entry: UpdateStatusEntry) {
  switch (entry.status) {
    case "checking":
      setAppUpdateState({
        stage: "checking",
        isChecking: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "no-update":
      setAppUpdateState({
        stage: "idle",
        availableVersion: null,
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: false,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: null,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "update-available":
      setAppUpdateState({
        stage: "available",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: entry.message,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "download-starting":
    case "checking-local-tar":
    case "local-tar-found":
    case "local-tar-missing":
    case "fetching-patch":
    case "patch-found":
    case "patch-not-found":
    case "downloading-patch":
    case "applying-patch":
    case "patch-applied":
    case "extracting-version":
    case "patch-chain-complete":
    case "downloading-full-bundle":
    case "download-progress":
    case "decompressing":
      setAppUpdateState({
        stage: "downloading",
        isChecking: false,
        isDownloading: true,
        isUpdateAvailable: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "download-complete":
      setAppUpdateState({
        stage: "ready",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: true,
        errorMessage: null,
        statusMessage: "Update ready to install.",
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    case "applying":
    case "extracting":
    case "replacing-app":
    case "launching-new-version":
    case "complete":
      setAppUpdateState({
        stage: "ready",
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: true,
        isUpdateReady: true,
        errorMessage: null,
        statusMessage: entry.message,
      });
      return;
    case "error":
      setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isChecking: false,
        isDownloading: false,
        errorMessage: entry.message,
        statusMessage: entry.message,
        lastCheckedAt: getCurrentTimestamp(),
      });
      return;
    default:
      return;
  }
}

async function checkForAppUpdate() {
  await syncLocalUpdateState();

  if (!appUpdateState.isConfigured || appUpdateState.currentChannel === "dev") {
    return setAppUpdateState({
      stage: "idle",
      availableVersion: null,
      isChecking: false,
      isDownloading: false,
      isUpdateAvailable: false,
      isUpdateReady: false,
      statusMessage: null,
      errorMessage: null,
    });
  }

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = (async () => {
    setAppUpdateState({
      stage: "checking",
      isChecking: true,
      errorMessage: null,
      statusMessage: "Checking for updates...",
    });

    try {
      const updateInfo = await Updater.checkForUpdate();

      if (updateInfo.error) {
        return setAppUpdateState({
          stage: appUpdateState.isUpdateAvailable ? "available" : "error",
          availableVersion: null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: false,
          isUpdateReady: false,
          statusMessage: updateInfo.error,
          errorMessage: updateInfo.error,
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      if (updateInfo.updateReady) {
        return setAppUpdateState({
          stage: "ready",
          availableVersion: updateInfo.version || null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: true,
          errorMessage: null,
          statusMessage: "Update ready to install.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      if (updateInfo.updateAvailable) {
        return setAppUpdateState({
          stage: "available",
          availableVersion: updateInfo.version || null,
          isChecking: false,
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: false,
          errorMessage: null,
          statusMessage: "Update available.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }

      return setAppUpdateState({
        stage: "idle",
        availableVersion: null,
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: false,
        isUpdateReady: false,
        errorMessage: null,
        statusMessage: null,
        lastCheckedAt: getCurrentTimestamp(),
      });
    } catch (error) {
      return setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isChecking: false,
        errorMessage: error instanceof Error ? error.message : "Failed to check for updates.",
        statusMessage: error instanceof Error ? error.message : "Failed to check for updates.",
        lastCheckedAt: getCurrentTimestamp(),
      });
    } finally {
      updateCheckPromise = null;
    }
  })();

  return updateCheckPromise;
}

async function downloadAppUpdate() {
  await syncLocalUpdateState();

  if (appUpdateState.isUpdateReady || appUpdateState.isDownloading) {
    return appUpdateState;
  }

  if (!appUpdateState.isUpdateAvailable) {
    await checkForAppUpdate();
  }

  if (!appUpdateState.isUpdateAvailable || updateDownloadPromise) {
    return appUpdateState;
  }

  setAppUpdateState({
    stage: "downloading",
    isDownloading: true,
    errorMessage: null,
    statusMessage: "Downloading update...",
  });

  updateDownloadPromise = (async () => {
    try {
      await Updater.downloadUpdate();

      if (Updater.updateInfo()?.updateReady) {
        setAppUpdateState({
          stage: "ready",
          isDownloading: false,
          isUpdateAvailable: true,
          isUpdateReady: true,
          errorMessage: null,
          statusMessage: "Update ready to install.",
          lastCheckedAt: getCurrentTimestamp(),
        });
      }
    } catch (error) {
      setAppUpdateState({
        stage: appUpdateState.isUpdateAvailable ? "available" : "error",
        isDownloading: false,
        errorMessage: error instanceof Error ? error.message : "Failed to download update.",
        statusMessage: error instanceof Error ? error.message : "Failed to download update.",
      });
    } finally {
      updateDownloadPromise = null;
    }
  })();

  return appUpdateState;
}

async function applyAppUpdate() {
  if (!appUpdateState.isUpdateReady) {
    return appUpdateState;
  }

  setAppUpdateState({
    statusMessage: "Restarting to update...",
  });

  void Updater.applyUpdate().catch((error) => {
    setAppUpdateState({
      stage: "ready",
      errorMessage: error instanceof Error ? error.message : "Failed to apply update.",
      statusMessage: error instanceof Error ? error.message : "Failed to apply update.",
    });
  });

  return appUpdateState;
}

async function initializeUpdater() {
  await syncLocalUpdateState();

  if (!appUpdateState.isConfigured || appUpdateState.currentChannel === "dev") {
    return;
  }

  Updater.onStatusChange(applyUpdaterStatus);

  setTimeout(() => {
    void checkForAppUpdate();
  }, APP_UPDATE_CHECK_DELAY_MS);

  setInterval(() => {
    void checkForAppUpdate();
  }, APP_UPDATE_CHECK_INTERVAL_MS);
}

function installApplicationMenu() {
  if (!isMac) {
    return;
  }

  ApplicationMenu.setApplicationMenu([
    {
      label: "Loopndroll",
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "divider" },
        { role: "bringAllToFront" },
      ],
    },
  ]);
}

function getWindowState(): WindowControlsState {
  return {
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
    platform: process.platform,
  };
}

function createWindowRpc() {
  return defineElectrobunRPC<AppRpcSchema>("bun", {
    maxRequestTime: 60_000,
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
        getAppUpdateState() {
          return appUpdateState;
        },
        checkForAppUpdate() {
          return checkForAppUpdate();
        },
        downloadAppUpdate() {
          return downloadAppUpdate();
        },
        applyAppUpdate() {
          return applyAppUpdate();
        },
        ensureLoopndrollSetup() {
          return ensureLoopndrollSetup();
        },
        getLoopndrollState() {
          return getLoopndrollSnapshot();
        },
        saveDefaultPrompt({ defaultPrompt }: { defaultPrompt: string }) {
          return saveDefaultPrompt(defaultPrompt);
        },
        createNotification({ notification }) {
          return createLoopNotification(notification);
        },
        createCompletionCheck({ completionCheck }) {
          return createCompletionCheck(completionCheck);
        },
        getTelegramChats({ botToken, waitForUpdates }) {
          return fetchTelegramChats(botToken, waitForUpdates);
        },
        openExternalUrl({ url }) {
          return Utils.openExternal(url);
        },
        updateNotification({ notification }) {
          return updateLoopNotification(notification);
        },
        updateCompletionCheck({ completionCheck }) {
          return updateCompletionCheck(completionCheck);
        },
        setSessionNotifications({ sessionId, notificationIds }) {
          return persistSessionNotifications(sessionId, notificationIds);
        },
        deleteNotification({ notificationId }) {
          return deleteLoopNotification(notificationId);
        },
        deleteCompletionCheck({ completionCheckId }) {
          return deleteCompletionCheck(completionCheckId);
        },
        setLoopScope({ scope }) {
          return setLoopScope(scope);
        },
        setGlobalPreset({ preset }) {
          return setGlobalPreset(preset);
        },
        setGlobalNotification({ notificationId }) {
          return setGlobalNotification(notificationId);
        },
        setGlobalCompletionCheckConfig({ completionCheckId, waitForReplyAfterCompletion }) {
          return setGlobalCompletionCheckConfig(completionCheckId, waitForReplyAfterCompletion);
        },
        setSessionPreset({ sessionId, preset }) {
          return setSessionPreset(sessionId, preset);
        },
        setSessionCompletionCheckConfig({
          sessionId,
          completionCheckId,
          waitForReplyAfterCompletion,
        }) {
          return setSessionCompletionCheckConfig(
            sessionId,
            completionCheckId,
            waitForReplyAfterCompletion,
          );
        },
        setSessionArchived({ sessionId, archived }) {
          return persistSessionArchived(sessionId, archived);
        },
        deleteSession({ sessionId }) {
          return deleteSession(sessionId);
        },
        registerHooks() {
          return registerHooks();
        },
        clearHooks() {
          return clearHooks();
        },
        revealHooksFile() {
          return revealHooksFile();
        },
      },
    },
  });
}

const windowRpc = createWindowRpc();

installApplicationMenu();
startLoopndrollTelegramBridge();
void initializeUpdater();

mainWindow = new BrowserWindow({
  title: "Loopndroll",
  url: await getRendererUrl(),
  rpc: windowRpc,
  titleBarStyle: isMac ? "hidden" : "default",
  transparent: isMac,
  frame: {
    width: 1024,
    height: 768,
    x: 160,
    y: 120,
  },
});

console.log(`Started Electrobun window ${mainWindow.id}`);
