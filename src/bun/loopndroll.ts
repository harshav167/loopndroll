import { spawn } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Database } from "bun:sqlite";
import { and, asc, eq } from "drizzle-orm";
import type {
  CompletionCheck,
  CreateLoopNotificationInput,
  LoopNotification,
  LoopPreset,
  LoopScope,
  LoopSession,
  LoopSessionPresetSource,
  LoopndrollSnapshot,
  TelegramChatOption,
  UpdateLoopNotificationInput,
} from "../shared/app-rpc";
import {
  DEFAULT_PROMPT,
  LOOP_PRESET_VALUES,
  LOOP_SCOPE_VALUES,
  LOOP_SESSION_SOURCE_VALUES,
} from "./constants";
import { SQLITE_PRAGMA_STATEMENTS, getLoopndrollDatabase } from "./db/client";
import { appMigrations } from "./db/migrations";
import {
  completionChecks,
  notifications,
  sessionAwaitingReplies,
  sessionNotifications,
  sessionRemotePrompts,
  sessionRuntime,
  sessions,
  settings,
} from "./db/schema";

type HookHandler = {
  type?: string;
  command?: string;
  timeout?: number;
  timeoutSec?: number;
  statusMessage?: string;
};

type HookMatcherGroup = {
  matcher?: string;
  hooks?: HookHandler[];
};

type HooksDocument = {
  hooks?: Record<string, HookMatcherGroup[]>;
};

type LoopndrollPaths = {
  appDirectoryPath: string;
  binDirectoryPath: string;
  logsDirectoryPath: string;
  databasePath: string;
  managedHookPath: string;
  hookDebugLogPath: string;
  codexDirectoryPath: string;
  codexConfigPath: string;
  codexHooksPath: string;
};

const APP_SUPPORT_DIRECTORY_NAME = "loopndroll";
const MANAGED_HOOK_MARKER = "--managed-by loopndroll";
const MANAGED_HOOK_SCRIPT_MARKER = "managed-by loopndroll";
const HOOK_DEBUG_LOG_ENV_NAME = "LOOPNDROLL_ENABLE_HOOK_DEBUG_LOGS";
const REDACTED_DEBUG_VALUE = "[redacted]";
const HOOK_DEBUG_REDACTED_KEYS = [
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
const STOP_STATUS_MESSAGE = "Loopndroll is deciding whether Codex should continue";
const SESSION_STATUS_MESSAGE = "Loopndroll is registering the Codex chat";
const PROMPT_STATUS_MESSAGE = "Loopndroll is capturing the chat prompt";
const GENERATED_TITLE_MATCH_WINDOW_MS = 30_000;
const TELEGRAM_BRIDGE_POLL_INTERVAL_MS = 5_000;
const AWAIT_REPLY_POLL_INTERVAL_MS = 500;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_NOTIFICATION_FOOTER =
  "Reply to this message in Telegram to continue this Codex chat.";
const TELEGRAM_ALLOWED_UPDATES = ["message", "channel_post", "my_chat_member", "chat_member"];

type TelegramUpdatePayload = {
  ok?: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramInboundMessage;
  channel_post?: TelegramInboundMessage;
  my_chat_member?: TelegramChatMemberUpdate;
  chat_member?: TelegramChatMemberUpdate;
};

type TelegramChat = {
  id?: number | string;
  type?: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
};

type TelegramInboundMessage = {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  reply_to_message?: {
    message_id?: number;
  };
};

type TelegramChatMemberUpdate = {
  chat?: TelegramChat;
};

type TelegramSendMessagePayload = {
  ok?: boolean;
  result?: {
    message_id?: number;
  };
  description?: string;
};

function getLoopndrollPaths(): LoopndrollPaths {
  const appDirectoryPath = join(
    homedir(),
    "Library",
    "Application Support",
    APP_SUPPORT_DIRECTORY_NAME,
  );
  const codexDirectoryPath = join(homedir(), ".codex");

  return {
    appDirectoryPath,
    binDirectoryPath: join(appDirectoryPath, "bin"),
    logsDirectoryPath: join(appDirectoryPath, "logs"),
    databasePath: join(appDirectoryPath, "app.db"),
    managedHookPath: join(appDirectoryPath, "bin", "loopndroll-hook"),
    hookDebugLogPath: join(appDirectoryPath, "logs", "hooks-debug.jsonl"),
    codexDirectoryPath,
    codexConfigPath: join(codexDirectoryPath, "config.toml"),
    codexHooksPath: join(codexDirectoryPath, "hooks.json"),
  };
}

function nowIsoString() {
  return new Date().toISOString();
}

function isTruthyEnvValue(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function shouldEnableHookDebugLogging() {
  return isTruthyEnvValue(process.env[HOOK_DEBUG_LOG_ENV_NAME]);
}

function sanitizeHookDebugLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHookDebugLogValue(item, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  seen.add(value);

  const redactedKeys = new Set<string>(HOOK_DEBUG_REDACTED_KEYS);
  const sanitizedEntries = Object.entries(value).map(([entryKey, entryValue]) => {
    if (redactedKeys.has(entryKey) || /(token|secret|password)$/i.test(entryKey)) {
      return [entryKey, REDACTED_DEBUG_VALUE];
    }

    return [entryKey, sanitizeHookDebugLogValue(entryValue, seen)];
  });

  return Object.fromEntries(sanitizedEntries);
}

async function appendHookDebugLog(paths: LoopndrollPaths, entry: Record<string, unknown>) {
  if (!shouldEnableHookDebugLogging()) {
    return;
  }

  await ensureDirectory(paths.logsDirectoryPath);
  await appendFile(
    paths.hookDebugLogPath,
    `${JSON.stringify(
      sanitizeHookDebugLogValue({
        timestamp: nowIsoString(),
        ...entry,
      }),
    )}\n`,
    "utf8",
  );
}

function normalizeLoopPreset(value: unknown): LoopPreset | null {
  return LOOP_PRESET_VALUES.includes(value as LoopPreset) ? (value as LoopPreset) : null;
}

function normalizeScope(value: unknown): LoopScope {
  return LOOP_SCOPE_VALUES.includes(value as LoopScope) ? (value as LoopScope) : "global";
}

function resolveSessionPresetState(
  sessionPresetValue: unknown,
  presetOverriddenValue: unknown,
  globalPresetValue: unknown,
): {
  preset: LoopPreset | null;
  presetSource: LoopSessionPresetSource;
  effectivePreset: LoopPreset | null;
} {
  const preset = normalizeLoopPreset(sessionPresetValue);
  const presetOverridden = Boolean(presetOverriddenValue);
  const globalPreset = normalizeLoopPreset(globalPresetValue);

  if (preset !== null) {
    return {
      preset,
      presetSource: "session",
      effectivePreset: preset,
    };
  }

  if (presetOverridden) {
    return {
      preset: null,
      presetSource: "off",
      effectivePreset: null,
    };
  }

  return {
    preset: null,
    presetSource: "global",
    effectivePreset: globalPreset,
  };
}

function isSqliteBusyError(error: unknown) {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function sleepSync(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withSqliteBusyRetry<T>(operation: () => T, maxAttempts = 5, delayMs = 25): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxAttempts) {
        throw error;
      }

      sleepSync(delayMs);
    }
  }
}

function getNotificationBaseLabel(
  notification: Pick<CreateLoopNotificationInput, "channel"> & {
    label?: string;
    chatUsername?: string | null;
    chatDisplayName?: string | null;
  },
) {
  const explicitLabel =
    typeof notification.label === "string" && notification.label.trim().length > 0
      ? notification.label.trim()
      : null;
  if (explicitLabel) {
    return explicitLabel;
  }

  if (notification.channel === "slack") {
    return "Slack";
  }

  if (
    typeof notification.chatUsername === "string" &&
    notification.chatUsername.trim().length > 0
  ) {
    return `@${notification.chatUsername.trim()}`;
  }

  if (
    typeof notification.chatDisplayName === "string" &&
    notification.chatDisplayName.trim().length > 0
  ) {
    return notification.chatDisplayName.trim();
  }

  return "Telegram";
}

function getUniqueNotificationLabel(
  currentNotifications: LoopNotification[],
  baseLabel: string,
  excludeId?: string,
) {
  const normalizedBaseLabel = baseLabel.trim();
  const matchingCount = currentNotifications.filter((notification) => {
    if (notification.id === excludeId) {
      return false;
    }

    return (
      notification.label === normalizedBaseLabel ||
      notification.label.startsWith(`${normalizedBaseLabel} `)
    );
  }).length;

  return matchingCount === 0 ? normalizedBaseLabel : `${normalizedBaseLabel} ${matchingCount + 1}`;
}

function normalizeCompletionCheckCommands(commands: string[]) {
  return commands.map((command) => command.trim()).filter((command) => command.length > 0);
}

