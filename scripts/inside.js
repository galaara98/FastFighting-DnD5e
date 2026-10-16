/**
 * Inside another creature in 5e: the core's swallowed and engulfed (its engine/conditions.js PROFILES: it can't move or
 * lead, what holds it harms it each turn, and it's let go when that one falls), as the SRD (5.1 and 5.2) has them:
 *  - Total Cover against everything outside the creature that holds it: none but another inside it can go for it, and
 *    it can go for none but its holder and those inside with it (reachable: rules.canTarget).
 *  - Blinded and Restrained in a gullet, Restrained in an ooze (rules.js counts them).
 *  - What it takes each turn is its holder's own (spec.inside.harm: rules.conditionHarm).
 *  - A gullet has no way out but being brought up: so much damage from inside it in one turn (spec.inside.spit.after),
 *    and its holder fails a save against it (spit.save), and all it holds falls out, Prone (spitUp: rules.afterHarm);
 *    or its holder's death (the core's: let go). No action gets it out (insideHolds: rules.holds). An ooze's engulfing
 *    is broken with an action and a check (the escape its outcome carries: the core's holds.js, and holds.js here).
 *  - Swallowed, its holder's grapple ends; inside, it goes where its holder goes (insideTurn: rules.startTurn).
 * Pure: no Foundry globals.
 */
import { rollD20, dropCondition, listJoin } from "./core.js";
import { t } from "./words.js";

/** The core's conditions for being inside another creature. */
export const INSIDE_KEYS = Object.freeze(["swallowed", "engulfed"]);

const inside = u => INSIDE_KEYS.some(k => (Number(u?.conds?.[k]) || 0) > 0);

/** Whoever holds it inside (the source of the effect that put it there), or null. */
export function holderOf(run, u) {
  if ( !inside(u) ) return null;
  for ( const key of INSIDE_KEYS ) {
    const e = (u.effects ?? []).find(x => (Number(x.conditions?.[key]) || 0) > 0 && x.sourceId);
    const by = e ? run.byId?.get(e.sourceId) : null;
    if ( by ) return by;
  }
  return null;
}

/** Can u go for t, Total Cover between those inside a creature and everything outside it? */
export function reachable(run, u, t) {
  if ( !inside(u) && !inside(t) ) return true;
  const mine = holderOf(run, u);
  const theirs = holderOf(run, t);
  if ( mine ) return t === mine || theirs === mine;
  return !theirs;
}

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
 * The start of its turn, inside: swallowed, the grapple that brought it there is over; and it's where its holder is now
 * (it went along), within its reach.
 */
export function insideTurn(run, u) {
  const holder = holderOf(run, u);
  if ( !holder ) return null;
  if ( u.grabbedBy === holder.id ) {
    u.grabbedBy = null;
    u.grabKey = null;
  }
  if ( holder.pos && u.pos && (u.pos.x !== holder.pos.x || u.pos.y !== holder.pos.y) ) {
    u.pos = { x: holder.pos.x, y: holder.pos.y };
    run.geo = (run.geo ?? 0) + 1; // (someone has moved)
  }
  u.adjacent?.add?.(holder.id);
  holder.adjacent?.add?.(u.id);
  return null;
}

/**
 * Hurt from inside (rules.afterHarm, on the one hurt): what its holder takes from those inside it on one turn, counted;
 * at its threshold (spec.inside.spit.after), its save (spit.save, once that turn), and a failure brings them all up,
 * Prone. The SRD has the save at the end of that turn; here it's made at once, the rest of the turn theirs outside.
 * Returns what's said ({text}), or null.
 */
export function spitUp(run, holder, amount, rng) {
  const spit = holder?.spec?.inside?.spit;
  const by = run.acting;
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
  const roll = rollD20(rules, rng ?? run.rng, mod, spit.save.dc, { advantage: m.advantage ?? 0, kind: "save" });
  const held = run.units.filter(o => o !== holder && holderOf(run, o) === holder);
  const data = { names: listJoin(held.map(o => o.spec.name)), total: roll.total, dc: spit.save.dc };
  if ( roll.degree >= 2 ) return { text: t("KeepsDown", data) };
  for ( const o of held ) {
    for ( const key of INSIDE_KEYS ) dropCondition(o, key);
    o.prone = true;
  }
  return { text: t("SpitsUp", data) };
}
