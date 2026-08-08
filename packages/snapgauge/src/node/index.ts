/**
 * "snapgauge/node" — the node-side transports + config schema, exported as a
 * separate subpath (SPEC §3 boundary) so a Node-runtime consumer OTHER than
 * the CLI — apps/web's `/api/check` (SPEC §4) — can build a transport and
 * authorize a target without pulling in `commander` or `process.exit`
 * (those stay behind "snapgauge/bin").
 */
export {
  authorizeTarget,
  classifyAddress,
  type AddressPolicy,
  type AuthorizedTarget,
  type BlockReason,
  type LookupFn,
  type ResolvedAddress,
} from "./address-policy.js";
export {
  createHttpTransport,
  type HttpTransport,
  type HttpTransportOptions,
} from "./http-transport.js";
export { ConfigSchema, type SnapgaugeConfig, type TargetConfig } from "./config.js";