function parseCompletionCheckCommands(commandsJson: string) {
  try {
    const parsed = JSON.parse(commandsJson);
    return Array.isArray(parsed) ? normalizeCompletionCheckCommands(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

function stringifyCompletionCheckCommands(commands: string[]) {
  return JSON.stringify(normalizeCompletionCheckCommands(commands));
}

function getUniqueCompletionCheckLabel(
  currentChecks: CompletionCheck[],
  baseLabel: string,
  excludeId?: string,
) {
  const normalizedBaseLabel = baseLabel.trim();
  const matchingCount = currentChecks.filter((completionCheck) => {
    if (completionCheck.id === excludeId) {
      return false;
    }

    return (
      completionCheck.label === normalizedBaseLabel ||
      completionCheck.label.startsWith(`${normalizedBaseLabel} `)
    );
  }).length;

  return matchingCount === 0 ? normalizedBaseLabel : `${normalizedBaseLabel} ${matchingCount + 1}`;
}

function mapCompletionCheckRow(row: typeof completionChecks.$inferSelect): CompletionCheck {
  return {
    id: row.id,
    label: row.label,
    commands: parseCompletionCheckCommands(row.commandsJson),
    createdAt: row.createdAt,
  };
}

function createNotification(notification: CreateLoopNotificationInput): LoopNotification {
  const createdAt = nowIsoString();
  const id = crypto.randomUUID();

  if (notification.channel === "slack") {
    return {
      id,
      label: "",
      channel: "slack",
      webhookUrl: notification.webhookUrl.trim(),
      createdAt,
    };
  }

  return {
    id,
    label: "",
    channel: "telegram",
    chatId: notification.chatId.trim(),
    botToken: notification.botToken.trim(),
    chatUsername: notification.chatUsername?.trim() || null,
    chatDisplayName: notification.chatDisplayName?.trim() || null,
    createdAt,
  };
}

function buildTelegramBotUrl(botToken: string) {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

function buildTelegramApiUrl(botToken: string, method: string) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function getTelegramChatDisplayName(chat: TelegramChat) {
  const nameParts = [chat.first_name, chat.last_name].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );

  if (nameParts.length > 0) {
    return nameParts.join(" ");
  }

  if (typeof chat.title === "string" && chat.title.trim().length > 0) {
    return chat.title.trim();
  }

  if (typeof chat.username === "string" && chat.username.trim().length > 0) {
    return `@${chat.username.trim()}`;
  }

  return "Unknown chat";
}

function normalizeTelegramChatKind(chatType: unknown): TelegramChatOption["kind"] {
  return chatType === "channel" ? "channel" : chatType === "private" ? "dm" : "group";
}

function getTelegramUpdateChat(update: TelegramUpdate) {
  const message = update.message;
  if (
    message?.chat &&
    (typeof message.chat.id === "number" || typeof message.chat.id === "string")
  ) {
    return {
      chat: message.chat,
      username: message.chat.username ?? null,
      firstName: message.chat.first_name ?? message.from?.first_name ?? null,
      lastName: message.chat.last_name ?? message.from?.last_name ?? null,
    };
  }

  const channelPost = update.channel_post;
  if (
    channelPost?.chat &&
    (typeof channelPost.chat.id === "number" || typeof channelPost.chat.id === "string")
  ) {
    return {
      chat: channelPost.chat,
      username: channelPost.chat.username ?? null,
      firstName: channelPost.chat.first_name ?? channelPost.from?.first_name ?? null,
      lastName: channelPost.chat.last_name ?? channelPost.from?.last_name ?? null,
    };
  }

  const memberUpdate = update.my_chat_member ?? update.chat_member;
  if (
    memberUpdate?.chat &&
    (typeof memberUpdate.chat.id === "number" || typeof memberUpdate.chat.id === "string")
  ) {
    return {
      chat: memberUpdate.chat,
      username: memberUpdate.chat.username ?? null,
      firstName: memberUpdate.chat.first_name ?? null,
      lastName: memberUpdate.chat.last_name ?? null,
    };
  }

  return null;
}

function collectTelegramChatsFromUpdates(updates: TelegramUpdate[]) {
  const uniqueChats = new Map<string, TelegramChatOption>();

  for (const update of [...updates].reverse()) {
    const extracted = getTelegramUpdateChat(update);
    if (!extracted) {
      continue;
    }

    const { chat, firstName, lastName } = extracted;
    const rawUsername = extracted.username ?? null;
    const username =
      typeof rawUsername === "string" && rawUsername.trim().length > 0 ? rawUsername.trim() : null;
    const dedupeKey = `chat:${String(chat.id)}`;
    if (uniqueChats.has(dedupeKey)) {
      continue;
    }

    uniqueChats.set(dedupeKey, {
      chatId: String(chat.id),
      kind: normalizeTelegramChatKind(chat.type),
      username,
      displayName: getTelegramChatDisplayName({
        title: chat.title,
        first_name: chat.first_name ?? firstName,
        last_name: chat.last_name ?? lastName,
        username,
      }),
    });
  }

  return [...uniqueChats.values()];
}

function readKnownTelegramChats(db: Database, botToken: string): TelegramChatOption[] {
  const rows = db
    .query(
      `select chat_id, kind, username, display_name
      from telegram_known_chats
      where bot_token = ?
      order by display_name asc, chat_id asc`,
    )
    .all(botToken) as Array<{
    chat_id: string;
    kind: string;
    username: string | null;
    display_name: string;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    kind: row.kind === "channel" ? "channel" : row.kind === "dm" ? "dm" : "group",
    username: row.username,
    displayName: row.display_name,
  }));
}

function upsertKnownTelegramChats(db: Database, botToken: string, chats: TelegramChatOption[]) {
  if (chats.length === 0) {
    return;
  }

  const upsertChat = db.query(
    `insert into telegram_known_chats (
      bot_token,
      chat_id,
      kind,
      username,
      display_name,
      updated_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(bot_token, chat_id) do update set
      kind = excluded.kind,
      username = excluded.username,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at`,
  );
  const updatedAt = nowIsoString();

  for (const chat of chats) {
    upsertChat.run(botToken, chat.chatId, chat.kind, chat.username, chat.displayName, updatedAt);
  }
}

async function enrichTelegramChats(botToken: string, chats: TelegramChatOption[]) {
  const enrichedChats = await Promise.all(
    chats.map(async (chat) => {
      if (chat.kind === "dm") {
        return chat;
      }

      try {
        const details = await fetchTelegramChatDetails(botToken, chat.chatId);
        return {
          ...chat,
          kind: normalizeTelegramChatKind(details.type),
          username:
            typeof details.username === "string" && details.username.trim().length > 0
              ? details.username.trim()
              : null,
          displayName: getTelegramChatDisplayName(details),
        } satisfies TelegramChatOption;
      } catch {
        return chat;
      }
    }),
  );

  return enrichedChats;
}

export async function getTelegramChats(
  botToken: string,
  waitForUpdates = false,
): Promise<TelegramChatOption[]> {
  const normalizedBotToken = botToken.trim();
  if (normalizedBotToken.length === 0) {
    return [];
  }

  const { client } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const cachedChats = readKnownTelegramChats(client, normalizedBotToken);
  const refreshedCachedChats = await enrichTelegramChats(normalizedBotToken, cachedChats);
  upsertKnownTelegramChats(client, normalizedBotToken, refreshedCachedChats);
  if (!waitForUpdates) {
    return readKnownTelegramChats(client, normalizedBotToken);
  }

  const params = new URLSearchParams({
    timeout: "30",
    allowed_updates: JSON.stringify(TELEGRAM_ALLOWED_UPDATES),
  });
  const response = await fetch(
    `${buildTelegramApiUrl(normalizedBotToken, "getUpdates")}?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramUpdatePayload;

  if (!payload.ok) {
    throw new Error(payload.description || "Telegram getUpdates failed.");
  }

  const updates = Array.isArray(payload.result) ? payload.result : [];
  const discoveredChats = collectTelegramChatsFromUpdates(updates);
  const enrichedChats = await enrichTelegramChats(normalizedBotToken, discoveredChats);
  upsertKnownTelegramChats(client, normalizedBotToken, enrichedChats);
  return readKnownTelegramChats(client, normalizedBotToken);
}

function parseTelegramBotTokenFromUrl(botUrl: string | null) {
  if (!botUrl) {
    return null;
  }

  const match = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/i.exec(botUrl.trim());
  return match?.[1] ?? null;
}

function allocateNextSessionRef(db: Database) {
  const allocate = db.transaction(() => {
    const row = db.query("select last_value from session_ref_sequence where id = 1").get() as {
      last_value?: number;
    } | null;
    const nextValue = (typeof row?.last_value === "number" ? row.last_value : 0) + 1;

    db.query(
      `insert into session_ref_sequence (id, last_value)
        values (1, ?)
        on conflict(id) do update set last_value = excluded.last_value`,
    ).run(nextValue);

    return `C${nextValue}`;
  });

  return withSqliteBusyRetry(() => allocate());
}

function mapNotificationRow(row: typeof notifications.$inferSelect): LoopNotification {
  if (row.channel === "slack") {
    return {
      id: row.id,
      label: row.label,
      channel: "slack",
      webhookUrl: row.webhookUrl ?? "",
      createdAt: row.createdAt,
    };
  }

  return {
    id: row.id,
    label: row.label,
    channel: "telegram",
    chatId: row.chatId ?? "",
    botToken: row.botToken ?? parseTelegramBotTokenFromUrl(row.botUrl) ?? "",
    chatUsername: row.chatUsername ?? null,
    chatDisplayName: row.chatDisplayName ?? null,
    createdAt: row.createdAt,
  };
}

function notificationInsertFromValue(
  notification: LoopNotification,
): typeof notifications.$inferInsert {
  if (notification.channel === "slack") {
    return {
      id: notification.id,
      label: notification.label,
      channel: "slack",
      webhookUrl: notification.webhookUrl,
      chatId: null,
      botUrl: null,
      createdAt: notification.createdAt,
    };
  }

  return {
    id: notification.id,
    label: notification.label,
    channel: "telegram",
    webhookUrl: null,
    chatId: notification.chatId,
    botToken: notification.botToken,
    botUrl: buildTelegramBotUrl(notification.botToken),
    chatUsername: notification.chatUsername,
    chatDisplayName: notification.chatDisplayName,
    createdAt: notification.createdAt,
  };
}

function buildNewSession(sessionId: string, sessionRef: string): typeof sessions.$inferInsert {
  const timestamp = nowIsoString();

  return {
    sessionId,
    sessionRef,
    source: "startup",
    cwd: null,
    archived: false,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    activeSince: null,
    stopCount: 0,
    preset: null,
    presetOverridden: false,
    completionCheckId: null,
    completionCheckWaitForReply: false,
    title: null,
    transcriptPath: null,
    lastAssistantMessage: null,
  };
}

function resolveSessionCompletionCheckState(
  sessionCompletionCheckIdValue: unknown,
  sessionCompletionCheckWaitForReplyValue: unknown,
  sessionPresetValue: unknown,
  presetOverriddenValue: unknown,
  globalPresetValue: unknown,
  globalCompletionCheckIdValue: unknown,
  globalCompletionCheckWaitForReplyValue: unknown,
  availableCompletionCheckIds: Iterable<string>,
) {
  const availableIds = new Set(availableCompletionCheckIds);
  const sessionCompletionCheckId =
    typeof sessionCompletionCheckIdValue === "string" &&
    sessionCompletionCheckIdValue.trim().length > 0 &&
    availableIds.has(sessionCompletionCheckIdValue.trim())
      ? sessionCompletionCheckIdValue.trim()
      : null;
  const sessionCompletionCheckWaitForReply = Boolean(sessionCompletionCheckWaitForReplyValue);
  const presetState = resolveSessionPresetState(
    sessionPresetValue,
    presetOverriddenValue,
    globalPresetValue,
  );
  const globalCompletionCheckId =
    typeof globalCompletionCheckIdValue === "string" &&
    globalCompletionCheckIdValue.trim().length > 0 &&
    availableIds.has(globalCompletionCheckIdValue.trim())
      ? globalCompletionCheckIdValue.trim()
      : null;
  const globalCompletionCheckWaitForReply = Boolean(globalCompletionCheckWaitForReplyValue);

  if (presetState.effectivePreset !== "completion-checks") {
    return {
      completionCheckId: sessionCompletionCheckId,
      completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
      effectiveCompletionCheckId: null,
      effectiveCompletionCheckWaitForReply: false,
    };
  }

  if (presetState.presetSource === "session") {
    return {
      completionCheckId: sessionCompletionCheckId,
      completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
      effectiveCompletionCheckId: sessionCompletionCheckId,
      effectiveCompletionCheckWaitForReply:
        sessionCompletionCheckId === null ? false : sessionCompletionCheckWaitForReply,
    };
  }

  return {
    completionCheckId: sessionCompletionCheckId,
    completionCheckWaitForReply: sessionCompletionCheckWaitForReply,
    effectiveCompletionCheckId: globalCompletionCheckId,
    effectiveCompletionCheckWaitForReply:
      globalCompletionCheckId === null ? false : globalCompletionCheckWaitForReply,
  };
}

function mapSessionRow(
  row: typeof sessions.$inferSelect,
  notificationIds: string[],
  globalPreset: LoopPreset | null,
  globalCompletionCheckId: string | null,
  globalCompletionCheckWaitForReply: boolean,
  availableCompletionCheckIds: Iterable<string>,
): LoopSession {
  const presetState = row.archived
    ? {
        preset: null,
        presetSource: "off" as const,
        effectivePreset: null,
      }
    : resolveSessionPresetState(row.preset, row.presetOverridden, globalPreset);
  const completionCheckState = row.archived
    ? {
        completionCheckId: row.completionCheckId,
        completionCheckWaitForReply: false,
        effectiveCompletionCheckId: null,
        effectiveCompletionCheckWaitForReply: false,
      }
    : resolveSessionCompletionCheckState(
        row.completionCheckId,
        row.completionCheckWaitForReply,
        row.preset,
        row.presetOverridden,
        globalPreset,
        globalCompletionCheckId,
        globalCompletionCheckWaitForReply,
        availableCompletionCheckIds,
      );

  return {
    sessionId: row.sessionId,
    sessionRef: row.sessionRef,
    source: LOOP_SESSION_SOURCE_VALUES.includes(row.source) ? row.source : "startup",
    cwd: row.cwd,
    notificationIds,
    archived: Boolean(row.archived),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    activeSince: row.activeSince,
    stopCount: row.stopCount,
    preset: presetState.preset,
    presetSource: presetState.presetSource,
    effectivePreset: presetState.effectivePreset,
    completionCheckId: completionCheckState.completionCheckId,
    completionCheckWaitForReply: completionCheckState.completionCheckWaitForReply,
    effectiveCompletionCheckId: completionCheckState.effectiveCompletionCheckId,
    effectiveCompletionCheckWaitForReply: completionCheckState.effectiveCompletionCheckWaitForReply,
    title: row.title,
    transcriptPath: row.transcriptPath,
    lastAssistantMessage: row.lastAssistantMessage,
  };
}

function isPromptOnlyArtifact(
  session: Pick<LoopSession, "transcriptPath" | "title" | "lastAssistantMessage">,
) {
  if (session.transcriptPath !== null) {
    return false;
  }

  const titleLooksInternal = session.title?.startsWith("You are a helpful assistant.") ?? false;
  const assistantPayloadLooksInternal =
    session.lastAssistantMessage?.startsWith('{"title":') ?? false;

  return titleLooksInternal || assistantPayloadLooksInternal;
}

function getSettingsRow() {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();

  if (!row) {
    throw new Error("Loopndroll settings row is missing.");
  }

  return row;
}

type NotificationDefaultsReader = Pick<ReturnType<typeof getLoopndrollDatabase>["db"], "select">;
type NotificationDefaultsWriter = Pick<ReturnType<typeof getLoopndrollDatabase>["db"], "insert">;

function normalizeGlobalNotificationId(
  availableNotificationIds: Iterable<string>,
  candidate: string | null | undefined,
) {
  if (typeof candidate !== "string") {
    return null;
  }

  const notificationId = candidate.trim();
  if (notificationId.length === 0) {
    return null;
  }

  const knownNotificationIds = new Set(availableNotificationIds);
  return knownNotificationIds.has(notificationId) ? notificationId : null;
}

function normalizeGlobalCompletionCheckId(
  availableCompletionCheckIds: Iterable<string>,
  candidate: string | null | undefined,
) {
  if (typeof candidate !== "string") {
    return null;
  }

  const completionCheckId = candidate.trim();
  if (completionCheckId.length === 0) {
    return null;
  }

  const knownCompletionCheckIds = new Set(availableCompletionCheckIds);
  return knownCompletionCheckIds.has(completionCheckId) ? completionCheckId : null;
}

function getStoredGlobalNotificationId(db: NotificationDefaultsReader) {
  const settingsRow = db
    .select({ globalNotificationId: settings.globalNotificationId })
    .from(settings)
    .where(eq(settings.id, 1))
    .get();

  if (!settingsRow) {
    return null;
  }

  const notificationIds = db
    .select({ id: notifications.id })
    .from(notifications)
    .all()
    .map((row) => row.id);

  return normalizeGlobalNotificationId(notificationIds, settingsRow.globalNotificationId);
}

function applyGlobalNotificationToSession(
  tx: NotificationDefaultsWriter,
  sessionId: string,
  notificationId: string | null,
) {
  if (notificationId === null) {
    return;
  }

  tx.insert(sessionNotifications)
    .values({
      sessionId,
      notificationId,
    })
    .onConflictDoNothing()
    .run();
}

function readSnapshotFromDatabase() {
  const { db } = getLoopndrollDatabase(getLoopndrollPaths().databasePath);
  const settingsRow = getSettingsRow();
  const completionCheckRows = db
    .select()
    .from(completionChecks)
    .orderBy(asc(completionChecks.createdAt), asc(completionChecks.id))
    .all();
  const notificationRows = db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .all();
  const sessionRows = db
    .select()
    .from(sessions)
    .orderBy(asc(sessions.firstSeenAt), asc(sessions.sessionId))
    .all();
  const sessionNotificationRows = db
    .select()
    .from(sessionNotifications)
    .orderBy(asc(sessionNotifications.sessionId), asc(sessionNotifications.notificationId))
    .all();
  const normalizedGlobalCompletionCheckId = normalizeGlobalCompletionCheckId(
    completionCheckRows.map((row) => row.id),
    settingsRow.globalCompletionCheckId,
  );

  const notificationIdMap = new Map<string, string[]>();
  for (const row of sessionNotificationRows) {
    const current = notificationIdMap.get(row.sessionId);
    if (current) {
      current.push(row.notificationId);
      continue;
    }

    notificationIdMap.set(row.sessionId, [row.notificationId]);
  }

  return {
    defaultPrompt: settingsRow.defaultPrompt,
    scope: normalizeScope(settingsRow.scope),
    globalPreset: normalizeLoopPreset(settingsRow.globalPreset),
    globalNotificationId: normalizeGlobalNotificationId(
      notificationRows.map((row) => row.id),
      settingsRow.globalNotificationId,
    ),
    globalCompletionCheckId: normalizedGlobalCompletionCheckId,
    globalCompletionCheckWaitForReply: settingsRow.globalCompletionCheckWaitForReply,
    hooksAutoRegistration: settingsRow.hooksAutoRegistration,
    notifications: notificationRows.map(mapNotificationRow),
    completionChecks: completionCheckRows.map(mapCompletionCheckRow),
    sessions: sessionRows
      .map((row) =>
        mapSessionRow(
          row,
          notificationIdMap.get(row.sessionId) ?? [],
          normalizeLoopPreset(settingsRow.globalPreset),
          normalizedGlobalCompletionCheckId,
          settingsRow.globalCompletionCheckWaitForReply,
          completionCheckRows.map((completionCheckRow) => completionCheckRow.id),
        ),
      )
      .filter((session) => !isPromptOnlyArtifact(session)),
  };
}

function getTelegramBridgeBotTokens(db: Database) {
  const rows = db
    .query(
      `select distinct bot_token
      from notifications
      where channel = 'telegram'
        and bot_token is not null
        and trim(bot_token) != ''`,
    )
    .all() as Array<{
    bot_token: string;
  }>;

  return rows.map((row) => row.bot_token?.trim() ?? "").filter((botToken) => botToken.length > 0);
}

function getTelegramUpdateCursor(db: Database, botToken: string) {
  const row = db
    .query("select last_update_id from telegram_update_cursors where bot_token = ?")
    .get(botToken) as { last_update_id?: number } | null;

  return typeof row?.last_update_id === "number" ? row.last_update_id : null;
}

function setTelegramUpdateCursor(db: Database, botToken: string, lastUpdateId: number) {
  const updatedAt = nowIsoString();
  db.query(
    `insert into telegram_update_cursors (bot_token, last_update_id, updated_at)
      values (?, ?, ?)
      on conflict(bot_token) do update set
        last_update_id = excluded.last_update_id,
        updated_at = excluded.updated_at`,
  ).run(botToken, lastUpdateId, updatedAt);
}

async function fetchTelegramUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams();
  if (typeof offset === "number") {
    params.set("offset", String(offset));
  }
  params.set("allowed_updates", JSON.stringify(TELEGRAM_ALLOWED_UPDATES));

  const url =
    params.size > 0
      ? `${buildTelegramApiUrl(botToken, "getUpdates")}?${params.toString()}`
      : buildTelegramApiUrl(botToken, "getUpdates");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramUpdatePayload;
  if (!payload.ok) {
    throw new Error(payload.description || "Telegram getUpdates failed.");
  }

  return Array.isArray(payload.result) ? payload.result : [];
}

async function sendTelegramBridgeMessage(botToken: string, chatId: string, text: string) {
  const response = await fetch(buildTelegramApiUrl(botToken, "sendMessage"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramSendMessagePayload;
  if (!payload.ok) {
    throw new Error(payload.description || "Telegram sendMessage failed.");
  }
}

async function fetchTelegramChatDetails(botToken: string, chatId: string) {
  const response = await fetch(buildTelegramApiUrl(botToken, "getChat"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      chat_id: chatId,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Telegram getChat failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    result?: TelegramChat;
    description?: string;
  };
  if (!payload.ok || !payload.result) {
    throw new Error(payload.description || "Telegram getChat failed.");
  }

  return payload.result;
}

function isAuthorizedTelegramBridgeChat(db: Database, botToken: string, chatId: string) {
  const row = db
    .query(
      `select 1
      from notifications
      where channel = 'telegram'
        and bot_token = ?
        and chat_id = ?
      limit 1`,
    )
    .get(botToken, chatId);

  return Boolean(row);
}

function getTelegramCommandName(text: string) {
  const token = text.trim().split(/\s+/, 1)[0] ?? "";
  const match = /^\/([a-z0-9_]+)(?:@\w+)?$/i.exec(token);
  return match?.[1]?.toLowerCase() ?? null;
}

function listRegisteredTelegramSessions(db: Database, botToken: string, chatId: string) {
  const settingsRow = db.query("select global_preset from settings where id = 1").get() as {
    global_preset?: unknown;
  } | null;
  const globalPreset = normalizeLoopPreset(settingsRow?.global_preset);
  const rows = db
    .query(
      `select distinct
        s.session_id,
        s.session_ref,
        s.title,
        s.transcript_path,
        s.last_assistant_message,
        s.last_seen_at,
        s.active_since,
        s.preset,
        s.preset_overridden
      from sessions s
      inner join session_notifications sn on sn.session_id = s.session_id
      inner join notifications n on n.id = sn.notification_id
      where n.channel = 'telegram'
        and n.bot_token = ?
        and n.chat_id = ?
      order by s.last_seen_at desc, s.first_seen_at desc`,
    )
    .all(botToken, chatId) as Array<{
    session_id: string;
    session_ref: string;
    title: string | null;
    transcript_path: string | null;
    last_assistant_message: string | null;
    last_seen_at: string;
    active_since: string | null;
    preset: LoopPreset | null;
    preset_overridden: number | boolean | null;
  }>;

  return rows
    .map((row) => {
      const presetState = resolveSessionPresetState(
        row.preset,
        row.preset_overridden,
        globalPreset,
      );

      return {
        sessionId: row.session_id,
        sessionRef: row.session_ref,
        source: "stop" as const,
        cwd: null,
        notificationIds: [],
        archived: false,
        firstSeenAt: row.last_seen_at,
        lastSeenAt: row.last_seen_at,
        activeSince: row.active_since,
        stopCount: 0,
        preset: presetState.preset,
        presetSource: presetState.presetSource,
        effectivePreset: presetState.effectivePreset,
        completionCheckId: null,
        completionCheckWaitForReply: false,
        effectiveCompletionCheckId: null,
        effectiveCompletionCheckWaitForReply: false,
        title: row.title,
        transcriptPath: row.transcript_path,
        lastAssistantMessage: row.last_assistant_message,
      };
    })
    .filter((session) => !isPromptOnlyArtifact(session));
}

function buildTelegramSessionListText(sessionsForChat: LoopSession[]) {
  if (sessionsForChat.length === 0) {
    return "No chats are registered to this Telegram destination yet.";
  }

  const lines = sessionsForChat.slice(0, 20).map((session) => {
    const title =
      typeof session.title === "string" && session.title.trim().length > 0
        ? session.title.trim()
        : "Untitled chat";
    return `[${session.sessionRef}] - ${title}`;
  });

  const suffix =
    sessionsForChat.length > lines.length
      ? `\n\nShowing ${lines.length} of ${sessionsForChat.length} chats.`
      : "";

  return `Registered chats:\n${lines.join("\n")}${suffix}`;
}

function getLoopPresetLabel(preset: LoopPreset | null) {
  if (preset === "infinite") {
    return "Infinite";
  }
  if (preset === "await-reply") {
    return "Await Reply";
  }
  if (preset === "completion-checks") {
    return "Completion checks";
  }
  if (preset === "max-turns-1") {
    return "Max Turns 1";
  }
  if (preset === "max-turns-2") {
    return "Max Turns 2";
  }
  if (preset === "max-turns-3") {
    return "Max Turns 3";
  }
  return "Disabled";
}

function getTelegramStatusSnapshot(db: Database) {
  const row = db
    .query("select scope, global_preset, hooks_auto_registration from settings where id = 1")
    .get() as {
    scope?: unknown;
    global_preset?: unknown;
    hooks_auto_registration?: number | boolean;
  } | null;

  return {
    scope: normalizeScope(row?.scope),
    globalPreset: normalizeLoopPreset(row?.global_preset),
    hooksAutoRegistration:
      typeof row?.hooks_auto_registration === "boolean"
        ? row.hooks_auto_registration
        : Boolean(row?.hooks_auto_registration),
  };
}

function buildTelegramStatusText(
  settingsSnapshot: {
    scope: LoopScope;
    globalPreset: LoopPreset | null;
    hooksAutoRegistration: boolean;
  },
  sessionsForChat: LoopSession[],
) {
  const visibleSessions = sessionsForChat.filter((session) => !session.archived);
  const lines = [
    "Current status:",
    `Global preset: ${getLoopPresetLabel(settingsSnapshot.globalPreset)}`,
  ];

  if (visibleSessions.length === 0) {
    lines.push("", "Registered chats: none");
    return lines.join("\n");
  }

  lines.push("", "Per-chat presets:");
  for (const session of visibleSessions.slice(0, 20)) {
    const title =
      typeof session.title === "string" && session.title.trim().length > 0
        ? session.title.trim()
        : "Untitled chat";
    const presetLabel =
      session.presetSource === "session"
        ? getLoopPresetLabel(session.preset)
        : session.presetSource === "off"
          ? "Off"
          : "Inherit global";
    lines.push(`[${session.sessionRef}] - ${title}: ${presetLabel}`);
  }

  if (visibleSessions.length > 20) {
    lines.push("", `Showing 20 of ${visibleSessions.length} chats.`);
  }

  return lines.join("\n");
}

function buildTelegramHelpText() {
  return [
    "Available commands:",
    "/list - List chats registered to this Telegram destination",
    "/status - Show current global mode and per-chat presets",
    "/reply C22 your message - Send a prompt to a specific chat",
    "/mode global infinite - Set the global preset to Infinite",
    "/mode global await - Set the global preset to Await Reply",
    "/mode global checks - Set the global preset to Completion checks",
    "/mode global off - Disable the global preset",
    "/mode C22 infinite - Set chat C22 to Infinite",
    "/mode C22 await - Set chat C22 to Await Reply",
    "/mode C22 off - Stop chat C22",
    "",
    "Reply behavior:",
    "Reply directly to a Telegram notification to target that chat.",
    "Or send plain text without a command to target the latest waiting chat in this Telegram conversation.",
    "",
    "Examples:",
    "/list",
    "/status",
    "/reply C22 fix the failing test",
    "/mode global await",
    "/mode C22 off",
  ].join("\n");
}

function isPersistentPromptPreset(preset: LoopPreset | null) {
  return (
    preset === "infinite" ||
    preset === "max-turns-1" ||
    preset === "max-turns-2" ||
    preset === "max-turns-3"
  );
}

const OPT_OUT_EXISTING_INACTIVE_SESSIONS_FROM_GLOBAL_PRESET_SQL = `update sessions
  set preset_overridden = 1
  where archived = 0
    and preset is null
    and preset_overridden = 0
    and active_since is null`;

function optOutExistingInactiveSessionsFromGlobalPreset(executor: {
  run: (sql: string) => unknown;
}) {
  executor.run(OPT_OUT_EXISTING_INACTIVE_SESSIONS_FROM_GLOBAL_PRESET_SQL);
}

function getEffectivePresetForSession(db: Database, sessionId: string) {
  const row = db
    .query(
      `select
        s.preset as session_preset,
        s.preset_overridden as preset_overridden,
        s.archived as session_archived,
        st.global_preset as global_preset
      from sessions s
      left join settings st on st.id = 1
      where s.session_id = ?
      limit 1`,
    )
    .get(sessionId) as {
    session_preset?: unknown;
    preset_overridden?: unknown;
    session_archived?: unknown;
    global_preset?: unknown;
  } | null;

  if (row?.session_archived) {
    return null;
  }

  return resolveSessionPresetState(row?.session_preset, row?.preset_overridden, row?.global_preset)
    .effectivePreset;
}

function findTelegramReplySessionId(
  db: Database,
  botToken: string,
  chatId: string,
  replyToMessageId: number,
) {
  const row = db
    .query(
      `select session_id
      from telegram_delivery_receipts
      where bot_token = ?
        and chat_id = ?
        and telegram_message_id = ?
      order by created_at desc
      limit 1`,
    )
    .get(botToken, chatId, replyToMessageId) as { session_id?: string } | null;

  return typeof row?.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
}

function findLatestAwaitingTelegramSessionId(db: Database, botToken: string, chatId: string) {
  const row = db
    .query(
      `select ar.session_id
      from session_awaiting_replies ar
      inner join sessions s on s.session_id = ar.session_id
      where ar.bot_token = ?
        and ar.chat_id = ?
        and s.archived = 0
      order by ar.started_at desc, ar.session_id desc
      limit 1`,
    )
    .get(botToken, chatId) as { session_id?: string } | null;

  return typeof row?.session_id === "string" && row.session_id.length > 0 ? row.session_id : null;
}

function findTelegramSessionByRef(
  db: Database,
  botToken: string,
  chatId: string,
  sessionRef: string,
) {
  const row = db
    .query(
      `select distinct
        s.session_id,
        s.session_ref,
        s.title
      from sessions s
      inner join session_notifications sn on sn.session_id = s.session_id
      inner join notifications n on n.id = sn.notification_id
      where n.channel = 'telegram'
        and n.bot_token = ?
        and n.chat_id = ?
        and lower(s.session_ref) = lower(?)
      limit 1`,
    )
    .get(botToken, chatId, sessionRef) as {
    session_id?: string;
    session_ref?: string;
    title?: string | null;
  } | null;

  if (!row?.session_id || !row?.session_ref) {
    return null;
  }

  return {
    sessionId: row.session_id,
    sessionRef: row.session_ref,
    title: row.title ?? null,
  };
}

function parseReplyCommand(text: string) {
  const match = /^\/reply(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/i.exec(text.trim());
  if (!match) {
    return null;
  }

  const sessionRef = match[1]?.trim().toUpperCase() ?? "";
  const promptText = match[2]?.trim() ?? "";
  if (sessionRef.length === 0 || promptText.length === 0) {
    return null;
  }

  return { sessionRef, promptText };
}

function parseModeCommand(text: string) {
  const match = /^\/mode(?:@\w+)?\s+(\S+)\s+(\S+)$/i.exec(text.trim());
  if (!match) {
    return null;
  }

  const rawTarget = match[1]?.trim() ?? "";
  const rawMode = match[2]?.trim().toLowerCase() ?? "";
  if (rawTarget.length === 0 || rawMode.length === 0) {
    return null;
  }

  const preset: LoopPreset | null =
    rawMode === "off"
      ? null
      : rawMode === "infinite"
        ? "infinite"
        : rawMode === "await"
          ? "await-reply"
          : rawMode === "checks"
            ? "completion-checks"
            : null;
  if (rawMode !== "off" && preset === null) {
    return null;
  }

  return {
    target: rawTarget.toLowerCase() === "global" ? "global" : rawTarget.toUpperCase(),
    preset,
    rawMode,
  };
}

function updateSessionPresetFromBridge(db: Database, sessionId: string, preset: LoopPreset | null) {
  const existingSession = db
    .query(
      "select preset, preset_overridden, active_since, archived from sessions where session_id = ? limit 1",
    )
    .get(sessionId) as {
    preset?: unknown;
    preset_overridden?: unknown;
    active_since?: string | null;
    archived?: unknown;
  } | null;
  if (!existingSession) {
    return false;
  }
  if (existingSession.archived) {
    return false;
  }

  const previousPreset = resolveSessionPresetState(
    existingSession.preset,
    existingSession.preset_overridden,
    null,
  ).effectivePreset;
  const nextActiveSince =
    previousPreset === null && preset !== null
      ? nowIsoString()
      : previousPreset !== null && preset === null
        ? null
        : (existingSession.active_since ?? null);
  const isRestartingFromOff = previousPreset === null && preset !== null;

  const applyUpdate = db.transaction(() => {
    db.query(
      `update sessions
       set preset = ?,
           preset_overridden = 1,
           active_since = ?
       where session_id = ?`,
    ).run(preset, nextActiveSince, sessionId);

    db.query("delete from session_runtime where session_id = ?").run(sessionId);

    if (preset !== "await-reply") {
      db.query("delete from session_awaiting_replies where session_id = ?").run(sessionId);
    }

    if (isRestartingFromOff) {
      db.query("delete from session_remote_prompts where session_id = ?").run(sessionId);
      return;
    }

    if (preset === null) {
      db.query("delete from session_remote_prompts where session_id = ?").run(sessionId);
      return;
    }

    if (!isPersistentPromptPreset(preset)) {
      db.query(
        "delete from session_remote_prompts where session_id = ? and delivery_mode = 'persistent'",
      ).run(sessionId);
    }
  });

  applyUpdate();

  return true;
}

function updateGlobalPresetFromBridge(db: Database, preset: LoopPreset | null) {
  const applyUpdate = db.transaction(() => {
    if (preset !== null) {
      optOutExistingInactiveSessionsFromGlobalPreset(db);
    }

    db.query("update settings set global_preset = ? where id = 1").run(preset);

    if (preset === null) {
      db.run(
        `update sessions
         set active_since = null
         where archived = 0
           and preset_overridden = 0`,
      );
    }

    db.query("delete from session_runtime").run();

    if (preset !== "await-reply") {
      db.run(
        `delete from session_awaiting_replies
         where session_id in (
           select session_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
    }

    if (preset === null) {
      db.run(
        `delete from session_remote_prompts
         where session_id in (
           select session_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
      return;
    }

    if (!isPersistentPromptPreset(preset)) {
      db.run(
        `delete from session_remote_prompts
         where delivery_mode = 'persistent'
           and session_id in (
             select session_id
             from sessions
             where preset is null
               and preset_overridden = 0
               and archived = 0
           )`,
      );
    }
  });

  applyUpdate();
}

function getModeCommandLabel(preset: LoopPreset | null) {
  if (preset === "infinite") {
    return "Infinite";
  }

  if (preset === "await-reply") {
    return "Await Reply";
  }

  if (preset === "completion-checks") {
    return "Completion checks";
  }

  return "Off";
}

function upsertSessionRemotePrompt(
  db: Database,
  sessionId: string,
  promptText: string,
  deliveryMode: "once" | "persistent",
  message: TelegramInboundMessage,
) {
  const trimmedPrompt = promptText.trim();
  if (trimmedPrompt.length === 0) {
    return false;
  }

  db.query(
    `insert into session_remote_prompts (
      session_id,
      source,
      delivery_mode,
      prompt_text,
      telegram_chat_id,
      telegram_message_id,
      created_at
    ) values (?, 'telegram', ?, ?, ?, ?, ?)
    on conflict(session_id, delivery_mode) do update set
      source = excluded.source,
      delivery_mode = excluded.delivery_mode,
      prompt_text = excluded.prompt_text,
      telegram_chat_id = excluded.telegram_chat_id,
      telegram_message_id = excluded.telegram_message_id,
      created_at = excluded.created_at`,
  ).run(
    sessionId,
    deliveryMode,
    trimmedPrompt,
    typeof message.chat?.id === "number" || typeof message.chat?.id === "string"
      ? String(message.chat.id)
      : null,
    typeof message.message_id === "number" ? message.message_id : null,
    nowIsoString(),
  );

  return true;
}

async function processTelegramBridgeUpdate(
  paths: LoopndrollPaths,
  db: Database,
  botToken: string,
  update: TelegramUpdate,
) {
  const message = update.message;
  if (!message || typeof message.text !== "string") {
    return;
  }

  const trimmedText = message.text.trim();
  if (trimmedText.length === 0) {
    return;
  }

  const chatId =
    typeof message.chat?.id === "number" || typeof message.chat?.id === "string"
      ? String(message.chat.id)
      : null;
  if (!chatId) {
    return;
  }

  if (!isAuthorizedTelegramBridgeChat(db, botToken, chatId)) {
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "ignored-message",
      reason: "unauthorized-chat",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
    });
    return;
  }

  const discoveredChats = collectTelegramChatsFromUpdates([update]);
  if (discoveredChats.length > 0) {
    upsertKnownTelegramChats(db, botToken, discoveredChats);
  }

  const commandName = getTelegramCommandName(trimmedText);
  if (commandName === "list") {
    const sessionsForChat = listRegisteredTelegramSessions(db, botToken, chatId);
    await sendTelegramBridgeMessage(
      botToken,
      chatId,
      buildTelegramSessionListText(sessionsForChat),
    );
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "list-sessions",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      sessionCount: sessionsForChat.length,
    });
    return;
  }
  if (commandName === "status") {
    const sessionsForChat = listRegisteredTelegramSessions(db, botToken, chatId);
    const settingsSnapshot = getTelegramStatusSnapshot(db);
    await sendTelegramBridgeMessage(
      botToken,
      chatId,
      buildTelegramStatusText(settingsSnapshot, sessionsForChat),
    );
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "status",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      sessionCount: sessionsForChat.length,
      scope: settingsSnapshot.scope,
      globalPreset: settingsSnapshot.globalPreset,
    });
    return;
  }
  if (commandName === "help") {
    await sendTelegramBridgeMessage(botToken, chatId, buildTelegramHelpText());
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "help",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
    });
    return;
  }
  if (commandName === "reply") {
    const parsedReply = parseReplyCommand(trimmedText);
    if (!parsedReply) {
      await sendTelegramBridgeMessage(botToken, chatId, "Usage: /reply C12 your message");
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "reply-usage",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
      });
      return;
    }

    const targetSession = findTelegramSessionByRef(db, botToken, chatId, parsedReply.sessionRef);
    if (!targetSession) {
      await sendTelegramBridgeMessage(
        botToken,
        chatId,
        `Chat ${parsedReply.sessionRef} is not registered to this Telegram destination.`,
      );
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "reply-miss",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
        sessionRef: parsedReply.sessionRef,
      });
      return;
    }

    const effectivePreset = getEffectivePresetForSession(db, targetSession.sessionId);
    if (!effectivePreset) {
      await sendTelegramBridgeMessage(
        botToken,
        chatId,
        `[${targetSession.sessionRef}] has no active mode. Use /mode ${targetSession.sessionRef} infinite|await first.`,
      );
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "reply-no-mode",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
        sessionId: targetSession.sessionId,
        sessionRef: targetSession.sessionRef,
      });
      return;
    }

    upsertSessionRemotePrompt(
      db,
      targetSession.sessionId,
      parsedReply.promptText,
      effectivePreset === "await-reply" ? "once" : "persistent",
      message,
    );
    await sendTelegramBridgeMessage(
      botToken,
      chatId,
      effectivePreset === "await-reply"
        ? `Queued for [${targetSession.sessionRef}]${targetSession.title ? ` - ${targetSession.title}` : ""}.`
        : `Prompt override set for [${targetSession.sessionRef}]${targetSession.title ? ` - ${targetSession.title}` : ""}.`,
    );
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "queue-command-prompt",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      sessionId: targetSession.sessionId,
      sessionRef: targetSession.sessionRef,
    });
    return;
  }
  if (commandName === "mode") {
    const parsedMode = parseModeCommand(trimmedText);
    if (!parsedMode) {
      await sendTelegramBridgeMessage(
        botToken,
        chatId,
        "Usage: /mode global infinite|await|off or /mode C22 infinite|await|off",
      );
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "mode-usage",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
      });
      return;
    }

    if (parsedMode.target === "global") {
      updateGlobalPresetFromBridge(db, parsedMode.preset);
      await sendTelegramBridgeMessage(
        botToken,
        chatId,
        `Global mode set to ${getModeCommandLabel(parsedMode.preset)}.`,
      );
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "mode-global",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
        preset: parsedMode.preset,
      });
      return;
    }

    const targetSession = findTelegramSessionByRef(db, botToken, chatId, parsedMode.target);
    if (!targetSession) {
      await sendTelegramBridgeMessage(
        botToken,
        chatId,
        `Chat ${parsedMode.target} is not registered to this Telegram destination.`,
      );
      await appendHookDebugLog(paths, {
        type: "telegram-bridge",
        action: "mode-miss",
        botToken,
        updateId: update.update_id ?? null,
        chatId,
        sessionRef: parsedMode.target,
      });
      return;
    }

    updateSessionPresetFromBridge(db, targetSession.sessionId, parsedMode.preset);
    await sendTelegramBridgeMessage(
      botToken,
      chatId,
      `[${targetSession.sessionRef}]${targetSession.title ? ` - ${targetSession.title}` : ""} set to ${getModeCommandLabel(parsedMode.preset)}.`,
    );
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "mode-session",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      sessionId: targetSession.sessionId,
      sessionRef: targetSession.sessionRef,
      preset: parsedMode.preset,
    });
    return;
  }
  if (commandName) {
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "ignored-command",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      commandName,
    });
    return;
  }

  const replyToMessageId = message.reply_to_message?.message_id;
  const sessionId =
    typeof replyToMessageId === "number"
      ? findTelegramReplySessionId(db, botToken, chatId, replyToMessageId)
      : findLatestAwaitingTelegramSessionId(db, botToken, chatId);
  if (!sessionId) {
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "ignored-message",
      reason: typeof replyToMessageId === "number" ? "unknown-reply-target" : "no-waiting-session",
      botToken,
      updateId: update.update_id ?? null,
      chatId,
      replyToMessageId: typeof replyToMessageId === "number" ? replyToMessageId : null,
    });
    return;
  }

  const effectivePreset = getEffectivePresetForSession(db, sessionId);
  if (!effectivePreset) {
    await appendHookDebugLog(paths, {
      type: "telegram-bridge",
      action: "ignored-message",
      reason: "no-active-mode",
      botToken,
      sessionId,
      updateId: update.update_id ?? null,
      chatId,
      replyToMessageId: typeof replyToMessageId === "number" ? replyToMessageId : null,
    });
    return;
  }

  const stored = upsertSessionRemotePrompt(
    db,
    sessionId,
    trimmedText,
    effectivePreset === "await-reply" ? "once" : "persistent",
    message,
  );
  await appendHookDebugLog(paths, {
    type: "telegram-bridge",
    action: stored ? "queue-prompt" : "ignored-message",
    reason: stored ? undefined : "empty-text",
    botToken,
    sessionId,
    updateId: update.update_id ?? null,
    chatId,
    replyToMessageId: typeof replyToMessageId === "number" ? replyToMessageId : null,
  });
}

let telegramBridgeStarted = false;
let telegramBridgePolling = false;

async function pollTelegramReplies() {
  const paths = getLoopndrollPaths();
  const { client } = getLoopndrollDatabase(paths.databasePath);
  const botTokens = getTelegramBridgeBotTokens(client);

  for (const botToken of botTokens) {
    const cursor = getTelegramUpdateCursor(client, botToken);
    const updates = await fetchTelegramUpdates(
      botToken,
      typeof cursor === "number" ? cursor + 1 : undefined,
    );
    if (updates.length === 0) {
      continue;
    }

    const lastUpdateId = updates.reduce((max, update) => {
      return typeof update.update_id === "number" && update.update_id > max
        ? update.update_id
        : max;
    }, cursor ?? -1);

    for (const update of updates) {
      await processTelegramBridgeUpdate(paths, client, botToken, update);
    }

    setTelegramUpdateCursor(client, botToken, lastUpdateId);
  }
}

export function startLoopndrollTelegramBridge() {
  if (telegramBridgeStarted) {
    return;
  }

  telegramBridgeStarted = true;

  const runPoll = async () => {
    if (telegramBridgePolling) {
      return;
    }

    telegramBridgePolling = true;
    try {
      await pollTelegramReplies();
    } catch (error) {
      await appendHookDebugLog(getLoopndrollPaths(), {
        type: "telegram-bridge",
        action: "poll-error",
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {
        // Ignore logging failures while preserving the bridge loop.
      });
    } finally {
      telegramBridgePolling = false;
    }
  };

  void runPoll();
  setInterval(() => {
    void runPoll();
  }, TELEGRAM_BRIDGE_POLL_INTERVAL_MS);
}

async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}

async function loadHooksDocument(paths: LoopndrollPaths) {
  try {
    const raw = await readFile(paths.codexHooksPath, "utf8");
    return JSON.parse(raw) as HooksDocument;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { hooks: {} };
    }

    const backupPath = `${paths.codexHooksPath}.corrupt.${Date.now()}`;
    try {
      await copyFile(paths.codexHooksPath, backupPath);
    } catch {
      // Ignore backup failures and continue with a clean hooks file.
    }

    return { hooks: {} };
  }
}

function ensureCodexHooksFeature(configText: string) {
  const hasTrailingNewline = configText.endsWith("\n");
  const lines = configText.split("\n");
  const featuresIndex = lines.findIndex((line) => line.trim() === "[features]");

  if (featuresIndex === -1) {
    const trimmed = configText.trimEnd();
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[features]\ncodex_hooks = true\n`;
  }

  let blockEndIndex = lines.length;
  for (let index = featuresIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && /^\s*\[.*\]\s*$/.test(line)) {
      blockEndIndex = index;
      break;
    }
  }

  const nextBlockLines = lines
    .slice(featuresIndex + 1, blockEndIndex)
    .filter((line) => !/^\s*codex_hooks\s*=/.test(line));

  nextBlockLines.push("codex_hooks = true");

  const nextLines = [
    ...lines.slice(0, featuresIndex + 1),
    ...nextBlockLines,
    ...lines.slice(blockEndIndex),
  ];

  const nextConfig = nextLines.join("\n");
  return hasTrailingNewline || nextConfig.length === 0
    ? `${nextConfig.replace(/\n*$/, "")}\n`
    : nextConfig;
}

async function ensureCodexConfig(paths: LoopndrollPaths) {
  const current = (await readFile(paths.codexConfigPath, "utf8").catch(() => "")) ?? "";
  const next = ensureCodexHooksFeature(current);

  if (next !== current) {
    await ensureDirectory(paths.codexDirectoryPath);
    await writeFile(paths.codexConfigPath, next, "utf8");
  }
}

function quoteCommandPath(path: string) {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function isManagedHookCommand(command: string | undefined) {
  return typeof command === "string" && command.includes(MANAGED_HOOK_MARKER);
}

function removeManagedHooks(hooksDocument: HooksDocument) {
  const nextHooks: Record<string, HookMatcherGroup[]> = {};

  for (const [eventName, groups] of Object.entries(hooksDocument.hooks ?? {})) {
    const nextGroups: HookMatcherGroup[] = [];

    for (const group of groups) {
      const nextHandlers = (group.hooks ?? []).filter(
        (hook) => !isManagedHookCommand(hook.command),
      );
      if (nextHandlers.length > 0) {
        nextGroups.push({ ...group, hooks: nextHandlers });
      }
    }

    if (nextGroups.length > 0) {
      nextHooks[eventName] = nextGroups;
    }
  }

  hooksDocument.hooks = nextHooks;
}

function upsertManagedHooks(paths: LoopndrollPaths, hooksDocument: HooksDocument) {
  if (!hooksDocument.hooks) {
    hooksDocument.hooks = {};
  }

  removeManagedHooks(hooksDocument);

  const command = `${quoteCommandPath(paths.managedHookPath)} --hook ${MANAGED_HOOK_MARKER}`;

  hooksDocument.hooks.SessionStart = [
    ...(hooksDocument.hooks.SessionStart ?? []),
    {
      matcher: "startup|resume",
      hooks: [
        {
          type: "command",
          command,
          timeout: 30,
          statusMessage: SESSION_STATUS_MESSAGE,
        },
      ],
    },
  ];
  hooksDocument.hooks.Stop = [
    ...(hooksDocument.hooks.Stop ?? []),
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: 86_400,
          statusMessage: STOP_STATUS_MESSAGE,
        },
      ],
    },
  ];
  hooksDocument.hooks.UserPromptSubmit = [
    ...(hooksDocument.hooks.UserPromptSubmit ?? []),
    {
      hooks: [
        {
          type: "command",
          command,
          timeout: 30,
          statusMessage: PROMPT_STATUS_MESSAGE,
        },
      ],
    },
  ];
}

