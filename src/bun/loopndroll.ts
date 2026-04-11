import { spawn } from "node:child_process";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LoopPreset, LoopScope, LoopSession, LoopndrollSnapshot } from "../shared/app-rpc";

type StoredSession = LoopSession;

type StoredState = {
  version: 1;
  settings: {
    defaultPrompt: string;
    scope: LoopScope;
    globalPreset: LoopPreset | null;
    hooksAutoRegistration: boolean;
  };
  sessions: Record<string, StoredSession>;
  runtime: {
    remainingTurnsBySession: Record<string, number>;
  };
  updatedAt: string;
};

type LegacyState = {
  config?: {
    enabled?: boolean;
    maxTurns?: number;
    mode?: string;
    promptTemplate?: string;
  };
  runtime?: {
    perSessionRemainingTurns?: Record<string, number>;
    sessions?: Record<string, Partial<StoredSession>>;
  };
};

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
  statePath: string;
  lockDirectoryPath: string;
  managedHookPath: string;
  hookDebugLogPath: string;
  codexDirectoryPath: string;
  codexConfigPath: string;
  codexHooksPath: string;
};

const APP_SUPPORT_DIRECTORY_NAME = "loopndroll";
const MANAGED_HOOK_MARKER = "--managed-by loopndroll";
const MANAGED_HOOK_SCRIPT_MARKER = "managed-by loopndroll";
const DEFAULT_PROMPT = "Keep working on the task. Do not finish yet.";
const STOP_STATUS_MESSAGE = "Loopndroll is deciding whether Codex should continue";
const SESSION_STATUS_MESSAGE = "Loopndroll is registering the Codex chat";
const PROMPT_STATUS_MESSAGE = "Loopndroll is capturing the chat prompt";
const LOCK_STALE_MS = 15_000;

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
    statePath: join(appDirectoryPath, "state.json"),
    lockDirectoryPath: join(appDirectoryPath, "state.lockdir"),
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

function shouldEnableHookDebugLogging() {
  return process.env.NODE_ENV !== "production" || import.meta.path.includes("/src/bun/");
}

async function appendHookDebugLog(paths: LoopndrollPaths, entry: Record<string, unknown>) {
  if (!shouldEnableHookDebugLogging()) {
    return;
  }

  await ensureDirectory(paths.logsDirectoryPath);
  await appendFile(
    paths.hookDebugLogPath,
    `${JSON.stringify({ timestamp: nowIsoString(), ...entry })}\n`,
    "utf8",
  );
}

function defaultState(): StoredState {
  return {
    version: 1,
    settings: {
      defaultPrompt: DEFAULT_PROMPT,
      scope: "global",
      globalPreset: null,
      hooksAutoRegistration: true,
    },
    sessions: {},
    runtime: {
      remainingTurnsBySession: {},
    },
    updatedAt: nowIsoString(),
  };
}

function normalizeLoopPreset(value: unknown): LoopPreset | null {
  if (
    value === "infinite" ||
    value === "max-turns-1" ||
    value === "max-turns-2" ||
    value === "max-turns-3"
  ) {
    return value;
  }

  return null;
}

function normalizeScope(value: unknown): LoopScope {
  return value === "per-task" ? "per-task" : "global";
}

function clampMaxTurns(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }

  if (typeof value === "number") {
    if (value <= 1) {
      return 1;
    }

    if (value >= 3) {
      return 3;
    }

    return 2;
  }

  return 3;
}

function normalizeSession(
  sessionId: string,
  raw: Partial<StoredSession> | undefined,
): StoredSession {
  const fallbackTime = nowIsoString();
  const rawFirstSeenAt = typeof raw?.firstSeenAt === "string" ? raw.firstSeenAt : fallbackTime;
  const rawLastSeenAt = typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : rawFirstSeenAt;
  const stopCount = typeof raw?.stopCount === "number" && raw.stopCount >= 0 ? raw.stopCount : 0;

  return {
    sessionId,
    source:
      raw?.source === "resume" || raw?.source === "stop" || raw?.source === "startup"
        ? raw.source
        : "startup",
    firstSeenAt: rawFirstSeenAt,
    lastSeenAt: rawLastSeenAt,
    stopCount,
    preset: normalizeLoopPreset(raw?.preset),
    title: typeof raw?.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : null,
    transcriptPath:
      typeof raw?.transcriptPath === "string" && raw.transcriptPath.length > 0
        ? raw.transcriptPath
        : null,
    lastAssistantMessage:
      typeof raw?.lastAssistantMessage === "string" ? raw.lastAssistantMessage : null,
  };
}

