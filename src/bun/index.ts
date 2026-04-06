import { BrowserWindow, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();

  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Using bundled renderer. Run `pnpm run dev:hmr` for live reload.");
    }
  }

  return "views://mainview/index.html";
}

const mainWindow = new BrowserWindow({
  title: "Loop N Roll",
  url: await getMainViewUrl(),
  frame: {
    width: 1180,
    height: 820,
    x: 160,
    y: 120,
  },
});

console.log(`Started Electrobun window ${mainWindow.id}`);
