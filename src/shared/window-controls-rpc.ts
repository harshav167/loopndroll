export type WindowControlAction = "close" | "minimize" | "toggle-primary";

export type WindowControlsState = {
  isFullScreen: boolean;
  isMaximized: boolean;
  platform: string;
};

export type WindowControlsRpcSchema = {
  bun: {
    requests: {
      getWindowState: {
        params: undefined;
        response: WindowControlsState;
      };
      windowControl: {
        params: {
          action: WindowControlAction;
        };
        response: WindowControlsState;
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {};
  };
};
