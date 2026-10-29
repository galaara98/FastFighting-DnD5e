/**
 * What this helper takes up of the core's API 37: Haste's additional action as the core's limited actions (one weapon
 * attack, a Dash, a Disengage or a Hide), and the SRD 5.2's summons acting in their summoner's turn (withSummoner).
 */
import { describe, expect, test } from "vitest";
import { Turn, DISENGAGE } from "../../FastFighting/scripts/engine/turn.js";
import { withSummonerIn } from "../scripts/adapter.js";
import { dnd5eRules } from "../scripts/rules.js";

const unit = (mods = {}, conds = {}) => ({ id: "u", side: "a", spec: { speeds: { walk: 30 } }, conds, mods });
const sword = { id: "sword", kind: "strike", weapon: true, melee: true, cost: 1 };
const extra = { ...sword, id: "sword.extra", sequence: [sword, sword] };
const bolt = { id: "fire-bolt", kind: "spell-attack", cost: 1 };
/** A turn as the core makes one: Haste's action added to the pool (battle-state's lost less mods.actions). */
const turnOf = u => new Turn(dnd5eRules, u, dnd5eRules.modifiers.actionsLost(u) - (u.mods?.actions ?? 0));

describe("Haste's additional action (the core's limited actions)", () => {
  test("only for one weapon attack, a Dash, a Disengage or a Hide", () => {
    expect(dnd5eRules.modifiers.limitedActions(unit({ actions: 1 }))).toEqual({ n: 1, for: ["strike", "stride", "disengage", "hide"] });
    expect(dnd5eRules.modifiers.limitedActions(unit())).toBeNull();
  });

  test("a Hide, a Disengage or a Dash with it, the other action left for a spell; never a Dodge", () => {
    const hide = { id: "hide", kind: "buff", cost: 1, hide: true, limitedAs: "hide" };
    const dodge = { id: "dodge", kind: "buff", cost: 1 };
    for ( const use of [t => t.spend(dnd5eRules.costOf(hide), hide), t => t.spend({ action: 1 }, DISENGAGE), t => { t.usedMove(30); t.payForMove(30); }] ) {
      const turn = turnOf(unit({ actions: 1 }));
      use(turn);
      expect(turn.canAfford(dnd5eRules.costOf(bolt), bolt)).toBe(true);
    }
    const turn = turnOf(unit({ actions: 1 }));
    turn.spend(dnd5eRules.costOf(bolt), bolt);
    expect(turn.canAfford(dnd5eRules.costOf(dodge), dodge)).toBe(false);
    expect(turn.canAfford(dnd5eRules.costOf(hide), hide)).toBe(true);
  });

  test("the Attack action with Extra Attack, or a spell, once; a single weapon attack with the other", () => {
    const turn = turnOf(unit({ actions: 1 }));
    expect(turn.left).toBe(2);
    expect(turn.howMany(dnd5eRules.costOf(extra), extra)).toBe(1);
    expect(turn.howMany(dnd5eRules.costOf(bolt), bolt)).toBe(1);
    turn.spend(dnd5eRules.costOf(extra), extra);
    expect(turn.canAfford(dnd5eRules.costOf(bolt), bolt)).toBe(false);
    expect(turn.canAfford(dnd5eRules.costOf(sword), sword)).toBe(true);
  });

  test("paralyzed, nothing at all", () => {
    expect(turnOf(unit({ actions: 1 }, { paralyzed: 1 })).left).toBe(0);
  });
});

describe("summons that act in their summoner's turn", () => {
  test("the SRD 5.2's share their summoner's initiative; the SRD 5.1's roll their own", () => {
    expect(withSummonerIn("In combat, the creature shares your Initiative count, but it takes its turn immediately after yours.")).toBe(true);
    expect(withSummonerIn("In combat, it shares your Initiative count, and it functions as a controlled mount while you ride it.")).toBe(true);
    expect(withSummonerIn("Roll initiative for the summoned creatures as a group, which has its own turns.")).toBe(false);
    expect(withSummonerIn("It rolls its own Initiative and acts on its own turn.")).toBe(false);
  });
});
