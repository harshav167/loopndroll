export type WindowControlAction = "close" | "minimize" | "toggle-primary";

export type WindowControlsState = {
  isFullScreen: boolean;
  isMaximized: boolean;
  platform: string;
};

export type LoopScope = "global" | "per-task";

export type LoopPreset = "infinite" | "max-turns-1" | "max-turns-2" | "max-turns-3";

export type LoopSession = {
  sessionId: string;
  source: "startup" | "resume" | "stop";
  firstSeenAt: string;
  lastSeenAt: string;
  stopCount: number;
  preset: LoopPreset | null;
  title: string | null;
  transcriptPath: string | null;
  lastAssistantMessage: string | null;
};

export type LoopndrollSnapshot = {
  defaultPrompt: string;
  scope: LoopScope;
  globalPreset: LoopPreset | null;
  hooksAutoRegistration: boolean;
  health: {
    registered: boolean;
    issues: string[];
  };
  sessions: LoopSession[];
};

export type AppRpcSchema = {
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
      ensureLoopndrollSetup: {
        params: undefined;
        response: LoopndrollSnapshot;
      };
      getLoopndrollState: {
        params: undefined;
        response: LoopndrollSnapshot;
      };
      saveDefaultPrompt: {
        params: {
          defaultPrompt: string;
        };
        response: LoopndrollSnapshot;
      };
      setLoopScope: {
        params: {
          scope: LoopScope;
        };
        response: LoopndrollSnapshot;
      };
      setGlobalPreset: {
        params: {
          preset: LoopPreset | null;
        };
        response: LoopndrollSnapshot;
      };
      setSessionPreset: {
        params: {
          sessionId: string;
          preset: LoopPreset | null;
        };
        response: LoopndrollSnapshot;
      };
      deleteSession: {
        params: {
          sessionId: string;
        };
        response: LoopndrollSnapshot;
      };
      registerHooks: {
        params: undefined;
        response: LoopndrollSnapshot;
      };
      clearHooks: {
        params: undefined;
        response: LoopndrollSnapshot;
      };
      revealHooksFile: {
        params: undefined;
        response: {
          revealed: boolean;
          path: string;
        };
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {};
  };
};
