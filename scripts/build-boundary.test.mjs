import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const configPath = new URL("../tsconfig.build.json", import.meta.url).pathname;
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const program = ts.parseJsonConfigFileContent(config.config, ts.sys, new URL("../", import.meta.url).pathname);

test("standalone program includes production OCPP and app code", () => {
  assert.deepEqual(program.errors, []);
  assert.ok(program.fileNames.some((file) => file.endsWith("/src/lib/ocpp/remote-commands.ts")));
  assert.ok(program.fileNames.some((file) => file.includes("/src/app/") && file.endsWith(".tsx")));
  assert.equal(program.options.strict, true);
  assert.equal(program.options.noEmit, true);
});

test("cross-owner commissioning suites stay outside the production program", () => {
  assert.ok(!program.fileNames.some((file) => file.includes("/__tests__/") || /\.test\.tsx?$/.test(file)));
  assert.ok(ts.sys.fileExists(new URL("../src/lib/ocpp/__tests__/cgp-commissioning.test.ts", import.meta.url).pathname));
});