function buildManagedHookScript(paths: LoopndrollPaths) {
  return `#!/usr/bin/env bun
// ${MANAGED_HOOK_SCRIPT_MARKER}
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const databasePath = ${JSON.stringify(paths.databasePath)};
const logsDirectoryPath = ${JSON.stringify(paths.logsDirectoryPath)};
const hookDebugLogPath = ${JSON.stringify(paths.hookDebugLogPath)};
const defaultPrompt = ${JSON.stringify(DEFAULT_PROMPT)};
const generatedTitleMatchWindowMs = ${String(GENERATED_TITLE_MATCH_WINDOW_MS)};
const awaitReplyPollIntervalMs = ${String(AWAIT_REPLY_POLL_INTERVAL_MS)};
const telegramMaxMessageLength = ${String(TELEGRAM_MAX_MESSAGE_LENGTH)};
const telegramNotificationFooter = ${JSON.stringify(TELEGRAM_NOTIFICATION_FOOTER)};
const hookDebugLogEnvName = ${JSON.stringify(HOOK_DEBUG_LOG_ENV_NAME)};
const redactedDebugValue = ${JSON.stringify(REDACTED_DEBUG_VALUE)};
const hookDebugRedactedKeys = ${JSON.stringify([...HOOK_DEBUG_REDACTED_KEYS])};
const sqlitePragmas = ${JSON.stringify([...SQLITE_PRAGMA_STATEMENTS])};
const appMigrations = ${JSON.stringify(appMigrations)};

function nowIsoString() {
  return new Date().toISOString();
}

function isTruthyEnvValue(value) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeLoopPreset(value) {
  return value === "infinite" ||
    value === "await-reply" ||
    value === "completion-checks" ||
    value === "max-turns-1" ||
    value === "max-turns-2" ||
    value === "max-turns-3"
    ? value
    : null;
}

function resolveSessionPresetState(sessionPresetValue, presetOverriddenValue, globalPresetValue) {
  const preset = normalizeLoopPreset(sessionPresetValue);
  const presetOverridden = Boolean(presetOverriddenValue);
  const globalPreset = normalizeLoopPreset(globalPresetValue);

  if (preset !== null) {
    return {
      preset,
      presetSource: "session",
      effectivePreset: preset,
    };
  }

  if (presetOverridden) {
    return {
      preset: null,
      presetSource: "off",
      effectivePreset: null,
    };
  }

  return {
    preset: null,
    presetSource: "global",
    effectivePreset: globalPreset,
  };
}

function isSqliteBusyError(error) {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withSqliteBusyRetry(operation, maxAttempts = 5, delayMs = 25) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= maxAttempts) {
        throw error;
      }

      sleepSync(delayMs);
    }
  }
}

function truncateTelegramText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return \`\${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…\`;
}

function buildTelegramNotificationText(sessionRef, sessionTitle, message, preset) {
  const headerParts = [];
  if (typeof sessionRef === "string" && sessionRef.trim().length > 0) {
    headerParts.push(\`[\${sessionRef.trim()}]\`);
  }
  if (typeof sessionTitle === "string" && sessionTitle.trim().length > 0) {
    headerParts.push(sessionTitle.trim());
  }

  const header = headerParts.join(" - ");
  const segments = [header, String(message ?? "").trim()].filter(
    (segment) => typeof segment === "string" && segment.length > 0,
  );

  const replyCommandFooter =
    typeof sessionRef === "string" && sessionRef.trim().length > 0
      ? \`Or send /reply \${sessionRef.trim()} your message.\`
      : null;

  if (preset === "await-reply" || preset === "completion-checks") {
    segments.push("---------", telegramNotificationFooter);
    if (replyCommandFooter) {
      segments.push(replyCommandFooter);
    }
  } else if (preset === "infinite" || preset === "max-turns-1" || preset === "max-turns-2" || preset === "max-turns-3") {
    segments.push(
      "---------",
      "Reply to this message in Telegram to replace the prompt that will keep being sent to this Codex chat.",
    );
    if (replyCommandFooter) {
      segments.push(replyCommandFooter);
    }
  }

  return truncateTelegramText(segments.join("\\n\\n"), telegramMaxMessageLength);
}

function buildTelegramBotUrl(botToken) {
  return \`https://api.telegram.org/bot\${botToken}/sendMessage\`;
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

function shouldEnableHookDebugLogging() {
  return isTruthyEnvValue(process.env[hookDebugLogEnvName]);
}

function sanitizeHookDebugLogValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHookDebugLogValue(item, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      if (
        hookDebugRedactedKeys.includes(entryKey) ||
        /(token|secret|password)$/i.test(entryKey)
      ) {
        return [entryKey, redactedDebugValue];
      }

      return [entryKey, sanitizeHookDebugLogValue(entryValue, seen)];
    }),
  );
}

async function appendHookDebugLog(entry) {
  if (!shouldEnableHookDebugLogging()) {
    return;
  }

  await ensureDirectory(logsDirectoryPath);
  await appendFile(
    hookDebugLogPath,
    \`\${JSON.stringify(
      sanitizeHookDebugLogValue({
        timestamp: nowIsoString(),
        ...entry,
      }),
    )}\\n\`,
    "utf8",
  );
}

function configureDatabase(db) {
  for (const statement of sqlitePragmas) {
    db.exec(statement);
  }
}

function shouldIgnoreMigrationStatementError(db, statement, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.toLowerCase().includes("duplicate column name:")) {
    return false;
  }

  const match = /^\\s*alter\\s+table\\s+(\\w+)\\s+add\\s+column\\s+(\\w+)/i.exec(statement);
  if (!match) {
    return false;
  }

  const [, tableName, columnName] = match;
  const rows = db.query(\`pragma table_info(\${tableName})\`).all();
  return rows.some((row) => row.name === columnName);
}

function applyMigrations(db) {
  db.exec(\`create table if not exists schema_migrations (
    id integer primary key,
    name text not null,
    applied_at text not null
  )\`);

  const appliedRows = db.query("select id from schema_migrations order by id asc").all();
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const insertMigration = db.query(
    "insert into schema_migrations (id, name, applied_at) values (?, ?, ?)",
  );
  const applyMigration = db.transaction((migration) => {
    for (const statement of migration.statements) {
      try {
        db.exec(statement);
      } catch (error) {
        if (shouldIgnoreMigrationStatementError(db, statement, error)) {
          continue;
        }

        throw error;
      }
    }

    insertMigration.run(migration.id, migration.name, nowIsoString());
  });

  for (const migration of appMigrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    applyMigration(migration);
  }
}

function getSettings(db) {
  const row = db
    .query(
      "select default_prompt, scope, global_preset, global_notification_id, global_completion_check_id, global_completion_check_wait_for_reply, hooks_auto_registration from settings where id = 1",
    )
    .get();
  if (!row) {
    throw new Error("Loopndroll settings row is missing.");
  }

  return row;
}

function getValidGlobalNotificationId(db, candidate) {
  if (typeof candidate !== "string") {
    return null;
  }

  const notificationId = candidate.trim();
  if (notificationId.length === 0) {
    return null;
  }

  const existingNotification = db
    .query("select id from notifications where id = ?")
    .get(notificationId);

  return existingNotification ? notificationId : null;
}

function getValidGlobalCompletionCheckId(db, candidate) {
  if (typeof candidate !== "string") {
    return null;
  }

  const completionCheckId = candidate.trim();
  if (completionCheckId.length === 0) {
    return null;
  }

  const existingCompletionCheck = db
    .query("select id from completion_checks where id = ?")
    .get(completionCheckId);

  return existingCompletionCheck ? completionCheckId : null;
}

function parseCompletionCheckCommands(commandsJson) {
  try {
    const parsed = JSON.parse(commandsJson);
    return Array.isArray(parsed)
      ? parsed.map((command) => String(command).trim()).filter((command) => command.length > 0)
      : [];
  } catch {
    return [];
  }
}

function getActiveCompletionCheckForSession(db, sessionId) {
  const row = db
    .query(
      \`select
        s.preset as session_preset,
        s.preset_overridden as preset_overridden,
        s.completion_check_id as session_completion_check_id,
        s.completion_check_wait_for_reply as session_completion_check_wait_for_reply,
        st.global_preset as global_preset,
        st.global_completion_check_id as global_completion_check_id,
        st.global_completion_check_wait_for_reply as global_completion_check_wait_for_reply
      from sessions s
      left join settings st on st.id = 1
      where s.session_id = ?
      limit 1\`,
    )
    .get(sessionId);
  if (!row) {
    return {
      completionCheck: null,
      waitForReplyAfterCompletion: false,
    };
  }

  const presetState = resolveSessionPresetState(
    row.session_preset,
    row.preset_overridden,
    row.global_preset,
  );
  const usesSessionConfig = presetState.presetSource === "session";
  const completionCheckId = getValidGlobalCompletionCheckId(
    db,
    usesSessionConfig ? row.session_completion_check_id : row.global_completion_check_id,
  );
  if (completionCheckId === null) {
    return {
      completionCheck: null,
      waitForReplyAfterCompletion: false,
    };
  }

  const completionCheckRow = db
    .query(
      "select id, label, commands_json from completion_checks where id = ? limit 1",
    )
    .get(completionCheckId);
  if (!completionCheckRow) {
    return {
      completionCheck: null,
      waitForReplyAfterCompletion: false,
    };
  }

  return {
    completionCheck: {
      id: completionCheckRow.id,
      label: completionCheckRow.label,
      commands: parseCompletionCheckCommands(completionCheckRow.commands_json),
    },
    waitForReplyAfterCompletion: usesSessionConfig
      ? Boolean(row.session_completion_check_wait_for_reply)
      : Boolean(row.global_completion_check_wait_for_reply),
  };
}

function summarizeCompletionCheckOutput(output) {
  const normalizedOutput = String(output ?? "").trim();
  if (normalizedOutput.length === 0) {
    return null;
  }

  const lines = normalizedOutput.split(/\\r?\\n/).map((line) => line.trimEnd()).filter(Boolean);
  const tail = lines.slice(-8).join("\\n").trim();
  return tail.length > 0 ? tail : null;
}

function runCompletionCheckCommands(input, completionCheck) {
  const cwd = typeof input?.cwd === "string" && input.cwd.trim().length > 0 ? input.cwd : null;
  if (cwd === null) {
    return {
      status: "skipped",
    };
  }

  if (!completionCheck || !Array.isArray(completionCheck.commands) || completionCheck.commands.length === 0) {
    return {
      status: "skipped",
    };
  }

  for (const command of completionCheck.commands) {
    const result = spawnSync("/bin/sh", ["-lc", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\\n").trim();

    if (result.error) {
      const outputSummary = summarizeCompletionCheckOutput(combinedOutput);
      return {
        status: "failed",
        reason: [
          "Completion check failed while running:",
          command,
          outputSummary ? "" : "The command exited before completion.",
          outputSummary ? \`Recent output:\\n\${outputSummary}\` : null,
          "",
          "Fix issues.",
        ]
          .filter(Boolean)
          .join("\\n"),
      };
    }

    if (result.status !== 0) {
      const outputSummary = summarizeCompletionCheckOutput(combinedOutput);
      return {
        status: "failed",
        reason: [
          "Completion check failed while running:",
          command,
          \`Exit code: \${result.status}\`,
          outputSummary ? \`Recent output:\\n\${outputSummary}\` : null,
          "",
          "Fix issues.",
        ]
          .filter(Boolean)
          .join("\\n"),
      };
    }
  }

  return {
    status: "passed",
  };
}

function applyGlobalNotificationToSession(db, sessionId, notificationId) {
  if (notificationId === null) {
    return;
  }

  withSqliteBusyRetry(() =>
    db
      .query(
        \`insert into session_notifications (session_id, notification_id)
          values (?, ?)
          on conflict(session_id, notification_id) do nothing\`,
      )
      .run(sessionId, notificationId),
  );
}

function allocateNextSessionRef(db) {
  const allocate = db.transaction(() => {
    const row = db.query("select last_value from session_ref_sequence where id = 1").get();
    const nextValue = (typeof row?.last_value === "number" ? row.last_value : 0) + 1;

    db.query(
      \`insert into session_ref_sequence (id, last_value)
        values (1, ?)
        on conflict(id) do update set last_value = excluded.last_value\`,
    ).run(nextValue);

    return \`C\${nextValue}\`;
  });

  return withSqliteBusyRetry(() => allocate());
}

function buildNewSession(db, sessionId) {
  const timestamp = nowIsoString();
  return {
    sessionId,
    sessionRef: allocateNextSessionRef(db),
    source: "startup",
    cwd: null,
    archived: false,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    activeSince: null,
    stopCount: 0,
    preset: null,
    presetOverridden: false,
    title: null,
    transcriptPath: null,
    lastAssistantMessage: null,
  };
}

function getSession(db, sessionId) {
  const row = db
    .query(
      \`select
        session_id,
        session_ref,
        source,
        cwd,
        archived,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset,
        preset_overridden,
        title,
        transcript_path,
        last_assistant_message
      from sessions
      where session_id = ?\`,
    )
    .get(sessionId);

  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    sessionRef: row.session_ref,
    source: row.source,
    cwd: row.cwd,
    archived: Boolean(row.archived),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    activeSince: row.active_since,
    stopCount: row.stop_count,
    preset: row.preset,
    presetOverridden: Boolean(row.preset_overridden),
    title: row.title,
    transcriptPath: row.transcript_path,
    lastAssistantMessage: row.last_assistant_message,
  };
}

function writeSession(db, session, existing) {
  if (existing) {
    withSqliteBusyRetry(() =>
      db
        .query(
          \`update sessions
          set session_ref = ?,
              source = ?,
              cwd = ?,
              archived = ?,
              first_seen_at = ?,
              last_seen_at = ?,
              active_since = ?,
              stop_count = ?,
              preset = ?,
              preset_overridden = ?,
              title = ?,
              transcript_path = ?,
              last_assistant_message = ?
          where session_id = ?\`,
        )
        .run(
          session.sessionRef,
          session.source,
          session.cwd,
          session.archived ? 1 : 0,
          session.firstSeenAt,
          session.lastSeenAt,
          session.activeSince,
          session.stopCount,
          session.preset,
          session.presetOverridden ? 1 : 0,
          session.title,
          session.transcriptPath,
          session.lastAssistantMessage,
          session.sessionId,
        ),
    );
    return;
  }

  withSqliteBusyRetry(() =>
    db
      .query(
        \`insert into sessions (
          session_id,
          session_ref,
          source,
          cwd,
          archived,
          first_seen_at,
          last_seen_at,
          active_since,
          stop_count,
          preset,
          preset_overridden,
          title,
          transcript_path,
          last_assistant_message
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
      )
      .run(
        session.sessionId,
        session.sessionRef,
        session.source,
        session.cwd,
        session.archived ? 1 : 0,
        session.firstSeenAt,
        session.lastSeenAt,
        session.activeSince,
        session.stopCount,
        session.preset,
        session.presetOverridden ? 1 : 0,
        session.title,
        session.transcriptPath,
        session.lastAssistantMessage,
      ),
  );
}

function deriveSessionTitle(prompt) {
  const normalizedPrompt = String(prompt ?? "").replace(/\\s+/g, " ").trim();
  if (normalizedPrompt.length === 0) {
    return null;
  }

  return normalizedPrompt.slice(0, 80);
}

function upsertSession(db, input, source) {
  const existing = getSession(db, input.session_id);
  const next = existing ? { ...existing } : buildNewSession(db, input.session_id);

  next.source = source;
  if (typeof input.cwd === "string" && input.cwd.length > 0) {
    next.cwd = input.cwd;
  }
  next.lastSeenAt = nowIsoString();
  next.firstSeenAt = existing?.firstSeenAt ?? next.firstSeenAt;
  if (typeof input.transcript_path === "string" && input.transcript_path.length > 0) {
    next.transcriptPath = input.transcript_path;
  }
  if (typeof input.last_assistant_message === "string") {
    next.lastAssistantMessage = input.last_assistant_message;
  }
  if (typeof input.prompt === "string" && !next.title) {
    next.title = deriveSessionTitle(input.prompt);
  }

  const effectivePreset = resolveSessionPresetState(
    next.preset,
    next.presetOverridden,
    getSettings(db).global_preset,
  ).effectivePreset;
  if (effectivePreset !== null && next.activeSince === null) {
    next.activeSince = nowIsoString();
  } else if (effectivePreset === null && next.activeSince !== null) {
    next.activeSince = null;
  }

  writeSession(db, next, existing);
  if (!existing) {
    applyGlobalNotificationToSession(
      db,
      next.sessionId,
      getValidGlobalNotificationId(db, getSettings(db).global_notification_id),
    );
  }
  return next;
}

function syncInheritedSessionActiveSinceForGlobalPresetChange(
  db: Database,
  preset: LoopPreset | null,
  timestamp = nowIsoString(),
) {
  if (preset === null) {
    db.query(
      \`update sessions
       set active_since = null
       where archived = 0
         and preset_overridden = 0\`,
    ).run();
    return;
  }

  db.query(
    \`update sessions
     set active_since = coalesce(active_since, ?)
     where archived = 0
       and preset_overridden = 0\`,
  ).run(timestamp);
}

function isPromptOnlyArtifact(session) {
  if (session.transcriptPath !== null) {
    return false;
  }

  const titleLooksInternal = session.title?.startsWith("You are a helpful assistant.") ?? false;
  const assistantPayloadLooksInternal = session.lastAssistantMessage?.startsWith("{\\"title\\":") ?? false;

  return titleLooksInternal || assistantPayloadLooksInternal;
}

function parseGeneratedTitlePayload(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(message);
    return typeof parsed?.title === "string" && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : null;
  } catch {
    return null;
  }
}

function findGeneratedTitleTargetSession(db, input) {
  if (typeof input.cwd !== "string" || input.cwd.length === 0) {
    return null;
  }

  const cutoffIso = new Date(Date.now() - generatedTitleMatchWindowMs).toISOString();
  const rows = db
    .query(
      \`select
        session_id,
        session_ref,
        source,
        cwd,
        first_seen_at,
        last_seen_at,
        active_since,
        stop_count,
        preset,
        title,
        transcript_path,
        last_assistant_message
      from sessions
      where session_id != ?
        and cwd = ?
        and transcript_path is not null
        and last_seen_at >= ?
      order by last_seen_at desc\`,
    )
    .all(input.session_id, input.cwd, cutoffIso)
    .map((row) => ({
      sessionId: row.session_id,
      sessionRef: row.session_ref,
      source: row.source,
      cwd: row.cwd,
      archived: Boolean(row.archived),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      activeSince: row.active_since,
      stopCount: row.stop_count,
      preset: row.preset,
      title: row.title,
      transcriptPath: row.transcript_path,
      lastAssistantMessage: row.last_assistant_message,
    }));

  return rows.find((session) => !isPromptOnlyArtifact(session)) ?? null;
}

function updateSessionTitle(db, sessionId, title) {
  db.query("update sessions set title = ? where session_id = ?").run(title, sessionId);
}

function getRemainingTurns(db, sessionId) {
  const row = db
    .query("select remaining_turns from session_runtime where session_id = ?")
    .get(sessionId);
  return typeof row?.remaining_turns === "number" ? row.remaining_turns : null;
}

function setRemainingTurns(db, sessionId, remainingTurns) {
  db.query(
    \`insert into session_runtime (session_id, remaining_turns)
      values (?, ?)
      on conflict(session_id) do update set remaining_turns = excluded.remaining_turns\`,
  ).run(sessionId, remainingTurns);
}

function clearRemainingTurns(db, sessionId) {
  db.query("delete from session_runtime where session_id = ?").run(sessionId);
}

function clearSessionAwaitingReplies(db, sessionId) {
  db.query("delete from session_awaiting_replies where session_id = ?").run(sessionId);
}

function replaceSessionAwaitingReplies(db, sessionId, turnId, telegramTargets) {
  clearSessionAwaitingReplies(db, sessionId);

  if (!Array.isArray(telegramTargets) || telegramTargets.length === 0) {
    return 0;
  }

  const insertAwaitingReply = db.query(
    \`insert into session_awaiting_replies (
      session_id,
      bot_token,
      chat_id,
      turn_id,
      started_at
    ) values (?, ?, ?, ?, ?)\`,
  );
  const startedAt = nowIsoString();
  let insertedCount = 0;
  const seenTargets = new Set();

  for (const target of telegramTargets) {
    const botToken = typeof target?.botToken === "string" ? target.botToken.trim() : "";
    const chatId = typeof target?.chatId === "string" ? target.chatId.trim() : "";
    if (botToken.length === 0 || chatId.length === 0) {
      continue;
    }

    const dedupeKey = \`\${botToken}::\${chatId}\`;
    if (seenTargets.has(dedupeKey)) {
      continue;
    }

    seenTargets.add(dedupeKey);
    insertAwaitingReply.run(sessionId, botToken, chatId, turnId ?? null, startedAt);
    insertedCount += 1;
  }

  return insertedCount;
}

function getSessionRemotePrompt(db, sessionId, deliveryMode) {
  const row = db
    .query(
      "select prompt_text from session_remote_prompts where session_id = ? and delivery_mode = ?",
    )
    .get(sessionId, deliveryMode);
  const promptText =
    typeof row?.prompt_text === "string" && row.prompt_text.trim().length > 0
      ? row.prompt_text.trim()
      : null;

  return promptText;
}

function consumeSessionRemotePrompt(db, sessionId) {
  const promptText = getSessionRemotePrompt(db, sessionId, "once");

  if (promptText === null) {
    return null;
  }

  db.query(
    "delete from session_remote_prompts where session_id = ? and delivery_mode = 'once'",
  ).run(sessionId);
  return promptText;
}

function readPersistentSessionRemotePrompt(db, sessionId) {
  return getSessionRemotePrompt(db, sessionId, "persistent");
}

function renderPrompt(template, remainingTurns) {
  return template
    .replaceAll("{{remaining_turns}}", remainingTurns === null ? "" : String(remainingTurns))
    .trim();
}

function getMaxTurns(preset) {
  if (preset === "max-turns-1") return 1;
  if (preset === "max-turns-2") return 2;
  if (preset === "max-turns-3") return 3;
  return null;
}

function getEffectivePreset(db, sessionId) {
  const row = db
    .query(
      \`select
        s.preset as session_preset,
        s.preset_overridden as preset_overridden,
        s.archived as session_archived,
        st.global_preset as global_preset
      from sessions s
      left join settings st on st.id = 1
      where s.session_id = ?
      limit 1\`,
    )
    .get(sessionId);

  if (!row) {
    return null;
  }

  if (Boolean(row.session_archived)) {
    return null;
  }

  return resolveSessionPresetState(
    row.session_preset,
    row.preset_overridden,
    row.global_preset,
  ).effectivePreset;
}

function toHookStopOutput(stopDecision) {
  if (!stopDecision || typeof stopDecision !== "object") {
    return null;
  }

  if (stopDecision.continue === false) {
    return {
      continue: false,
      stopReason:
        typeof stopDecision.stopReason === "string" ? stopDecision.stopReason : undefined,
    };
  }

  if (stopDecision.decision === "block" && typeof stopDecision.reason === "string") {
    return {
      decision: "block",
      reason: stopDecision.reason,
    };
  }

  return null;
}

function shouldWaitForReplyAfterCompletion(db, sessionId) {
  const activeGlobalCompletionCheck = getActiveCompletionCheckForSession(db, sessionId);
  return (
    activeGlobalCompletionCheck.completionCheck !== null &&
    activeGlobalCompletionCheck.waitForReplyAfterCompletion
  );
}

async function waitForAwaitReplyResolution(db, sessionId, waitMode = "await-reply") {
  while (true) {
    const remotePrompt = consumeSessionRemotePrompt(db, sessionId);
    if (remotePrompt) {
      return {
        type: "prompt",
        prompt: remotePrompt,
      };
    }

    const effectivePreset = getEffectivePreset(db, sessionId);
    const shouldKeepWaiting =
      waitMode === "completion-checks"
        ? effectivePreset === "completion-checks" &&
          shouldWaitForReplyAfterCompletion(db, sessionId)
        : effectivePreset === "await-reply";
    if (!shouldKeepWaiting) {
      return {
        type: "preset-change",
        preset: effectivePreset,
      };
    }

    await Bun.sleep(awaitReplyPollIntervalMs);
  }
}

async function applyStopDecision(db, settingsRow, sessionId, preset, input, telegramTargets) {
  if (!preset) {
    clearRemainingTurns(db, sessionId);
    clearSessionAwaitingReplies(db, sessionId);
    return null;
  }

  if (preset === "infinite") {
    clearSessionAwaitingReplies(db, sessionId);
    const remotePrompt =
      readPersistentSessionRemotePrompt(db, sessionId) ?? consumeSessionRemotePrompt(db, sessionId);
    return {
      decision: "block",
      reason: remotePrompt ?? renderPrompt(settingsRow.default_prompt, null),
      remainingTurnsBefore: null,
      remainingTurnsAfter: null,
      promptSource: remotePrompt ? "telegram" : "default",
    };
  }

  if (preset === "await-reply") {
    clearRemainingTurns(db, sessionId);

    const queuedPrompt = consumeSessionRemotePrompt(db, sessionId);
    if (queuedPrompt) {
      clearSessionAwaitingReplies(db, sessionId);
      return {
        decision: "block",
        reason: queuedPrompt,
        remainingTurnsBefore: null,
        remainingTurnsAfter: null,
        promptSource: "telegram",
      };
    }

    const awaitingReplyCount = replaceSessionAwaitingReplies(
      db,
      sessionId,
      typeof input?.turn_id === "string" ? input.turn_id : null,
      telegramTargets,
    );
    if (awaitingReplyCount <= 0) {
      clearSessionAwaitingReplies(db, sessionId);
      return null;
    }

    const resolution = await waitForAwaitReplyResolution(db, sessionId);
    clearSessionAwaitingReplies(db, sessionId);
    if (resolution?.type === "prompt") {
      return {
        decision: "block",
        reason: resolution.prompt,
        remainingTurnsBefore: null,
        remainingTurnsAfter: null,
        promptSource: "telegram",
      };
    }

    if (resolution?.type === "preset-change") {
      const nextSettingsRow = getSettings(db);
      return await applyStopDecision(
        db,
        nextSettingsRow,
        sessionId,
        resolution.preset,
        input,
        [],
      );
    }

    return null;
  }

  if (preset === "completion-checks") {
    clearRemainingTurns(db, sessionId);

    const activeGlobalCompletionCheck = getActiveCompletionCheckForSession(db, sessionId);
    const runResult = runCompletionCheckCommands(input, activeGlobalCompletionCheck.completionCheck);
    if (runResult.status === "failed") {
      clearSessionAwaitingReplies(db, sessionId);
      return {
        decision: "block",
        reason: runResult.reason,
        remainingTurnsBefore: null,
        remainingTurnsAfter: null,
        promptSource: "default",
      };
    }

    if (!activeGlobalCompletionCheck.waitForReplyAfterCompletion) {
      clearSessionAwaitingReplies(db, sessionId);
      return null;
    }

    const queuedPrompt = consumeSessionRemotePrompt(db, sessionId);
    if (queuedPrompt) {
      clearSessionAwaitingReplies(db, sessionId);
      return {
        decision: "block",
        reason: queuedPrompt,
        remainingTurnsBefore: null,
        remainingTurnsAfter: null,
        promptSource: "telegram",
      };
    }

    const awaitingReplyCount = replaceSessionAwaitingReplies(
      db,
      sessionId,
      typeof input?.turn_id === "string" ? input.turn_id : null,
      telegramTargets,
    );
    if (awaitingReplyCount <= 0) {
      clearSessionAwaitingReplies(db, sessionId);
      return null;
    }

    const resolution = await waitForAwaitReplyResolution(db, sessionId, "completion-checks");
    clearSessionAwaitingReplies(db, sessionId);
    if (resolution?.type === "prompt") {
      return {
        decision: "block",
        reason: resolution.prompt,
        remainingTurnsBefore: null,
        remainingTurnsAfter: null,
        promptSource: "telegram",
      };
    }

    if (resolution?.type === "preset-change") {
      const nextSettingsRow = getSettings(db);
      return await applyStopDecision(
        db,
        nextSettingsRow,
        sessionId,
        resolution.preset,
        input,
        [],
      );
    }

    return null;
  }

  const maxTurns = getMaxTurns(preset);
  if (maxTurns === null) {
    clearRemainingTurns(db, sessionId);
    clearSessionAwaitingReplies(db, sessionId);
    return null;
  }

  const remainingTurns = getRemainingTurns(db, sessionId) ?? maxTurns;
  if (remainingTurns <= 0) {
    clearSessionAwaitingReplies(db, sessionId);
    return null;
  }

  setRemainingTurns(db, sessionId, remainingTurns - 1);
  clearSessionAwaitingReplies(db, sessionId);
  const remotePrompt =
    readPersistentSessionRemotePrompt(db, sessionId) ?? consumeSessionRemotePrompt(db, sessionId);
  return {
    decision: "block",
    reason: remotePrompt ?? renderPrompt(settingsRow.default_prompt, remainingTurns - 1),
    remainingTurnsBefore: remainingTurns,
    remainingTurnsAfter: remainingTurns - 1,
    promptSource: remotePrompt ? "telegram" : "default",
  };
}

async function sendStopNotifications(db, input) {
  if (input.hook_event_name !== "Stop") {
    return [];
  }

  const message =
    typeof input.last_assistant_message === "string" ? input.last_assistant_message.trim() : "";
  if (message.length === 0) {
    return [];
  }

  const selectedNotifications = db
    .query(
      \`select
        n.id,
        n.label,
        n.channel,
        n.webhook_url,
        n.chat_id,
        n.bot_token,
        n.bot_url,
        n.created_at
      from notifications n
      inner join session_notifications sn on sn.notification_id = n.id
      where sn.session_id = ?
      order by n.created_at asc, n.id asc\`,
    )
    .all(input.session_id);
  if (selectedNotifications.length === 0) {
    return [];
  }

  const sessionRow = db
    .query("select session_ref, title, archived from sessions where session_id = ?")
    .get(input.session_id);
  if (Boolean(sessionRow?.archived)) {
    return [];
  }
  const effectivePreset = getEffectivePreset(db, input.session_id);
  const telegramText = buildTelegramNotificationText(
    sessionRow?.session_ref ?? null,
    sessionRow?.title ?? null,
    message,
    effectivePreset,
  );

  const deliveredTelegramTargets = [];
  const results = await Promise.allSettled(
    selectedNotifications.map(async (notification) => {
      if (notification.channel === "slack") {
        const response = await fetch(notification.webhook_url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: message }),
        });
        if (!response.ok) {
          throw new Error(\`Slack notification failed with status \${response.status}\`);
        }
        return;
      }

      const telegramEndpoint =
        (typeof notification.bot_token === "string" && notification.bot_token.length > 0
          ? buildTelegramBotUrl(notification.bot_token)
          : notification.bot_url) ?? null;
      if (!telegramEndpoint) {
        throw new Error("Telegram notification is missing a bot token.");
      }

      const response = await fetch(telegramEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          chat_id: notification.chat_id,
          text: telegramText,
        }).toString(),
      });
      if (!response.ok) {
        throw new Error(\`Telegram notification failed with status \${response.status}\`);
      }

      const payload = await response.json();
      if (!payload?.ok || typeof payload?.result?.message_id !== "number") {
        throw new Error(payload?.description || "Telegram notification did not return a message id.");
      }

      db.query(
        \`insert into telegram_delivery_receipts (
          id,
          notification_id,
          session_id,
          bot_token,
          chat_id,
          telegram_message_id,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?)\`,
      ).run(
        crypto.randomUUID(),
        notification.id,
        input.session_id,
        typeof notification.bot_token === "string" ? notification.bot_token : "",
        notification.chat_id,
        payload.result.message_id,
        nowIsoString(),
      );

      deliveredTelegramTargets.push({
        botToken: typeof notification.bot_token === "string" ? notification.bot_token : "",
        chatId: notification.chat_id,
      });
    }),
  );

  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            notificationId: selectedNotifications[index]?.id ?? null,
            channel: selectedNotifications[index]?.channel ?? null,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        ]
      : [],
  );

  await appendHookDebugLog({
    type: "notification",
    hookEventName: "Stop",
    sessionId: input.session_id,
    deliveredCount: results.length - failures.length,
    failedCount: failures.length,
    failures,
  });

  return deliveredTelegramTargets;
}

function getTelegramChatDisplayName(chat: {
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}) {
  const nameParts = [chat.first_name, chat.last_name].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );

  if (nameParts.length > 0) {
    return nameParts.join(" ");
  }

  if (typeof chat.title === "string" && chat.title.trim().length > 0) {
    return chat.title.trim();
  }

  if (typeof chat.username === "string" && chat.username.trim().length > 0) {
    return \`@\${chat.username.trim()}\`;
  }

  return "Unknown chat";
}

async function main() {
  const input = JSON.parse(await Bun.stdin.text());
  const hookEventName = input.hook_event_name;

  if (
    hookEventName !== "SessionStart" &&
    hookEventName !== "Stop" &&
    hookEventName !== "UserPromptSubmit"
  ) {
    return;
  }

  await ensureDirectory(dirname(databasePath));
  const db = new Database(databasePath, { create: true });
  configureDatabase(db);
  applyMigrations(db);

  const sessionCountBefore = db.query("select count(*) as count from sessions").get().count;

  if (typeof input.session_id !== "string" || input.session_id.length === 0) {
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: "ignored",
      reason: "missing-session-id",
      payload: input,
      sessionCountBefore,
      sessionCountAfter: sessionCountBefore,
    });
    return;
  }

  if (hookEventName === "SessionStart") {
    const session = upsertSession(db, input, input.source === "resume" ? "resume" : "startup");
    const sessionCountAfter = db.query("select count(*) as count from sessions").get().count;
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: "upsert-session",
      sessionId: input.session_id,
      payload: input,
      sessionCountBefore,
      sessionCountAfter,
      storedSession: session,
    });
    return;
  }

  if (hookEventName === "UserPromptSubmit") {
    const existingSession = getSession(db, input.session_id);
    const session = upsertSession(db, input, existingSession?.source ?? "startup");
    const sessionCountAfter = db.query("select count(*) as count from sessions").get().count;
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: existingSession ? "update-session-title" : "recover-session-on-prompt",
      sessionId: input.session_id,
      payload: input,
      sessionCountBefore,
      sessionCountAfter,
      storedSession: session,
    });
    return;
  }

  const settingsRow = getSettings(db);
  const existingSession = getSession(db, input.session_id);
  const generatedTitle =
    input.transcript_path == null ? parseGeneratedTitlePayload(input.last_assistant_message) : null;
  const titleTargetSession = generatedTitle ? findGeneratedTitleTargetSession(db, input) : null;

  if (generatedTitle && titleTargetSession) {
    updateSessionTitle(db, titleTargetSession.sessionId, generatedTitle);
    const sessionCountAfter = db.query("select count(*) as count from sessions").get().count;
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: "apply-generated-title",
      sessionId: input.session_id,
      targetSessionId: titleTargetSession.sessionId,
      generatedTitle,
      payload: input,
      sessionCountBefore,
      sessionCountAfter,
    });
    return;
  }

  if (existingSession?.archived) {
    const session = upsertSession(db, input, "stop");
    writeSession(db, session, true);
    const sessionCountAfter = db.query("select count(*) as count from sessions").get().count;
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: "ignored",
      reason: "archived-session",
      sessionId: input.session_id,
      payload: input,
      sessionCountBefore,
      sessionCountAfter,
      storedSession: session,
    });
    return;
  }

  const session = upsertSession(db, input, "stop");
  session.stopCount += 1;
  writeSession(db, session, true);
  const deliveredTelegramTargets = await sendStopNotifications(db, input);

  const preset = getEffectivePreset(db, input.session_id);
  const stopDecision = await applyStopDecision(
    db,
    settingsRow,
    input.session_id,
    preset,
    input,
    deliveredTelegramTargets,
  );
  const sessionCountAfter = db.query("select count(*) as count from sessions").get().count;
  await appendHookDebugLog({
    type: "hook-event",
    hookEventName,
    action: stopDecision ? "block-stop" : "allow-stop",
    reason: existingSession ? undefined : "recover-session-on-stop",
    sessionId: input.session_id,
    payload: input,
    sessionCountBefore,
    sessionCountAfter,
    storedSession: session,
    preset,
    remainingTurnsBefore: stopDecision?.remainingTurnsBefore ?? null,
    remainingTurnsAfter: stopDecision?.remainingTurnsAfter ?? null,
    promptSource: stopDecision?.promptSource ?? null,
  });

  if (stopDecision) {
    const hookOutput = toHookStopOutput(stopDecision);
    if (hookOutput) {
      process.stdout.write(\`\${JSON.stringify(hookOutput)}\\n\`);
    }
  }
}

await main().catch(async (error) => {
  await appendHookDebugLog({
    type: "hook-event",
    action: "uncaught-error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  });
  throw error;
});
`;
}

