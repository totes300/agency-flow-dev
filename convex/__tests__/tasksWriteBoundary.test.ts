// @vitest-environment node
//
// Tasks refactor slice 1, invariant T2 (docs/prd-tasks-refactor.md §5.2):
// `tasks`, `taskAssignees`, `taskLabels` and `taskIdentifierAliases` are
// written only by convex/tasks/write.ts.
//
// Convex 1.34's `ctx.db.patch/replace/delete(id)` take no table name, so a
// text grep cannot tell which table a call writes. This test asks the
// TypeScript checker instead: the table of a write is the `__tableName` of
// the id argument's type (or the table-name literal of insert / the two-arg
// forms). A write whose table cannot be resolved also fails, so a loosely
// typed id cannot slip past. Test files are excluded (fixtures set up rows
// directly); seeds are NOT excluded — they route through write.ts (§5.1).

import { describe, it, expect } from "vitest";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const WRITER = "convex/tasks/write.ts";
const GUARDED = new Set(["tasks", "taskAssignees", "taskLabels", "taskIdentifierAliases"]);
const WRITE_METHODS = new Set(["insert", "patch", "replace", "delete"]);

type Write = { file: string; line: number; method: string; tables: string[] };

function collectWrites(): Write[] {
  const configPath = path.join(ROOT, "convex/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const tablesOfIdType = (type: ts.Type): string[] => {
    const tables: string[] = [];
    for (const part of type.isUnion() ? type.types : [type]) {
      const prop = part.getProperty("__tableName");
      if (!prop) {
        tables.push("?");
        continue;
      }
      const nameType = checker.getTypeOfSymbol(prop);
      for (const n of nameType.isUnion() ? nameType.types : [nameType]) {
        tables.push(n.isStringLiteral() ? n.value : "?");
      }
    }
    return tables;
  };

  const writes: Write[] = [];
  for (const sf of program.getSourceFiles()) {
    const rel = path.relative(ROOT, sf.fileName);
    if (!rel.startsWith("convex/") || rel.startsWith("convex/_generated/") || rel.includes("__tests__")) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        WRITE_METHODS.has(node.expression.name.text) &&
        /\bdb$/.test(node.expression.expression.getText(sf)) &&
        node.arguments.length > 0
      ) {
        const first = node.arguments[0];
        const tables = ts.isStringLiteralLike(first)
          ? [first.text]
          : tablesOfIdType(checker.getTypeAtLocation(first));
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        writes.push({ file: rel, line: line + 1, method: node.expression.name.text, tables });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return writes;
}

describe("T2: one writer for the task tables", () => {
  const writes = collectWrites();

  it("finds the write calls it is meant to police", () => {
    // Guards against the scan silently matching nothing (e.g. a path change).
    expect(writes.filter((w) => w.file === WRITER && w.tables.includes("tasks")).length).toBeGreaterThan(5);
    expect(writes.some((w) => w.file === "convex/comments.ts" && w.tables.includes("comments"))).toBe(true);
  });

  it("no module but tasks/write.ts writes tasks, taskAssignees, taskLabels or taskIdentifierAliases", () => {
    const violations = writes
      .filter((w) => w.file !== WRITER && w.tables.some((t) => GUARDED.has(t)))
      .map((w) => `${w.file}:${w.line} ${w.method} [${w.tables.join(", ")}]`);
    expect(violations).toEqual([]);
  });

  it("every db write resolves to a concrete table", () => {
    const unresolved = writes
      .filter((w) => w.tables.includes("?"))
      .map((w) => `${w.file}:${w.line} ${w.method}`);
    expect(unresolved).toEqual([]);
  });
});
