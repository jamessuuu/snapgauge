/**
 * X-group — `x-mcp-header` validity (SPEC §5): static analysis of every
 * declaration in a tool's inputSchema, one rule per constraint. Any hit
 * means THE TOOL IS INVISIBLE TO CONFORMING CLIENTS (they MUST exclude it
 * from tools/list), so every static violation is reported at violation
 * class. The two live checks (param mismatch / absent param) run in the
 * compat engine against declared probes.
 */
import type { Json, JsonObject } from "../json.js";

export type XhdrViolation =
  | "empty"
  | "control_char"
  | "not_token"
  | "not_unique"
  | "non_primitive"
  | "unsafe_integer"
  | "not_statically_reachable";

/** Stored per tool in the snapshot (SPEC §2 `xmcpHeaders`). */
export interface XmcpHeaderReport {
  /** Dot path from the inputSchema root, e.g. "properties.workspace". */
  path: string;
  header: string;
  valid: boolean;
  violations: XhdrViolation[];
}

/** RFC 9110 token: 1*tchar. */
const TCHAR_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
// Deliberately matching control characters: SPEC section 5 xhdr.control_char
// must flag a header name containing one.
// eslint-disable-next-line no-control-regex -- see comment above
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function isObj(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Declaration {
  path: string;
  header: string;
  schema: JsonObject;
  reachable: boolean;
}

/**
 * Collect EVERY x-mcp-header declaration in the schema, tracking whether the
 * chain from the root is `properties` keys only — no `items`, no
 * `oneOf`/`anyOf`/`allOf`/`not`, no `if`/`then`/`else`, no `$ref`
 * (SPEC §5 xhdr.not_statically_reachable).
 */
function collectDeclarations(
  node: Json,
  path: string,
  reachable: boolean,
  out: Declaration[],
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      collectDeclarations(child, `${path}.${String(index)}`, false, out);
    });
    return;
  }
  if (!isObj(node)) return;
  const header = node["x-mcp-header"];
  if (typeof header === "string" && path !== "") {
    out.push({ path, header, schema: node, reachable });
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === "properties" && isObj(child)) {
      for (const [name, propSchema] of Object.entries(child)) {
        collectDeclarations(
          propSchema,
          path === "" ? `properties.${name}` : `${path}.properties.${name}`,
          reachable,
          out,
        );
      }
      continue;
    }
    if (key === "x-mcp-header") continue;
    // Any other structural keyword breaks static reachability for whatever
    // lies beneath it ($ref has no body to walk, but a declaration cannot
    // hide inside one anyway).
    collectDeclarations(child, path === "" ? key : `${path}.${key}`, false, out);
  }
}

function unsafeInteger(value: Json | undefined): boolean {
  return typeof value === "number" && (!Number.isInteger(value) || !Number.isSafeInteger(value));
}

/** Static X-group analysis of one tool's inputSchema. */
export function analyzeXmcpHeaders(inputSchema: JsonObject): XmcpHeaderReport[] {
  const declarations: Declaration[] = [];
  collectDeclarations(inputSchema, "", true, declarations);

  // Case-insensitive uniqueness across ALL of the tool's declarations.
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    const key = declaration.header.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return declarations.map((declaration) => {
    const violations: XhdrViolation[] = [];
    if (!declaration.reachable) violations.push("not_statically_reachable");
    if (declaration.header === "") {
      violations.push("empty");
    } else if (CONTROL_RE.test(declaration.header)) {
      violations.push("control_char");
    } else if (!TCHAR_RE.test(declaration.header)) {
      violations.push("not_token");
    }
    if ((counts.get(declaration.header.toLowerCase()) ?? 0) > 1) {
      violations.push("not_unique");
    }
    const type = declaration.schema.type;
    if (type !== "string" && type !== "boolean" && type !== "integer") {
      // `number` is explicitly not permitted; absent/object/array types are
      // not primitives a header value can round-trip through.
      violations.push("non_primitive");
    }
    if (type === "integer") {
      const enumValues = Array.isArray(declaration.schema.enum) ? declaration.schema.enum : [];
      const candidates: (Json | undefined)[] = [
        declaration.schema.const,
        declaration.schema.default,
        declaration.schema.minimum,
        declaration.schema.maximum,
        ...enumValues,
      ];
      if (candidates.some(unsafeInteger)) violations.push("unsafe_integer");
    }
    return {
      path: declaration.path,
      header: declaration.header,
      valid: violations.length === 0,
      violations,
    };
  });
}

/**
 * The top-level property name for a VALID binding path like
 * "properties.workspace" — what the live checks need to place an argument.
 */
export function topLevelPropertyOf(report: XmcpHeaderReport): string | undefined {
  const match = /^properties\.([^.]+)$/.exec(report.path);
  return match?.[1];
}
