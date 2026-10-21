/**
 * The engine's own dice as dnd5e's own cards (the core's API 20 showTableRoll): a table roll FastFighting made itself in
 * a live battle, posted as dnd5e 6 posts that kind of roll, a chat message of its type with its system data.
 *  - An attack: an "attack" card, a D20Roll of the engine's d20 (two, kept higher or lower, for advantage or
 *    disadvantage) and modifier, its total, against the target's AC (the roll's target, its TargetsField descriptor):
 *    dnd5e shows the hit or miss to whom its own settings say.
 *  - A save: a "save" card of the ability saved with; a death save (the rules' recovery check), dnd5e's death save card.
 *  - A check: a "check" card of the skill (and its ability) or the ability the rules say it was (the roll's `stat`).
 *  - Damage and healing: a "damage" or "healing" card, a DamageRoll a part, of its type, every die as it fell.
 * Each names the action's activity where there is one (its item in the card's header), and is marked as FastFighting's
 * (cards.js): no tray to apply it again, no Resist or Break Concentration to spend or end what the engine decided.
 * Styling only: the engine's dice exactly, its result standing whatever dnd5e does with the card. One card a roll, to
 * whom the core says (`audience`: everyone, or the GMs alone: "gm"). Anything else (a recharge, a flat check, a check
 * the rules don't name, a roll with no token): null, the core's plain roll.
 * The pure parts (cardKind, damageRollData, d20RollData) need no Foundry.
 */
import { rolledParts, rollJson } from "./core.js";
import { rolledFlags } from "./cards.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** dnd5e's skills and the ability each goes by (its CONFIG where it's loaded; else the SRD's). */
const SKILL_ABILITIES = Object.freeze({
  acr: "dex", ani: "wis", arc: "int", ath: "str", dec: "cha", his: "int", ins: "wis", itm: "cha", inv: "int", med: "wis", nat: "int",
  prc: "wis", prf: "cha", per: "cha", rel: "int", slt: "dex", ste: "dex", sur: "wis"
});
const skillAbility = skill => globalThis.CONFIG?.DND5E?.skills?.[skill]?.ability ?? SKILL_ABILITIES[skill] ?? null;

/**
 * The kind of dnd5e card a table roll is shown as, with its system data: {type, system}, or null for none (the core's
 * plain roll). A save's ability, or a death save's; a check's skill and ability, or ability (its `stat`).
 */
export function cardKind(roll) {
  if ( roll?.kind === "attack" ) return { type: "attack", system: {} };
  if ( roll?.kind === "save" ) {
    if ( roll.what === "recovery" ) return { type: "save", system: { type: "death" } };
    return ABILITIES.includes(roll.stat) ? { type: "save", system: { type: "ability", ability: roll.stat } } : null;
  }
  if ( roll?.kind === "check" ) {
    if ( ABILITIES.includes(roll.stat) ) return { type: "check", system: { type: "ability", ability: roll.stat } };
    const ability = skillAbility(roll.stat);
    return ability ? { type: "check", system: { type: "ability", ability, skill: roll.stat } } : null;
  }
  if ( roll?.kind === "damage" || roll?.kind === "healing" ) return { type: roll.kind, system: {} };
  return null;
}

/**
 * A d20 roll's data as dnd5e's D20Roll keeps it: the core's Roll data (rollJson: the engine's d20s, kept and
 * discarded, its modifier and total) with D20Roll's options: the DC (an attack's, the target's AC) and advantage.
 * Null where it has no d20, or shows as several rolls.
 */
export function d20RollData(roll) {
  if ( !(roll?.groups ?? []).some(g => g.faces === 20) || (roll.rolls?.length ?? 1) > 1 ) return null;
  const json = rollJson(roll);
  if ( !json ) return null;
  const keep = roll.groups.find(g => g.faces === 20)?.keep ?? null;
  return {
    ...json, class: "D20Roll",
    options: { ...(json.options ?? {}), ...(Number.isFinite(roll.dc) ? { target: roll.dc } : {}), advantageMode: keep === "kh" ? 1 : keep === "kl" ? -1 : 0 }
  };
}

const operator = op => ({ class: "OperatorTerm", operator: op, options: {}, evaluated: true });
const numeric = n => ({ class: "NumericTerm", number: n, options: {}, evaluated: true });

