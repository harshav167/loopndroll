import { homedir } from "node:os";
import { join } from "node:path";

export type LoopPluginPaths = {
  pluginRoot: string;
  pluginData: string;
  logsDirectoryPath: string;
  databasePath: string;
  hookDebugLogPath: string;
};

export const MANAGED_HOOK_SCRIPT_MARKER = "managed-by loop-plugin";
export const HOOK_DEBUG_LOG_ENV_NAME = "LOOPNDROLL_ENABLE_HOOK_DEBUG_LOGS";
export const REDACTED_DEBUG_VALUE = "[redacted]";
export const HOOK_DEBUG_REDACTED_KEYS = [
  "authorization",
  "body",
  "botToken",
  "bot_token",
  "command",
  "lastAssistantMessage",
  "last_assistant_message",
  "prompt",
  "stack",
  "text",
  "transcriptPath",
  "transcript_path",
  "webhookUrl",
  "webhook_url",
] as const;
export const GENERATED_TITLE_MATCH_WINDOW_MS = 30_000;
export const AWAIT_REPLY_POLL_INTERVAL_MS = 500;
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const TELEGRAM_NOTIFICATION_FOOTER =
  "Reply to this message in Telegram to continue this Claude Code session.";

export function getLoopPluginPaths(): LoopPluginPaths {
  const pluginRoot =
    process.env.CLAUDE_PLUGIN_ROOT ??
    process.env.CURSOR_PLUGIN_ROOT ??
    process.cwd();
  const pluginData =
    process.env.CLAUDE_PLUGIN_DATA ??
    process.env.CURSOR_PLUGIN_DATA ??
    join(homedir(), ".cursor", "plugins", "data", "loop-plugin");

  if (!pluginRoot || pluginRoot.trim().length === 0) {
    throw new Error("Plugin root path is required.");
  }

  if (!pluginData || pluginData.trim().length === 0) {
    throw new Error("Plugin data path is required.");
  }

  const nativeLoopndrollDirectory = join(
    homedir(),
    "Library",
    "Application Support",
    "loopndroll",
  );

  return {
    pluginRoot,
    pluginData,
    logsDirectoryPath: join(pluginData, "logs"),
    databasePath: join(nativeLoopndrollDirectory, "app.db"),
    hookDebugLogPath: join(pluginData, "logs", "hooks-debug.jsonl"),
  };
}
