/**
 * Single source of truth for the version string stamped into every snapshot
 * (`snapgaugeVersion`, SPEC §2). A unit test pins it to package.json so the
 * two can never drift silently.
 */
export const SNAPGAUGE_VERSION = "1.0.0-rc.1";
