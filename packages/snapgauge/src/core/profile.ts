/**
 * Client profiles (SPEC §5 D-group): a profile is (protocolVersion,
 * clientCapabilities, extensions, header behavior). M1 ships `modern-full`
 * only — the walking skeleton records and diffs under one profile. The other
 * eight built-ins (modern-minimal, no-elicitation, …, legacy-2025-11-25)
 * land with the compat engine at M4 (SPEC §10).
 */
import type { JsonObject } from "./json.js";

export interface Profile {
  name: string;
  protocolVersion: string;
  clientCapabilities: JsonObject;
}

export const MODERN_FULL: Profile = {
  name: "modern-full",
  protocolVersion: "2026-07-28",
  clientCapabilities: { elicitation: {}, sampling: {}, roots: {} },
};

const BUILTIN_PROFILES: Readonly<Record<string, Profile>> = {
  "modern-full": MODERN_FULL,
};

export function getProfile(name: string): Profile | undefined {
  return Object.hasOwn(BUILTIN_PROFILES, name) ? BUILTIN_PROFILES[name] : undefined;
}

export function profileNames(): string[] {
  return Object.keys(BUILTIN_PROFILES).sort();
}
