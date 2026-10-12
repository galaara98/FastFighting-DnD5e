/**
 * Setting a character up by itself, as D&D 5e reads it: classes and species by identifier, kind of creature,
 * alignment, gear.
 */
import { describe, expect, test } from "vitest";
import { dnd5eHints, dnd5eTactics, alignmentKey, biographyOf, plainText } from "../scripts/auto.js";

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

describe("a biography, for the keywords", () => {
  // (The SRD 5.2 premade heroes' words, and sheet fields of the kind a player fills in.)
  const details = {
    biography: { value: "<p>A devout follower of her deity, Akra feels bound to bring peace to the region.</p>", public: "" },
    appearance: "Scaled and tall", trait: "<p>I am <strong>patient</strong>.</p>", ideal: "Charity", bond: "My temple", flaw: "I am stubborn"
  };

  test("a character's appearance, personality, ideals, bonds and flaws are said of it; its biography is its story", () => {
    const bio = biographyOf("character", details);
    for ( const words of ["Scaled and tall", "patient", "Charity", "My temple", "I am stubborn"] ) expect(bio.about).toContain(words);
    expect(bio.about).not.toContain("Akra");
    expect(bio.story).toContain("bring peace");
    expect(bio.against).toBe("");
  });

  test("a creature's biography is its lore, said of it", () => {
    const bio = biographyOf("npc", { biography: { value: "<p>Bandits are ruthless.</p>", public: "<p>Seen on the roads.</p>" } });
    expect(bio.about).toContain("Bandits are ruthless.");
    expect(bio.about).toContain("Seen on the roads.");
    expect(bio.story).toBe("");
    expect(biographyOf("npc", null)).toEqual({ about: "", story: "", against: "" });
  });
});