function isPromptOnlyArtifact(session: StoredSession) {
  if (session.transcriptPath !== null) {
    return false;
  }

  const titleLooksInternal = session.title?.startsWith("You are a helpful assistant.") ?? false;
  const assistantPayloadLooksInternal =
    session.lastAssistantMessage?.startsWith('{"title":') ?? false;

  return titleLooksInternal || assistantPayloadLooksInternal;
}

function migrateLegacyState(rawState: LegacyState): StoredState {
  const migrated = defaultState();
  const promptTemplate =
    typeof rawState.config?.promptTemplate === "string" &&
    rawState.config.promptTemplate.trim().length > 0
      ? rawState.config.promptTemplate.trim()
      : DEFAULT_PROMPT;
  const enabled = rawState.config?.enabled === true;
  const legacyMode = rawState.config?.mode;
  const globalPreset = enabled
    ? legacyMode === "indefinite"
      ? "infinite"
      : (`max-turns-${clampMaxTurns(rawState.config?.maxTurns)}` as LoopPreset)
    : null;

  migrated.settings.defaultPrompt = promptTemplate;
  migrated.settings.globalPreset = globalPreset;
  migrated.runtime.remainingTurnsBySession = Object.fromEntries(
    Object.entries(rawState.runtime?.perSessionRemainingTurns ?? {}).filter(
      ([, value]) => typeof value === "number" && value >= 0,
    ),
  );

  for (const [sessionId, session] of Object.entries(rawState.runtime?.sessions ?? {})) {
    const normalizedSession = normalizeSession(sessionId, session);
    if (!isPromptOnlyArtifact(normalizedSession)) {
      migrated.sessions[sessionId] = normalizedSession;
    }
  }

  return migrated;
}

function normalizeStoredState(rawState: unknown): StoredState {
  if (!rawState || typeof rawState !== "object") {
    return defaultState();
  }

  if ("version" in rawState && rawState.version === 1) {
    const candidate = rawState as Partial<StoredState>;
    const state = defaultState();

    state.settings.defaultPrompt =
      typeof candidate.settings?.defaultPrompt === "string" &&
      candidate.settings.defaultPrompt.trim().length > 0
        ? candidate.settings.defaultPrompt.trim()
        : DEFAULT_PROMPT;
    state.settings.scope = normalizeScope(candidate.settings?.scope);
    state.settings.globalPreset = normalizeLoopPreset(candidate.settings?.globalPreset);
    state.settings.hooksAutoRegistration = candidate.settings?.hooksAutoRegistration !== false;
    state.runtime.remainingTurnsBySession = Object.fromEntries(
      Object.entries(candidate.runtime?.remainingTurnsBySession ?? {}).filter(
        ([, value]) => typeof value === "number" && value >= 0,
      ),
    );
    state.updatedAt =
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIsoString();

    for (const [sessionId, session] of Object.entries(candidate.sessions ?? {})) {
      const normalizedSession = normalizeSession(sessionId, session);
      if (!isPromptOnlyArtifact(normalizedSession)) {
        state.sessions[sessionId] = normalizedSession;
      }
    }

    return state;
  }

  return migrateLegacyState(rawState as LegacyState);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}

