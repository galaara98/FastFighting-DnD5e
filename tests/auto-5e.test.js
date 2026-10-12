/**
 * Setting a character up by itself, as D&D 5e reads it: classes and species by identifier, kind of creature,
 * alignment, gear.
 */
import { describe, expect, test } from "vitest";
import { dnd5eHints, dnd5eTactics, alignmentKey, plainText } from "../scripts/auto.js";

describe("the playstyles 5e says fit", () => {
  test("classes add up; a shield and heavy armor make a Tank likelier", () => {
    const h = dnd5eHints({ classes: ["paladin", "fighter"], shield: true, heavy: true });
    expect(h.tank).toBeCloseTo(1);
    expect(h.martyr).toBeCloseTo(0.3);
    expect(dnd5eHints({ classes: ["rogue"] }).thief).toBe(0.5);
  });

  test("a kind of creature, an alignment, a species with something to say", () => {
    expect(dnd5eHints({ creature: "fiend", alignment: "ce" }).cruel).toBeCloseTo(0.8);
    expect(dnd5eHints({ creature: "construct" })).toEqual({ relentless: 0.5 });
    expect(dnd5eHints({ species: "orc" })).toEqual({ relentless: 0.2 });
    expect(dnd5eHints({ species: "human", creature: "humanoid" })).toEqual({});
  });
});

describe("5e's answers to the tactics questions", () => {
  test("a class's style; a paladin guards; a construct never runs", () => {
    expect(dnd5eTactics({ classes: ["paladin"] })).toMatchObject({ style: "protector", target: "protect", allyDying: "rescue" });
    expect(dnd5eTactics({ classes: ["wizard"] }).style).toBe("caster");
    expect(dnd5eTactics({ creature: "construct" }).retreat).toBe("never");
  });

  test("an alignment by the system's own names for them", () => {
    expect(alignmentKey("Chaotic Evil", { ce: "Chaotic Evil", lg: "Lawful Good" })).toBe("ce");
    expect(alignmentKey("Caótico Malvado", { ce: "Caótico Malvado" })).toBe("ce");
    expect(alignmentKey("unaligned", { ce: "Chaotic Evil" })).toBe(null);
    expect(plainText("<p>A <em>greedy</em> sellsword.</p>")).toBe("A greedy sellsword.");
  });
});