async function ensureManagedHookScript(paths: LoopndrollPaths) {
  await ensureDirectory(paths.binDirectoryPath);

  const existingContent = await readFile(paths.managedHookPath, "utf8").catch(() => null);
  if (existingContent && !existingContent.includes(MANAGED_HOOK_SCRIPT_MARKER)) {
    const backupPath = `${paths.managedHookPath}.bak.${Date.now()}`;
    await copyFile(paths.managedHookPath, backupPath);
  }

  await writeFile(paths.managedHookPath, buildManagedHookScript(paths), "utf8");
  await chmod(paths.managedHookPath, 0o755);
}

async function computeHealth(paths: LoopndrollPaths) {
  const issues: string[] = [];
  const configContents = await readFile(paths.codexConfigPath, "utf8").catch(() => null);
  const hooksDocument = await loadHooksDocument(paths);
  const scriptExists = await stat(paths.managedHookPath)
    .then(() => true)
    .catch(() => false);
  const hookEvents = hooksDocument.hooks ?? {};
  const hasManagedSessionStart = (hookEvents.SessionStart ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );
  const hasManagedStop = (hookEvents.Stop ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );
  const hasManagedUserPromptSubmit = (hookEvents.UserPromptSubmit ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => isManagedHookCommand(hook.command)),
  );

  if (!configContents || !/\bcodex_hooks\s*=\s*true\b/.test(configContents)) {
    issues.push("Codex hooks are not enabled in ~/.codex/config.toml.");
  }
  if (!hasManagedSessionStart) {
    issues.push("Managed SessionStart hook is not registered.");
  }
  if (!hasManagedStop) {
    issues.push("Managed Stop hook is not registered.");
  }
  if (!hasManagedUserPromptSubmit) {
    issues.push("Managed UserPromptSubmit hook is not registered.");
  }
  if (!scriptExists) {
    issues.push("Managed hook executable is missing.");
  }

  return {
    registered: issues.length === 0,
    issues,
  };
}

