/**
 * Whether a 5e creature fights as an animal (the core's spec.animalistic): a beast that doesn't speak, else Intelligence
 * 11 or less with no language; never a mindless one.
 */
import { expect, test } from "vitest";
import { isAnimalistic } from "../scripts/traits.js";

test("a beast that doesn't speak; else dim wits and no language", () => {
  expect(isAnimalistic(2, "beast", false)).toBe(true);    // a wolf, a crocodile
  expect(isAnimalistic(3, "monstrosity", false)).toBe(true); // an owlbear
  expect(isAnimalistic(6, "fiend", false)).toBe(true);    // a hell hound that only understands
  expect(isAnimalistic(10, "beast", true)).toBe(false);   // a beast that talks
  expect(isAnimalistic(12, "monstrosity", false)).toBe(false);
});

test("never a mindless one, nor anything that speaks", () => {
  expect(isAnimalistic(1, "ooze", false)).toBe(false);
  expect(isAnimalistic(3, "undead", false)).toBe(false);
  expect(isAnimalistic(8, "humanoid", true)).toBe(false);
});
