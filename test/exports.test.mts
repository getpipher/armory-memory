// exports.test.mts — verifies the public surface re-exports the pure store functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMemoryBlock, listMemory, memoryDirFor, toSlug } from "../src/index.ts";

test("exports surface re-exports the pure store functions", () => {
  assert.equal(typeof renderMemoryBlock, "function");
  assert.equal(typeof listMemory, "function");
  assert.equal(typeof memoryDirFor, "function");
  assert.equal(typeof toSlug, "function");
});

test("toSlug is reachable via the public surface", () => {
  assert.equal(toSlug("/Users/x/proj"), "-Users-x-proj");
});