async function ensureRegistered(paths: LoopndrollPaths) {
  await ensureDirectory(paths.codexDirectoryPath);
  await ensureManagedHookScript(paths);
  await ensureCodexConfig(paths);

  const hooksDocument = await loadHooksDocument(paths);
  upsertManagedHooks(paths, hooksDocument);
  await writeFile(paths.codexHooksPath, `${JSON.stringify(hooksDocument, null, 2)}\n`, "utf8");

  await appendHookDebugLog(paths, {
    type: "setup",
    action: "register-hooks",
    managedHookPath: paths.managedHookPath,
    hooksFilePath: paths.codexHooksPath,
  });
}

async function loadSnapshot(paths: LoopndrollPaths) {
  getLoopndrollDatabase(paths.databasePath);
  const baseSnapshot = readSnapshotFromDatabase();
  const health = await computeHealth(paths);

  return {
    ...baseSnapshot,
    health,
  } satisfies LoopndrollSnapshot;
}

export async function ensureLoopndrollSetup() {
  const paths = getLoopndrollPaths();
  getLoopndrollDatabase(paths.databasePath);

  if (getSettingsRow().hooksAutoRegistration) {
    await ensureRegistered(paths);
  }

  return loadSnapshot(paths);
}

export async function getLoopndrollSnapshot() {
  const paths = getLoopndrollPaths();
  return loadSnapshot(paths);
}

