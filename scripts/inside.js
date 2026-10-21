/**
 * Inside another creature in 5e: the core's swallowed and engulfed (its engine/conditions.js PROFILES: it can't move or
 * lead, what holds it harms it each turn, and it's let go when that one falls; and, in every system, it's where its
 * holder is and goes where it goes, its holder's grapple on it over, with Total Cover against everything outside its
 * holder and none against its holder: the core's holderOf and cutOff), as the SRD (5.1 and 5.2) has them:
 *  - Blinded and Restrained in a gullet, Restrained in an ooze (rules.js counts them), and not the core's own penalty
 *    on top (rules.conditionProfile: mods dropped).
 *  - What it takes is its holder's own (spec.inside.harm: rules.conditionHarm), at the start of a turn (the SRD's: the
 *    holder's; here, its own).
 *  - A gullet has no way out but being brought up: so much damage from inside it in one turn (spec.inside.spit.after),
 *    and its holder fails a save against it (spit.save), and all it holds falls out, Prone (spitUp: rules.afterHarm);
 *    or its holder's death (the core's: let go), out of the corpse Prone (rules.letGo). No action gets it out
 *    (insideHolds: rules.holds). An ooze's engulfing is broken with an action and a check (the escape its outcome
 *    carries: the core's holds.js, and holds.js here).
 * Pure: no Foundry globals.
 */
import { rollCheck, systemRolled, dropCondition, listJoin, holderOf } from "./core.js";
import { t, conditionName } from "./words.js";

/** The core's conditions for being inside another creature. */
export const INSIDE_KEYS = Object.freeze(["swallowed", "engulfed"]);

/**
 * A gullet's hold (swallowed): no action breaks it, its own or a friend's. Offered in the place of the core's own hold
 * for it (its holder's escape DC), so nobody spends a turn on it. [hold] or [].
 */
export function insideHolds(run, u) {
  if ( !((Number(u?.conds?.swallowed) || 0) > 0) ) return [];
  const holder = holderOf(run, u);
  return holder && !holder.spec?.inside?.escape ? [{ key: "swallowed", byId: holder.id, dc: null, others: null, friendOnly: true }] : [];
}

/**
 * Out of a dead holder's gullet (the core lets it go: rules.letGo): it leaves the corpse Prone, as the SRD's worm and
 * behir have it. An ooze just lets go.
 */
export function outOfCorpse(run, u, key) {
  if ( key === "swallowed" ) u.prone = true;
}

/**
 * Hurt from inside (rules.afterHarm, on the one hurt, told who hurt it): what its holder takes from those inside it on
 * one turn, counted; at its threshold (spec.inside.spit.after), its save (spit.save, once that turn), and a failure
 * brings them all up, Prone. The SRD has the save at the end of that turn; here it's made at once, the rest of the turn
 * theirs outside. Returns what's said ({text}), or null.
 */
export function spitUp(run, holder, amount, rng, by = null) {
  const spit = holder?.spec?.inside?.spit;
  if ( !spit || !(amount > 0) || !by || by === holder || holderOf(run, by) !== holder ) return null;
  // (One turn: the round, and whose turn it is; the core counts turns only while it keeps a log.)
  const turn = `${run.round ?? 0}|${run.turn ?? 0}|${by.id}`;
  if ( holder.fromInside?.turn !== turn ) holder.fromInside = { turn, dealt: 0, saved: false };
  const tally = holder.fromInside;
  tally.dealt += amount;
  if ( tally.saved || tally.dealt < spit.after ) return null;
  tally.saved = true;
  const rules = run.prep.rules;
  const type = [].concat(spit.save.type)[0] ?? "con";
  const m = rules.modifiers?.save?.({ unit: holder, type }) ?? {};
  const mod = (Number(holder.spec.defenses?.[type]) || 0) + (m.bonus ?? 0);
  // (In a live battle dnd5e's own save, its card in the chat; else the engine's d20, shown there as a table roll.)
  const label = conditionName(INSIDE_KEYS[0]);
  const rolled = systemRolled(run, holder, "save", { dc: spit.save.dc, save: type, label, advantage: m.advantage ?? 0 });
  const roll = rollCheck(rules, rng ?? run.rng, mod, spit.save.dc, { advantage: m.advantage ?? 0, kind: "save", by: holder, rolled, label });
  const held = run.units.filter(o => o !== holder && holderOf(run, o) === holder);
  const data = { names: listJoin(held.map(o => o.spec.name)), total: roll.total, dc: spit.save.dc };
  if ( roll.degree >= 2 ) return { text: t("KeepsDown", data) };
  for ( const o of held ) {
    for ( const key of INSIDE_KEYS ) dropCondition(o, key);
    o.prone = true;
  }
  return { text: t("SpitsUp", data) };
}
