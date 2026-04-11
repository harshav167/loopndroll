import type { LoopPreset, LoopScope } from "../shared/app-rpc";
import { getAppRpc } from "./app-rpc";

export type { LoopPreset, LoopScope, LoopndrollSnapshot, LoopSession } from "../shared/app-rpc";

export async function ensureLoopndrollSetup() {
  const rpc = await getAppRpc();
  return rpc?.request.ensureLoopndrollSetup();
}

export async function getLoopndrollState() {
  const rpc = await getAppRpc();
  return rpc?.request.getLoopndrollState();
}

export async function saveDefaultPrompt(defaultPrompt: string) {
  const rpc = await getAppRpc();
  return rpc?.request.saveDefaultPrompt({ defaultPrompt });
}

export async function setLoopScope(scope: LoopScope) {
  const rpc = await getAppRpc();
  return rpc?.request.setLoopScope({ scope });
}

export async function setGlobalPreset(preset: LoopPreset | null) {
  const rpc = await getAppRpc();
  return rpc?.request.setGlobalPreset({ preset });
}

export async function setSessionPreset(sessionId: string, preset: LoopPreset | null) {
  const rpc = await getAppRpc();
  return rpc?.request.setSessionPreset({ sessionId, preset });
}

export async function deleteSession(sessionId: string) {
  const rpc = await getAppRpc();
  return rpc?.request.deleteSession({ sessionId });
}

export async function registerHooks() {
  const rpc = await getAppRpc();
  return rpc?.request.registerHooks();
}

export async function clearHooks() {
  const rpc = await getAppRpc();
  return rpc?.request.clearHooks();
}

export async function revealHooksFile() {
  const rpc = await getAppRpc();
  return rpc?.request.revealHooksFile();
}