async function isStaleLock(lockDirectoryPath: string) {
  try {
    const lockStat = await stat(lockDirectoryPath);
    return Date.now() - lockStat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function withStateLock<T>(paths: LoopndrollPaths, callback: () => Promise<T>) {
  await ensureDirectory(paths.appDirectoryPath);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await mkdir(paths.lockDirectoryPath);
      break;
    } catch (error) {
      if (await isStaleLock(paths.lockDirectoryPath)) {
        await rm(paths.lockDirectoryPath, { recursive: true, force: true });
        continue;
      }

      if (attempt === 39) {
        throw error;
      }

      await sleep(50);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(paths.lockDirectoryPath, { recursive: true, force: true });
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDirectory(dirname(filePath));
  const temporaryFilePath = `${filePath}.tmp`;
  await writeFile(temporaryFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryFilePath, filePath);
}

async function loadState(paths: LoopndrollPaths) {
  const rawState = await readJsonFile<StoredState | LegacyState>(paths.statePath);
  if (!rawState) {
    return { state: defaultState(), existed: false };
  }

  return { state: normalizeStoredState(rawState), existed: true };
}

async function saveState(paths: LoopndrollPaths, state: StoredState) {
  state.updatedAt = nowIsoString();
  await writeJsonFile(paths.statePath, state);
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
          timeout: 30,
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

async function loadHooksDocument(paths: LoopndrollPaths) {
  try {
    return (await readJsonFile<HooksDocument>(paths.codexHooksPath)) ?? { hooks: {} };
  } catch {
    const backupPath = `${paths.codexHooksPath}.corrupt.${Date.now()}`;
    try {
      await copyFile(paths.codexHooksPath, backupPath);
    } catch {
      // If the corrupt file cannot be copied, registration will still continue with a clean file.
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

function buildManagedHookScript(paths: LoopndrollPaths) {
  return `#!/usr/bin/env bun
// ${MANAGED_HOOK_SCRIPT_MARKER}
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const statePath = ${JSON.stringify(paths.statePath)};
const lockDirectoryPath = ${JSON.stringify(paths.lockDirectoryPath)};
const logsDirectoryPath = ${JSON.stringify(paths.logsDirectoryPath)};
const hookDebugLogPath = ${JSON.stringify(paths.hookDebugLogPath)};
const defaultPrompt = ${JSON.stringify(DEFAULT_PROMPT)};
const lockStaleMs = ${String(LOCK_STALE_MS)};
const hookDebugLoggingEnabled = ${JSON.stringify(shouldEnableHookDebugLogging())};

function nowIsoString() {
  return new Date().toISOString();
}

async function appendHookDebugLog(entry) {
  if (!hookDebugLoggingEnabled) {
    return;
  }

  await ensureDirectory(logsDirectoryPath);
  await appendFile(
    hookDebugLogPath,
    \`\${JSON.stringify({ timestamp: nowIsoString(), ...entry })}\\n\`,
    "utf8",
  );
}

function defaultState() {
  return {
    version: 1,
    settings: {
      defaultPrompt,
      scope: "global",
      globalPreset: null,
      hooksAutoRegistration: true,
    },
    sessions: {},
    runtime: {
      remainingTurnsBySession: {},
    },
    updatedAt: nowIsoString(),
  };
}

function normalizeLoopPreset(value) {
  return value === "infinite" ||
    value === "max-turns-1" ||
    value === "max-turns-2" ||
    value === "max-turns-3"
    ? value
    : null;
}

function normalizeScope(value) {
  return value === "per-task" ? "per-task" : "global";
}

function clampMaxTurns(value) {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }

  if (typeof value === "number") {
    if (value <= 1) {
      return 1;
    }

    if (value >= 3) {
      return 3;
    }

    return 2;
  }

  return 3;
}

function normalizeSession(sessionId, raw) {
  const fallbackTime = nowIsoString();
  const firstSeenAt = typeof raw?.firstSeenAt === "string" ? raw.firstSeenAt : fallbackTime;
  const lastSeenAt = typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : firstSeenAt;

  return {
    sessionId,
    source:
      raw?.source === "resume" || raw?.source === "stop" || raw?.source === "startup"
        ? raw.source
        : "startup",
    firstSeenAt,
    lastSeenAt,
    stopCount: typeof raw?.stopCount === "number" && raw.stopCount >= 0 ? raw.stopCount : 0,
    preset: normalizeLoopPreset(raw?.preset),
    title: typeof raw?.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : null,
    transcriptPath:
      typeof raw?.transcriptPath === "string" && raw.transcriptPath.length > 0
        ? raw.transcriptPath
        : null,
    lastAssistantMessage: typeof raw?.lastAssistantMessage === "string" ? raw.lastAssistantMessage : null,
  };
}

function isPromptOnlyArtifact(session) {
  if (session.transcriptPath !== null) {
    return false;
  }

  const titleLooksInternal = session.title?.startsWith("You are a helpful assistant.") ?? false;
  const assistantPayloadLooksInternal = session.lastAssistantMessage?.startsWith("{\\"title\\":") ?? false;

  return titleLooksInternal || assistantPayloadLooksInternal;
}

function deriveSessionTitle(prompt) {
  const normalizedPrompt = String(prompt ?? "").replace(/\\s+/g, " ").trim();
  if (normalizedPrompt.length === 0) {
    return null;
  }

  return normalizedPrompt.slice(0, 80);
}

function migrateLegacyState(rawState) {
  const state = defaultState();
  const promptTemplate =
    typeof rawState?.config?.promptTemplate === "string" && rawState.config.promptTemplate.trim().length > 0
      ? rawState.config.promptTemplate.trim()
      : defaultPrompt;
  const enabled = rawState?.config?.enabled === true;
  const legacyMode = rawState?.config?.mode;

  state.settings.defaultPrompt = promptTemplate;
  state.settings.globalPreset = enabled
    ? legacyMode === "indefinite"
      ? "infinite"
      : \`max-turns-\${clampMaxTurns(rawState?.config?.maxTurns)}\`
    : null;
  state.runtime.remainingTurnsBySession = Object.fromEntries(
    Object.entries(rawState?.runtime?.perSessionRemainingTurns ?? {}).filter(
      ([, value]) => typeof value === "number" && value >= 0,
    ),
  );

  for (const [sessionId, session] of Object.entries(rawState?.runtime?.sessions ?? {})) {
    const normalizedSession = normalizeSession(sessionId, session);
    if (!isPromptOnlyArtifact(normalizedSession)) {
      state.sessions[sessionId] = normalizedSession;
    }
  }

  return state;
}

function normalizeState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return defaultState();
  }

  if (rawState.version === 1) {
    const state = defaultState();
    state.settings.defaultPrompt =
      typeof rawState.settings?.defaultPrompt === "string" && rawState.settings.defaultPrompt.trim().length > 0
        ? rawState.settings.defaultPrompt.trim()
        : defaultPrompt;
    state.settings.scope = normalizeScope(rawState.settings?.scope);
    state.settings.globalPreset = normalizeLoopPreset(rawState.settings?.globalPreset);
    state.settings.hooksAutoRegistration = rawState.settings?.hooksAutoRegistration !== false;
    state.runtime.remainingTurnsBySession = Object.fromEntries(
      Object.entries(rawState.runtime?.remainingTurnsBySession ?? {}).filter(
        ([, value]) => typeof value === "number" && value >= 0,
      ),
    );
    state.updatedAt = typeof rawState.updatedAt === "string" ? rawState.updatedAt : nowIsoString();

    for (const [sessionId, session] of Object.entries(rawState.sessions ?? {})) {
      const normalizedSession = normalizeSession(sessionId, session);
      if (!isPromptOnlyArtifact(normalizedSession)) {
        state.sessions[sessionId] = normalizedSession;
      }
    }

    return state;
  }

  return migrateLegacyState(rawState);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

async function isStaleLock() {
  try {
    const lockStat = await stat(lockDirectoryPath);
    return Date.now() - lockStat.mtimeMs > lockStaleMs;
  } catch {
    return false;
  }
}

async function withStateLock(callback) {
  await ensureDirectory(dirname(statePath));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await mkdir(lockDirectoryPath);
      break;
    } catch (error) {
      if (await isStaleLock()) {
        await rm(lockDirectoryPath, { recursive: true, force: true });
        continue;
      }

      if (attempt === 39) {
        throw error;
      }

      await sleep(50);
    }
  }

  try {
    return await callback();
  } finally {
    await rm(lockDirectoryPath, { recursive: true, force: true });
  }
}

async function readState() {
  try {
    const raw = await readFile(statePath, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultState();
    }
    throw error;
  }
}

async function saveState(state) {
  state.updatedAt = nowIsoString();
  const next = \`\${JSON.stringify(state, null, 2)}\\n\`;
  const temporaryPath = \`\${statePath}.tmp\`;
  await writeFile(temporaryPath, next, "utf8");
  await rename(temporaryPath, statePath);
}

function upsertSession(state, input, source) {
  const existing = state.sessions[input.session_id];
  const next = normalizeSession(input.session_id, existing);

  next.source = source;
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
  state.sessions[input.session_id] = next;

  return next;
}

function getEffectivePreset(state, sessionId) {
  if (state.settings.scope === "global") {
    return state.settings.globalPreset;
  }

  return state.sessions[sessionId]?.preset ?? null;
}

function renderPrompt(template, remainingTurns) {
  return template.replaceAll("{{remaining_turns}}", remainingTurns === null ? "" : String(remainingTurns)).trim();
}

function getMaxTurns(preset) {
  if (preset === "max-turns-1") return 1;
  if (preset === "max-turns-2") return 2;
  if (preset === "max-turns-3") return 3;
  return null;
}

function applyStopDecision(state, sessionId, preset) {
  if (!preset) {
    delete state.runtime.remainingTurnsBySession[sessionId];
    return null;
  }

  if (preset === "infinite") {
    return {
      decision: "block",
      reason: renderPrompt(state.settings.defaultPrompt, null),
      remainingTurnsBefore: null,
      remainingTurnsAfter: null,
    };
  }

  const maxTurns = getMaxTurns(preset);
  if (maxTurns === null) {
    delete state.runtime.remainingTurnsBySession[sessionId];
    return null;
  }

  const remainingTurns = state.runtime.remainingTurnsBySession[sessionId] ?? maxTurns;
  if (remainingTurns <= 0) {
    return null;
  }

  state.runtime.remainingTurnsBySession[sessionId] = remainingTurns - 1;
  return {
    decision: "block",
    reason: renderPrompt(state.settings.defaultPrompt, remainingTurns - 1),
    remainingTurnsBefore: remainingTurns,
    remainingTurnsAfter: remainingTurns - 1,
  };
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

  const output = await withStateLock(async () => {
    const state = await readState();
    const sessionCountBefore = Object.keys(state.sessions).length;

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
      return null;
    }

    if (hookEventName === "SessionStart") {
      const session = upsertSession(state, input, input.source === "resume" ? "resume" : "startup");
      await saveState(state);
      await appendHookDebugLog({
        type: "hook-event",
        hookEventName,
        action: "upsert-session",
        sessionId: input.session_id,
        payload: input,
        sessionCountBefore,
        sessionCountAfter: Object.keys(state.sessions).length,
        storedSession: session,
      });
      return null;
    }

    if (hookEventName === "UserPromptSubmit") {
      if (!state.sessions[input.session_id]) {
        await appendHookDebugLog({
          type: "hook-event",
          hookEventName,
          action: "ignored",
          reason: "prompt-before-session-start",
          sessionId: input.session_id,
          payload: input,
          sessionCountBefore,
          sessionCountAfter: sessionCountBefore,
        });
        return null;
      }

      const session = upsertSession(state, input, state.sessions[input.session_id]?.source ?? "startup");
      await saveState(state);
      await appendHookDebugLog({
        type: "hook-event",
        hookEventName,
        action: "update-session-title",
        sessionId: input.session_id,
        payload: input,
        sessionCountBefore,
        sessionCountAfter: Object.keys(state.sessions).length,
        storedSession: session,
      });
      return null;
    }

    if (!state.sessions[input.session_id]) {
      if (state.settings.scope === "global") {
        const preset = state.settings.globalPreset;
        const stopDecision = applyStopDecision(state, input.session_id, preset);
        await saveState(state);
        await appendHookDebugLog({
          type: "hook-event",
          hookEventName,
          action: stopDecision ? "block-stop" : "allow-stop",
          reason: stopDecision ? "global-untracked-session" : "no-global-preset",
          sessionId: input.session_id,
          payload: input,
          sessionCountBefore,
          sessionCountAfter: sessionCountBefore,
          preset,
          remainingTurnsBefore: stopDecision?.remainingTurnsBefore ?? null,
          remainingTurnsAfter: stopDecision?.remainingTurnsAfter ?? null,
        });
        return stopDecision
          ? {
              decision: stopDecision.decision,
              reason: stopDecision.reason,
            }
          : null;
      }

      await appendHookDebugLog({
        type: "hook-event",
        hookEventName,
        action: "ignored",
        reason: "stop-before-session-start",
        sessionId: input.session_id,
        payload: input,
        sessionCountBefore,
        sessionCountAfter: sessionCountBefore,
      });
      return null;
    }

    const session = upsertSession(state, input, "stop");
    session.stopCount += 1;

    const preset = getEffectivePreset(state, input.session_id);
    const stopDecision = applyStopDecision(state, input.session_id, preset);
    await saveState(state);
    await appendHookDebugLog({
      type: "hook-event",
      hookEventName,
      action: stopDecision ? "block-stop" : "allow-stop",
      sessionId: input.session_id,
      payload: input,
      sessionCountBefore,
      sessionCountAfter: Object.keys(state.sessions).length,
      storedSession: session,
      preset,
      remainingTurnsBefore: stopDecision?.remainingTurnsBefore ?? null,
      remainingTurnsAfter: stopDecision?.remainingTurnsAfter ?? null,
    });
    return stopDecision
      ? {
          decision: stopDecision.decision,
          reason: stopDecision.reason,
        }
      : null;
  });

  if (output) {
    process.stdout.write(\`\${JSON.stringify(output)}\\n\`);
  }
}

await main();
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

function toSnapshot(
  state: StoredState,
  health: Awaited<ReturnType<typeof computeHealth>>,
): LoopndrollSnapshot {
  return {
    defaultPrompt: state.settings.defaultPrompt,
    scope: state.settings.scope,
    globalPreset: state.settings.globalPreset,
    hooksAutoRegistration: state.settings.hooksAutoRegistration,
    health,
    sessions: Object.values(state.sessions).sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt),
    ),
  };
}

async function ensureRegisteredLocked(paths: LoopndrollPaths, state: StoredState) {
  await ensureDirectory(paths.codexDirectoryPath);
  await ensureManagedHookScript(paths);
  await ensureCodexConfig(paths);

  const hooksDocument = await loadHooksDocument(paths);
  upsertManagedHooks(paths, hooksDocument);
  await writeJsonFile(paths.codexHooksPath, hooksDocument);

  state.settings.hooksAutoRegistration = true;
  await appendHookDebugLog(paths, {
    type: "setup",
    action: "register-hooks",
    managedHookPath: paths.managedHookPath,
    hooksFilePath: paths.codexHooksPath,
  });
}

async function loadSnapshot(paths: LoopndrollPaths) {
  const { state } = await loadState(paths);
  const health = await computeHealth(paths);
  return toSnapshot(state, health);
}

export async function ensureLoopndrollSetup() {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state, existed } = await loadState(paths);

    if (!existed) {
      await saveState(paths, state);
    }

    if (state.settings.hooksAutoRegistration) {
      await ensureRegisteredLocked(paths, state);
      await saveState(paths, state);
    }

    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function getLoopndrollSnapshot() {
  const paths = getLoopndrollPaths();
  return loadSnapshot(paths);
}

export async function saveDefaultPrompt(defaultPrompt: string) {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    state.settings.defaultPrompt = defaultPrompt.trim() || DEFAULT_PROMPT;
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function setLoopScope(scope: LoopScope) {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    state.settings.scope = scope;
    state.runtime.remainingTurnsBySession = {};
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function setGlobalPreset(preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    state.settings.globalPreset = preset;
    state.runtime.remainingTurnsBySession = {};
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function setSessionPreset(sessionId: string, preset: LoopPreset | null) {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    const existingSession = state.sessions[sessionId];
    state.sessions[sessionId] = normalizeSession(sessionId, existingSession);
    state.sessions[sessionId].preset = preset;
    state.sessions[sessionId].lastSeenAt = nowIsoString();
    delete state.runtime.remainingTurnsBySession[sessionId];
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function deleteSession(sessionId: string) {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    delete state.sessions[sessionId];
    delete state.runtime.remainingTurnsBySession[sessionId];
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function registerHooks() {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    await ensureRegisteredLocked(paths, state);
    await saveState(paths, state);
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
}

export async function clearHooks() {
  const paths = getLoopndrollPaths();

  return withStateLock(paths, async () => {
    const { state } = await loadState(paths);
    const hooksDocument = await loadHooksDocument(paths);
    removeManagedHooks(hooksDocument);
    await writeJsonFile(paths.codexHooksPath, hooksDocument);
    state.settings.hooksAutoRegistration = false;
    await saveState(paths, state);
    await appendHookDebugLog(paths, {
      type: "setup",
      action: "clear-hooks",
      hooksFilePath: paths.codexHooksPath,
    });
    const health = await computeHealth(paths);
    return toSnapshot(state, health);
  });
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