export async function saveDefaultPrompt(defaultPrompt: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.update(settings)
    .set({ defaultPrompt: defaultPrompt.trim() || DEFAULT_PROMPT })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function createLoopNotification(notification: CreateLoopNotificationInput) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingNotifications = readSnapshotFromDatabase().notifications;
  const nextNotification = createNotification(notification);

  nextNotification.label = getUniqueNotificationLabel(
    existingNotifications,
    getNotificationBaseLabel(notification),
  );

  db.insert(notifications).values(notificationInsertFromValue(nextNotification)).run();

  return loadSnapshot(paths);
}

export async function createCompletionCheck(input: { label?: string; commands: string[] }) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingCompletionChecks = readSnapshotFromDatabase().completionChecks;
  const commands = normalizeCompletionCheckCommands(input.commands);
  if (commands.length === 0) {
    throw new Error("At least one command is required.");
  }

  db.insert(completionChecks)
    .values({
      id: crypto.randomUUID(),
      label: getUniqueCompletionCheckLabel(
        existingCompletionChecks,
        input.label?.trim() || "Completion check",
      ),
      commandsJson: stringifyCompletionCheckCommands(commands),
      createdAt: nowIsoString(),
    })
    .run();

  return loadSnapshot(paths);
}

export async function updateLoopNotification(notification: UpdateLoopNotificationInput) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingNotificationRows = db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .all();
  const existingNotifications = existingNotificationRows.map(mapNotificationRow);
  const currentNotification = existingNotifications.find(
    (current) => current.id === notification.id,
  );

  if (!currentNotification) {
    return loadSnapshot(paths);
  }

  const label = getUniqueNotificationLabel(
    existingNotifications,
    getNotificationBaseLabel(notification),
    notification.id,
  );

  if (notification.channel === "slack") {
    db.update(notifications)
      .set({
        label,
        channel: "slack",
        webhookUrl: notification.webhookUrl.trim(),
        chatId: null,
        botToken: null,
        botUrl: null,
        chatUsername: null,
        chatDisplayName: null,
      })
      .where(eq(notifications.id, notification.id))
      .run();
  } else {
    db.update(notifications)
      .set({
        label,
        channel: "telegram",
        webhookUrl: null,
        chatId: notification.chatId.trim(),
        botToken: notification.botToken.trim(),
        botUrl: buildTelegramBotUrl(notification.botToken.trim()),
        chatUsername: notification.chatUsername?.trim() || null,
        chatDisplayName: notification.chatDisplayName?.trim() || null,
      })
      .where(eq(notifications.id, notification.id))
      .run();
  }

  return loadSnapshot(paths);
}

