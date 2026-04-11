import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Loop N Roll",
    identifier: "dev.loopndroll.app",
    version: "0.1.0",
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
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
