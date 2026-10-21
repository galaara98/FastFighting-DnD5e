/**
 * The cards FastFighting has dnd5e make in the turns it plays, marked as its own: dnd5e's damage and effect trays gone
 * as they're rendered, a line in their place, its Apply entries off their chat menu, and a save card's Resist and Break
 * Concentration gone, so nothing is applied, spent or ended a second time; other cards as dnd5e has them. Only a GM's
 * card is FastFighting's: a player may mark their own card, and it stays theirs. A player's card whose damage the live
 * battle applied itself (by the ids the core noted) loses its tray too. A card the table settles after all gets it back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hideApply, hideApplyMenu, unmarkRolled, rolledHere, rolledFlags } from "../scripts/cards.js";
import { Dnd5eAdapter } from "../scripts/adapter.js";
import { notedBy } from "../../FastFighting/scripts/foundry/applied-cards.js";

/** An element as the DOM has one: replaced by another, or removed. */
const element = () => {
  const el = { replacedBy: null, removed: false };
  el.replaceWith = node => { el.replacedBy = node; };
  el.remove = () => { el.removed = true; };
  return el;
};
const untouched = el => !el.removed && el.replacedBy === null;

/** A rendered card: its trays, and the buttons on it. */
const rendered = ({ trays = [], buttons = [] } = {}) => ({
  querySelectorAll: selector => (selector.includes("damage-application") ? trays : selector.includes("resistSave") ? buttons : [])
});

const mine = () => ({ id: "m1", author: { isGM: true }, flags: { "fast-fighting-dnd5e": { rolled: { times: 1 } } } });
const theirs = { id: "m2", author: { isGM: false }, flags: { dnd5e: {} } };
/** A player's own card, marked as if FastFighting had rolled it. */
const forged = { id: "m3", author: { isGM: false }, flags: { "fast-fighting-dnd5e": { rolled: { times: 1 } } } };

const was = { document: globalThis.document };
beforeEach(() => {
  globalThis.document = { createElement: tag => ({ tag }) };
  globalThis.game.messages = new Map([["m1", mine()], ["m2", theirs], ["m3", forged]]);
});
afterEach(() => {
  globalThis.document = was.document;
  notedBy(null);
});

describe("a card FastFighting had dnd5e make", () => {
  test("rendered: its trays emptied, one line in their place; a save card's Resist and Break Concentration gone", () => {
    const trays = [element(), element()];
    const buttons = [element(), element()];
    hideApply(mine(), rendered({ trays, buttons }));
    expect(trays[0].replacedBy).toEqual({ tag: "span", textContent: expect.any(String) });
    expect(trays[0].replacedBy.textContent).not.toBe("");
    expect(trays[1].removed).toBe(true);
    expect(buttons.every(b => b.removed)).toBe(true);
  });

  test("another's card, a player's own marked one too, as dnd5e renders it", () => {
    for ( const card of [theirs, forged, null] ) {
      const trays = [element()];
      const buttons = [element()];
      hideApply(card, rendered({ trays, buttons }));
      expect(untouched(trays[0])).toBe(true);
      expect(untouched(buttons[0])).toBe(true);
    }
    expect(rolledHere(forged)).toBe(false);
  });

  test("a player's card the live battle applied for them: its tray gone, its buttons theirs", () => {
    notedBy(id => id === "m2");
    const trays = [element()];
    const buttons = [element()];
    hideApply(theirs, rendered({ trays, buttons }));
    expect(trays[0].replacedBy).not.toBeNull();
    expect(untouched(buttons[0])).toBe(true);
  });

  test("the chat's menu: dnd5e's Apply entries (damage, healing, double, half ...) not on FastFighting's cards; the rest as they were", () => {
    const apply = { label: "DND5E.ChatContextDamage", group: "damage", visible: () => true };
    const half = { label: "DND5E.ChatContextHalfDamage", group: "damage", visible: () => true };
    const select = { label: "DND5E.ChatContextSelectHit", group: "attack", visible: () => true };
    const visible = select.visible;
    hideApplyMenu({}, [apply, half, select, null]);
    const li = id => ({ dataset: { messageId: id } });
    expect([apply.visible(li("m1")), half.visible(li("m1")), apply.visible(li("m2")), apply.visible(li("m3")), apply.visible(li("gone"))]).toEqual([false, false, true, true, true]);
    expect(select.visible).toBe(visible);
  });

  test("the mark a new card carries: a fresh object each time, nothing frozen (Foundry cleans a message's flags in place)", () => {
    const [a, b] = [rolledFlags(), rolledFlags()];
    expect(a).toEqual({ "fast-fighting-dnd5e": { rolled: { times: 1 } } });
    expect(a["fast-fighting-dnd5e"]).not.toBe(b["fast-fighting-dnd5e"]);
    expect(Object.isFrozen(a["fast-fighting-dnd5e"].rolled)).toBe(false);
  });

  test("left to the table after all (leaveToTable): its mark off, its tray back; a player's card untouched", async () => {
    const card = { ...mine(), unsetFlag: vi.fn(async () => {}) };
    await new Dnd5eAdapter().leaveToTable(card);
    expect(card.unsetFlag).toHaveBeenCalledWith("fast-fighting-dnd5e", "rolled");
    const player = { ...forged, unsetFlag: vi.fn() };
    await unmarkRolled(player);
    expect(player.unsetFlag).not.toHaveBeenCalled();
  });
});