export async function updateCompletionCheck(input: {
  id: string;
  label?: string;
  commands: string[];
}) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const existingCompletionChecks = readSnapshotFromDatabase().completionChecks;
  const currentCheck = existingCompletionChecks.find(
    (completionCheck) => completionCheck.id === input.id,
  );
  if (!currentCheck) {
    return loadSnapshot(paths);
  }

  const commands = normalizeCompletionCheckCommands(input.commands);
  if (commands.length === 0) {
    throw new Error("At least one command is required.");
  }

  db.update(completionChecks)
    .set({
      label: getUniqueCompletionCheckLabel(
        existingCompletionChecks,
        input.label?.trim() || currentCheck.label,
        input.id,
      ),
      commandsJson: stringifyCompletionCheckCommands(commands),
    })
    .where(eq(completionChecks.id, input.id))
    .run();

  return loadSnapshot(paths);
}

export async function deleteLoopNotification(notificationId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    tx.delete(notifications).where(eq(notifications.id, notificationId)).run();
    tx.update(settings)
      .set({ globalNotificationId: null })
      .where(eq(settings.globalNotificationId, notificationId))
      .run();
  });

  return loadSnapshot(paths);
}

export async function deleteCompletionCheck(completionCheckId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    tx.delete(completionChecks).where(eq(completionChecks.id, completionCheckId)).run();
    tx.update(settings)
      .set({ globalCompletionCheckId: null, globalCompletionCheckWaitForReply: false })
      .where(eq(settings.globalCompletionCheckId, completionCheckId))
      .run();
    tx.update(sessions)
      .set({ completionCheckId: null, completionCheckWaitForReply: false })
      .where(eq(sessions.completionCheckId, completionCheckId))
      .run();
  });

  return loadSnapshot(paths);
}

