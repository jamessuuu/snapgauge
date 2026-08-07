import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "../schema.js";
import {
  migrateSnapshotDocument,
  MIGRATIONS,
  type SnapshotMigration,
} from "./index.js";

/** Fake forward-only chain the scaffold is proven against (SPEC §2 D3). */
const FAKES: SnapshotMigration[] = [
  {
    from: 1,
    to: 2,
    migrate: (doc) => ({ ...doc, formatVersion: 2, addedAtTwo: true }),
  },
  {
    from: 2,
    to: 3,
    migrate: (doc) => ({ ...doc, formatVersion: 3, addedAtThree: true }),
  },
];

describe("snapshot migration scaffold (SPEC §2 Decision 3)", () => {
  it("ships an empty registry while formatVersion is 1 (nothing to migrate FROM)", () => {
    expect(FORMAT_VERSION).toBe(1);
    expect(MIGRATIONS).toEqual([]);
  });

  it("applies forward-only steps in order and records them", () => {
    const outcome = migrateSnapshotDocument({ formatVersion: 1, x: 1 }, FAKES, 3);
    expect(outcome.applied).toEqual(["1->2", "2->3"]);
    expect(outcome.document).toEqual({
      formatVersion: 3,
      x: 1,
      addedAtTwo: true,
      addedAtThree: true,
    });
  });

  it("is pure: the input document is never mutated", () => {
    const input = { formatVersion: 1, x: 1 };
    migrateSnapshotDocument(input, FAKES, 3);
    expect(input).toEqual({ formatVersion: 1, x: 1 });
  });

  it("a current document is a no-op", () => {
    const input = { formatVersion: 3 };
    const outcome = migrateSnapshotDocument(input, FAKES, 3);
    expect(outcome.applied).toEqual([]);
    expect(outcome.document).toBe(input);
  });

  it("a NEWER document is refused with the targeted upgrade error", () => {
    expect(() => migrateSnapshotDocument({ formatVersion: 9 }, FAKES, 3)).toThrow(
      expect.objectContaining({ code: "SNAPSHOT_FORMAT_NEWER" }) as Error,
    );
  });

  it("a gap in the chain fails loudly instead of skipping versions", () => {
    const gappy = FAKES.filter((m) => m.from !== 2);
    expect(() => migrateSnapshotDocument({ formatVersion: 1 }, gappy, 3)).toThrow(
      expect.objectContaining({ code: "SNAPSHOT_FORMAT" }) as Error,
    );
  });

  it("a migration that mutates in place (returns its input) is an internal error", () => {
    const impure: SnapshotMigration[] = [
      {
        from: 1,
        to: 2,
        migrate: (doc) => {
          doc.formatVersion = 2;
          return doc;
        },
      },
    ];
    expect(() => migrateSnapshotDocument({ formatVersion: 1 }, impure, 2)).toThrow(
      expect.objectContaining({ code: "INTERNAL" }) as Error,
    );
  });

  it("a migration that forgets to stamp the new formatVersion is an internal error", () => {
    const forgetful: SnapshotMigration[] = [
      { from: 1, to: 2, migrate: (doc) => ({ ...doc }) },
    ];
    expect(() => migrateSnapshotDocument({ formatVersion: 1 }, forgetful, 2)).toThrow(
      expect.objectContaining({ code: "INTERNAL" }) as Error,
    );
  });
});
