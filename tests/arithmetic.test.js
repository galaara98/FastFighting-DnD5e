import { describe, expect, test } from "vitest";
import { formulaNumber, plainDice } from "../scripts/arithmetic.js";

describe("a number from an item's formula, never run as code", () => {
  test("arithmetic, brackets, and the usual functions", () => {
    expect(formulaNumber("2")).toBe(2);
    expect(formulaNumber("1 + 3 * 2")).toBe(7);
    expect(formulaNumber("floor(5 / 2) + 1")).toBe(3);
    expect(formulaNumber("max(1, 4 - 6)")).toBe(1);
    expect(formulaNumber("-(2 + 1)")).toBe(-3);
    expect(formulaNumber("(4 + 2 * (5 - 5))")).toBe(4);
  });

  test("dice, averaged", () => {
    expect(formulaNumber("2d6")).toBe(7);
  });

  test("a dice count in brackets is worked out first (\"(@item.level - 5)d8\" at 7th level), never below none", () => {
    expect(plainDice("(7 - 5)d8")).toBe("2d8");
    expect(plainDice("3 + (1)d12")).toBe("3 + 1d12");
    expect(plainDice("(5 - 6)d12")).toBe("0d12");
    expect(formulaNumber("(7 - 5)d8")).toBe(9);
    expect(formulaNumber("(6 - 6)d12 + 2")).toBe(2);
  });

  test("anything else is no number: a formula is a player's to write", () => {
    // (Text that slips through as a die roll's flavor, but would run as code if evaluated: never evaluated here.)
    expect(formulaNumber('1["".constructor.constructor("globalThis.pwned = 1")()]', 5)).toBe(5);
    expect(globalThis.pwned).toBeUndefined();
    expect(formulaNumber("alert(1)", 5)).toBe(5);
    expect(formulaNumber("constructor", 5)).toBe(5);
    expect(formulaNumber("1 +", 5)).toBe(5);
    expect(formulaNumber("", 5)).toBe(5);
    expect(formulaNumber("9".repeat(500), 5)).toBe(5);
  });
});