/**
 * A damage or healing roll's data as dnd5e's DamageRolls keep it: one a part, of its type (healing's "healing", or
 * "temphp"), its dice as they fell and its number, its total; its properties (an item's magical, adamantine, silvered:
 * what got through resistances). [] for a roll with no parts recorded.
 */
export function damageRollData(roll, { properties = [] } = {}) {
  const healing = roll?.kind === "healing";
  const out = [];
  for ( const p of rolledParts(roll) ) {
    const terms = [];
    let total = 0;
    for ( const d of p.dice ) {
      if ( !d.results.length ) continue;
      if ( terms.length || d.sign < 0 ) terms.push(operator(d.sign < 0 ? "-" : "+"));
      terms.push({ class: "Die", number: d.results.length, faces: d.faces, modifiers: [], results: d.results.map(result => ({ result, active: true })), options: {}, evaluated: true });
      const mult = Number(d.mult) || 1;
      if ( mult !== 1 ) terms.push(operator("*"), numeric(mult));
      total += d.results.reduce((s, r) => s + r, 0) * (d.sign < 0 ? -1 : 1) * mult;
    }
    const flat = Number(p.flat) || 0;
    if ( flat ) {
      if ( terms.length || flat < 0 ) terms.push(operator(flat < 0 ? "-" : "+"));
      terms.push(numeric(Math.abs(flat)));
      total += flat;
    }
    if ( !terms.length ) continue;
    const type = healing ? (p.type === "temphp" ? "temphp" : "healing") : p.type && p.type !== "untyped" ? p.type : "";
    const formula = terms.map(x => (x.class === "Die" ? `${x.number}d${x.faces}` : x.class === "OperatorTerm" ? x.operator : String(x.number))).join(" ");
    out.push({
      class: "DamageRoll", formula, terms, total: Math.max(0, total), evaluated: true, dice: [],
      options: { type, types: type ? [type] : [], properties: [...properties] }
    });
  }
  return out;
}

/* -------------------------------------------- */
/*  Posting (Foundry)                           */
/* -------------------------------------------- */

const gmIds = () => (globalThis.game?.users ?? []).filter(u => u.isGM).map(u => u.id);

/**
 * The core's showTableRoll (above): the roll as dnd5e's own card, posted. Its message's id, in a list; or null for the
 * core's plain roll.
 * @param {object} roll      the core's table roll
 * @param {object} options   {token, target: TokenDocuments; audience: "public" | "gm"; flavor: the core's words;
 *                            flags: FastFighting's own, put on the card; activityOf(actor, id): the action's
 *                            {activity, item}, or null; targetsOf(token): its TargetsField descriptors; properties(item):
 *                            what a blow with it is (magical, adamantine, silvered)}
 * @returns {Promise<string[]|null>}
 */
export async function showDnd5eTableRoll(roll, { token = null, target = null, audience = "public", flavor = "", flags = {}, activityOf = null, targetsOf = null, properties = null } = {}) {
  const kind = cardKind(roll);
  const actor = token?.actor;
  const Message = globalThis.CONFIG?.ChatMessage?.documentClass ?? globalThis.ChatMessage?.implementation;
  const Roll = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
  if ( !kind || !actor || !Message || !Roll ) return null;
  const found = typeof activityOf === "function" && typeof roll.action === "string" ? activityOf(actor, roll.action.replace(/^reaction:/, "")) : null;
  let rolls;
  if ( kind.type === "damage" || kind.type === "healing" ) {
    const props = found?.item && typeof properties === "function" ? properties(found.item) ?? [] : [];
    rolls = damageRollData(roll, { properties: props }).map(data => Roll.fromData(data));
  } else {
    const data = d20RollData(roll);
    rolls = data ? [Roll.fromData(data)] : [];
  }
  if ( !rolls.length ) return null;
  // (Whom it's at: an attack's target, a damage roll's, as dnd5e's own cards name them.)
  const targets = target && typeof targetsOf === "function" && kind.type !== "save" && kind.type !== "check" ? targetsOf(target) : [];
  const gm = audience === "gm";
  const message = await Message.create({
    type: kind.type,
    speaker: Message.getSpeaker?.({ token }) ?? {},
    flavor, rolls, sound: globalThis.CONFIG?.sounds?.dice,
    whisper: gm ? gmIds() : [],
    system: { ...kind.system, ...(found?.activity?.uuid ? { activity: { uuid: found.activity.uuid } } : {}), ...(targets.length ? { targets } : {}) },
    flags: { ...flags, ...rolledFlags() }
  });
  return message?.id ? [message.id] : null;
}
