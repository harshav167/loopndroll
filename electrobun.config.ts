import type { ElectrobunConfig } from "electrobun";

const releaseBaseUrl = process.env["RELEASE_BASE_URL"] || "";
const enableCodesign = process.env["ELECTROBUN_ENABLE_CODESIGN"] === "true";
const enableNotarize = process.env["ELECTROBUN_ENABLE_NOTARIZE"] === "true";

export default {
  app: {
    name: "Loopndroll",
    identifier: "dev.loopndroll.app",
    version: "0.1.0",
  },
  release: {
    baseUrl: releaseBaseUrl,
    generatePatch: false,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/index.html": "views/app/index.html",
      "dist/assets": "views/app/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      codesign: enableCodesign,
      notarize: enableNotarize,
      bundleCEF: false,
      icons: "build/icon.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "build/icon.png",
    },
    win: {
      bundleCEF: false,
      icon: "build/icon.png",
    },
  },
} satisfies ElectrobunConfig;