export async function setSessionNotifications(sessionId: string, notificationIds: string[]) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const validNotificationIds = new Set(
    db
      .select({ id: notifications.id })
      .from(notifications)
      .all()
      .map((row) => row.id),
  );
  const dedupedNotificationIds = [...new Set(notificationIds)].filter((id) =>
    validNotificationIds.has(id),
  );
  const nextSessionRef = allocateNextSessionRef(client);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .get();
    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    tx.delete(sessionNotifications).where(eq(sessionNotifications.sessionId, sessionId)).run();

    if (existingSession?.archived) {
      return;
    }

    if (dedupedNotificationIds.length > 0) {
      tx.insert(sessionNotifications)
        .values(
          dedupedNotificationIds.map((notificationId) => ({
            sessionId,
            notificationId,
          })),
        )
        .run();
    }
  });

  return loadSnapshot(paths);
}

export async function setLoopScope(scope: LoopScope) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    tx.update(settings).set({ scope }).where(eq(settings.id, 1)).run();
    tx.delete(sessionRuntime).run();
  });

  return loadSnapshot(paths);
}

export async function setGlobalPreset(preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    if (preset !== null) {
      optOutExistingInactiveSessionsFromGlobalPreset(tx);
    }

    tx.update(settings).set({ globalPreset: preset }).where(eq(settings.id, 1)).run();
    if (preset === null) {
      tx.run(
        `update sessions
         set active_since = null
         where archived = 0
           and preset_overridden = 0`,
      );
    }
    tx.delete(sessionRuntime).run();
    if (preset !== "await-reply") {
      tx.run(
        `delete from session_awaiting_replies
         where session_id in (
           select session_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
    }
    if (preset === null) {
      tx.run(
        `delete from session_remote_prompts
         where session_id in (
           select session_id
           from sessions
           where preset is null
             and preset_overridden = 0
             and archived = 0
         )`,
      );
      return;
    }
    if (!isPersistentPromptPreset(preset)) {
      tx.run(
        `delete from session_remote_prompts
         where delivery_mode = 'persistent'
           and session_id in (
             select session_id
             from sessions
             where preset is null
               and preset_overridden = 0
               and archived = 0
           )`,
      );
    }
  });

  return loadSnapshot(paths);
}

export async function setGlobalNotification(notificationId: string | null) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const nextNotificationId = normalizeGlobalNotificationId(
    db
      .select({ id: notifications.id })
      .from(notifications)
      .all()
      .map((row) => row.id),
    notificationId,
  );

  db.update(settings)
    .set({ globalNotificationId: nextNotificationId })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function setGlobalCompletionCheckConfig(
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const nextCompletionCheckId = normalizeGlobalCompletionCheckId(
    db
      .select({ id: completionChecks.id })
      .from(completionChecks)
      .all()
      .map((row) => row.id),
    completionCheckId,
  );

  db.update(settings)
    .set({
      globalCompletionCheckId: nextCompletionCheckId,
      globalCompletionCheckWaitForReply:
        nextCompletionCheckId === null ? false : waitForReplyAfterCompletion,
    })
    .where(eq(settings.id, 1))
    .run();

  return loadSnapshot(paths);
}

export async function setSessionCompletionCheckConfig(
  sessionId: string,
  completionCheckId: string | null,
  waitForReplyAfterCompletion: boolean,
) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const nextSessionRef = allocateNextSessionRef(client);
  const nextCompletionCheckId = normalizeGlobalCompletionCheckId(
    db
      .select({ id: completionChecks.id })
      .from(completionChecks)
      .all()
      .map((row) => row.id),
    completionCheckId,
  );

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .get();

    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    tx.update(sessions)
      .set({
        completionCheckId: nextCompletionCheckId,
        completionCheckWaitForReply:
          nextCompletionCheckId === null ? false : waitForReplyAfterCompletion,
      })
      .where(eq(sessions.sessionId, sessionId))
      .run();

    if (nextCompletionCheckId !== null) {
      return;
    }

    tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.sessionId, sessionId)).run();
  });

  return loadSnapshot(paths);
}

export async function setSessionPreset(sessionId: string, preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();
  const { client, db } = getLoopndrollDatabase(paths.databasePath);
  const nextSessionRef = allocateNextSessionRef(client);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .get();

    if (!existingSession) {
      tx.insert(sessions).values(buildNewSession(sessionId, nextSessionRef)).run();
      applyGlobalNotificationToSession(tx, sessionId, getStoredGlobalNotificationId(tx));
    }

    if (existingSession?.archived) {
      tx.update(sessions)
        .set({
          preset: null,
          presetOverridden: false,
          activeSince: null,
          completionCheckId: null,
          completionCheckWaitForReply: false,
        })
        .where(eq(sessions.sessionId, sessionId))
        .run();
      tx.delete(sessionRuntime).where(eq(sessionRuntime.sessionId, sessionId)).run();
      tx.delete(sessionAwaitingReplies)
        .where(eq(sessionAwaitingReplies.sessionId, sessionId))
        .run();
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.sessionId, sessionId)).run();
      return;
    }

    const previousPreset = resolveSessionPresetState(
      existingSession?.preset,
      existingSession?.presetOverridden,
      null,
    ).effectivePreset;
    const nextActiveSince =
      previousPreset === null && preset !== null
        ? nowIsoString()
        : previousPreset !== null && preset === null
          ? null
          : (existingSession?.activeSince ?? null);
    const isRestartingFromOff = previousPreset === null && preset !== null;

    tx.update(sessions)
      .set({
        preset,
        presetOverridden: true,
        activeSince: nextActiveSince,
      })
      .where(eq(sessions.sessionId, sessionId))
      .run();
    tx.delete(sessionRuntime).where(eq(sessionRuntime.sessionId, sessionId)).run();
    if (preset !== "await-reply") {
      tx.delete(sessionAwaitingReplies)
        .where(eq(sessionAwaitingReplies.sessionId, sessionId))
        .run();
    }
    if (isRestartingFromOff) {
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.sessionId, sessionId)).run();
      return;
    }
    if (preset === null) {
      tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.sessionId, sessionId)).run();
      return;
    }
    if (!isPersistentPromptPreset(preset)) {
      tx.delete(sessionRemotePrompts)
        .where(
          and(
            eq(sessionRemotePrompts.sessionId, sessionId),
            eq(sessionRemotePrompts.deliveryMode, "persistent"),
          ),
        )
        .run();
    }
  });

  return loadSnapshot(paths);
}

export async function setSessionArchived(sessionId: string, archived: boolean) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.transaction((tx) => {
    const existingSession = tx
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .get();

    if (!existingSession) {
      return;
    }

    tx.update(sessions)
      .set({
        archived,
        preset: archived ? null : existingSession.preset,
        presetOverridden: archived ? false : existingSession.presetOverridden,
        activeSince: archived ? null : existingSession.activeSince,
        completionCheckId: archived ? null : existingSession.completionCheckId,
        completionCheckWaitForReply: archived ? false : existingSession.completionCheckWaitForReply,
      })
      .where(eq(sessions.sessionId, sessionId))
      .run();

    if (!archived) {
      return;
    }

    tx.delete(sessionNotifications).where(eq(sessionNotifications.sessionId, sessionId)).run();
    tx.delete(sessionRuntime).where(eq(sessionRuntime.sessionId, sessionId)).run();
    tx.delete(sessionAwaitingReplies).where(eq(sessionAwaitingReplies.sessionId, sessionId)).run();
    tx.delete(sessionRemotePrompts).where(eq(sessionRemotePrompts.sessionId, sessionId)).run();
  });

  return loadSnapshot(paths);
}

export async function deleteSession(sessionId: string) {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  db.delete(sessions).where(eq(sessions.sessionId, sessionId)).run();

  return loadSnapshot(paths);
}

export async function registerHooks() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);

  await ensureRegistered(paths);
  db.update(settings).set({ hooksAutoRegistration: true }).where(eq(settings.id, 1)).run();

  return loadSnapshot(paths);
}

export async function clearHooks() {
  const paths = getLoopndrollPaths();
  const { db } = getLoopndrollDatabase(paths.databasePath);
  const hooksDocument = await loadHooksDocument(paths);

  removeManagedHooks(hooksDocument);
  await writeFile(paths.codexHooksPath, `${JSON.stringify(hooksDocument, null, 2)}\n`, "utf8");
  db.update(settings).set({ hooksAutoRegistration: false }).where(eq(settings.id, 1)).run();

  await appendHookDebugLog(paths, {
    type: "setup",
    action: "clear-hooks",
    hooksFilePath: paths.codexHooksPath,
  });

  return loadSnapshot(paths);
}

export async function revealHooksFile() {
  const paths = getLoopndrollPaths();
  await ensureDirectory(paths.codexDirectoryPath);

  const child = spawn("open", ["-R", paths.codexHooksPath], {
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  return {
    revealed: true,
    path: paths.codexHooksPath,
  };
}
