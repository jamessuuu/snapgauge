/**
 * Client profiles (SPEC §5 D-group): a profile is (protocolVersion,
 * clientCapabilities, extensions, header behavior). The nine built-ins are
 * the compat engine's matrix axis; `modern-minimal` (zero capabilities, no
 * extensions) is the critical one — a server that degrades must do so
 * correctly against it.
 */
import type { JsonObject } from "./json.js";

export interface Profile {
  name: string;
  protocolVersion: string;
  clientCapabilities: JsonObject;
  /** Advertised extensions; absent/[] = none (degrade.extension_leak). */
  extensions?: readonly string[];
  /** false for legacy-headers-absent: no MCP-Protocol-Version header sent. */
  sendProtocolVersionHeader?: boolean;
  /** Legacy profiles open with `initialize`; modern ones with server/discover. */
  handshake?: "discover" | "initialize";
}

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";

const FULL_CAPABILITIES: JsonObject = {
  elicitation: {},
  sampling: {},
  roots: {},
  tasks: {},
  ui: {},
};

function without(capabilities: JsonObject, name: string): JsonObject {
  return Object.fromEntries(Object.entries(capabilities).filter(([key]) => key !== name));
}

export const MODERN_FULL: Profile = {
  name: "modern-full",
  protocolVersion: MODERN_VERSION,
  clientCapabilities: FULL_CAPABILITIES,
  extensions: [],
  sendProtocolVersionHeader: true,
  handshake: "discover",
};

/** The nine built-ins (SPEC §5). Order here is presentation order. */
const BUILTIN_PROFILES: Readonly<Record<string, Profile>> = {
  "modern-full": MODERN_FULL,
  "modern-minimal": {
    name: "modern-minimal",
    protocolVersion: MODERN_VERSION,
    // The critical one: zero capabilities, no extensions (SPEC §5).
    clientCapabilities: {},
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "no-elicitation": {
    name: "no-elicitation",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: without(FULL_CAPABILITIES, "elicitation"),
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "no-sampling": {
    name: "no-sampling",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: without(FULL_CAPABILITIES, "sampling"),
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "no-roots": {
    name: "no-roots",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: without(FULL_CAPABILITIES, "roots"),
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "no-tasks": {
    name: "no-tasks",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: without(FULL_CAPABILITIES, "tasks"),
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "no-ui": {
    name: "no-ui",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: without(FULL_CAPABILITIES, "ui"),
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "discover",
  },
  "legacy-2025-11-25": {
    name: "legacy-2025-11-25",
    protocolVersion: LEGACY_VERSION,
    clientCapabilities: { elicitation: {}, sampling: {}, roots: {} },
    extensions: [],
    sendProtocolVersionHeader: true,
    handshake: "initialize",
  },
  "legacy-headers-absent": {
    name: "legacy-headers-absent",
    protocolVersion: MODERN_VERSION,
    clientCapabilities: FULL_CAPABILITIES,
    extensions: [],
    sendProtocolVersionHeader: false,
    handshake: "discover",
  },
};

export function getProfile(name: string): Profile | undefined {
  return Object.hasOwn(BUILTIN_PROFILES, name) ? BUILTIN_PROFILES[name] : undefined;
}

export function profileNames(): string[] {
  return Object.keys(BUILTIN_PROFILES).sort();
}
