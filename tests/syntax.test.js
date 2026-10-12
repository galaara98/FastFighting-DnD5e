/**
 * Every script loads in Foundry as an ES module: Node's own parser checks it (the test runner's would let a duplicate
 * declaration, an import and a function of the same name, slip through).
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "child_process";
import { readdirSync } from "fs";
import { fileURLToPath } from "url";

const dir = fileURLToPath(new URL("../scripts/", import.meta.url));

describe("the scripts", () => {
  test("each parses as a module", () => {
    const broken = [];
    for ( const file of readdirSync(dir).filter(f => f.endsWith(".js")) ) {
      try {
        execFileSync(process.execPath, ["--check", `${dir}${file}`], { stdio: "pipe" });
      } catch ( err ) {
        broken.push(`${file}: ${String(err.stderr ?? err).split("\n").find(l => /Error/.test(l)) ?? ""}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
