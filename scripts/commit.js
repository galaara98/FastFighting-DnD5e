/**
 * D&D 5e: what a live battle changes, written onto a token's actor (one turn's changes, a player's damage card, and
 * anything handed over), each write returning an undo record; and what a fight changes, in words, for the planner.
 *
 * Undo record shape (the core puts these back when the GM rewinds a turn or the encounter):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     createdEffects: [id], deletedEffects: [data], tokenUpdate, createdActors, createdTokens, deletedTokens,
 *     statuses: [{id, active}], combatant }
 */
import { MODULE_ID, STATUS, commonOutcome, outcomeLine, stillLine, toggleStatus, undoRecord, payFrom, handOverItem } from "./core.js";
import { t, conditionName, playersOf } from "./words.js";
import { modeledChange } from "./effects.js";
import { damagesOf } from "./read-turn.js";
import { WRITES, SHEET_STATUSES, hasStatus, ownStatus, statusKeys, exhaustionLevels } from "./conditions.js";

/** Engine conditions a fight's summary names: the dnd5e statuses that outlast it. */
const LINGERING = { frightened: "frightened", poisoned: "poisoned", blinded: "blinded", restrained: "restrained", paralyzed: "paralyzed", stunned: "stunned", charmed: "charmed", controlled: "charmed", petrified: "petrified" };

/**
 * What a fight changes on a creature, a line each, for the planner's summary. `labelOf(key)`: what a resource is called
 * (the adapter's resourceLabel); null for one an action spends, named for the action.
 */
export function describeDnd5eOutcome(spec, final, labelOf = () => null) {
  // (Hit points, its fate and a change of side: the core's words.)
  const lines = commonOutcome(spec, final);
  if ( final.status === STATUS.DOWN ) {
    const s = final.system ?? {};
    lines.push(final.stable ? outcomeLine("Unconscious") : t("DeathSaves", { s: s.deathSuccesses ?? 0, f: s.deathFailures ?? 0 }));
  }
  for ( const k of Object.keys(final.conditions ?? {}) ) {
    const name = LINGERING[k] ? conditionName(LINGERING[k]) : null;
    if ( name && !lines.includes(name) ) lines.push(name);
  }
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const used = start - (final.resources?.[key] ?? start);
    if ( used > 0 ) lines.push(outcomeLine("Uses", { n: used, what: labelOf(key) ?? spec.actions.find(a => a.resource === key)?.name ?? key }));
  }
  for ( const [id, left] of Object.entries(final.uses ?? {}) ) {
    const a = spec.actions.find(x => x.id === id);
    if ( a && Number.isFinite(a.uses) && left < a.uses ) lines.push(outcomeLine("Uses", { n: a.uses - left, what: a.name }));
  }
  for ( const e of final.effects ?? [] ) lines.push(stillLine(e));
  return lines;
}

/**
 * Is a status as asked already, the dnd5e way (toggleStatus's skip)? On: it shows. Off: it isn't on by its own effect.
 * One that's only part of another's (Incapacitated with Stunned) isn't its to take off: nothing would come off, and the
 * undo record would put it on.
 */
const asAsked = (actor, id, active) => (active ? actor.statuses?.has(id) : !ownStatus(actor, id));

/** A status put on (unless it shows already) or taken off, by its own effect (the core's toggleStatus). */
const setStatus = (actor, id, active, undo, { overlay = false } = {}) => toggleStatus(actor, id, active, undo, { overlay, skip: asAsked });

/**
 * The engine's conditions set and taken off this turn, on the sheet: each it carries as its own status (conditions.js),
 * control shown as Charmed, and exhaustion as its level. A status goes on when a condition it shows is set, unless
 * another going on means it already (Unconscious is Incapacitated too). It comes off when one is taken off, unless
 * another it shows is set this turn or control still holds it (Charmed taken off a creature still dominated stays).
 * Prone is its own change (changes.prone); a status this world's dnd5e doesn't have isn't written.
 */
async function writeConditions(actor, conditions, final, set, undo) {
  const on = conditions.set ?? {};
  const cleared = conditions.cleared ?? [];
  const statusOf = k => (k !== "prone" && Object.hasOwn(WRITES, k) && hasStatus(WRITES[k]) ? WRITES[k] : null);
  const wanted = new Set(Object.keys(on).map(statusOf).filter(Boolean));
  const implied = new Set([...wanted].flatMap(s => statusKeys(s).slice(1)).map(statusOf));
  const held = new Set(Object.entries(final.conditions ?? {})
    .filter(([k, v]) => (Number(v) || 0) > 0 && !Object.hasOwn(SHEET_STATUSES, k)).map(([k]) => statusOf(k)).filter(Boolean));
  for ( const status of wanted ) if ( !implied.has(status) ) await setStatus(actor, status, true, undo);
  for ( const status of new Set(cleared.map(statusOf).filter(Boolean)) ) {
    if ( !wanted.has(status) && !held.has(status) ) await setStatus(actor, status, false, undo);
  }
  if ( Object.hasOwn(on, "exhaustion") ) {
    const level = on.exhaustion === true ? 1 : Math.round(Number(on.exhaustion) || 0);
    set("system.attributes.exhaustion", Math.max(0, Math.min(exhaustionLevels(), level)));
  } else if ( cleared.includes("exhaustion") ) set("system.attributes.exhaustion", 0);
}

/**
 * A live battle: one turn's changes (the core's engine/changes.js) written onto a token, and only those, so writing
 * them twice changes nothing more. Hit points; death saves where the turn left them; slots, Inspiration, Legendary
 * Resistance, a feature's or an item's uses and consumables spent this turn; statuses set and lifted; a death, running,
 * surrendering. (A change of side the core shows on the token itself.)
 * @returns {Promise<object>} an undo record (its shape at the top of this file)
 */
export async function commitDnd5eChanges(tokenDoc, spec, changes, final, options = {}) {
  const actor = tokenDoc.actor;
  // (With the statuses it has now, so Undo also lifts what dnd5e adds by itself: Prone with Unconscious.)
  const undo = undoRecord(tokenDoc, actor);
  const update = {};
  const set = (path, value) => {
    const before = foundry.utils.getProperty(actor, path);
    if ( before === value ) return;
    update[path] = value;
    undo.actorUpdate[path] = before ?? 0;
  };
  if ( changes.hp ) set("system.attributes.hp.value", changes.hp.to);
  if ( changes.temp ) set("system.attributes.hp.temp", changes.temp.to ?? 0);
  // Death saves: where the turn left them (none for anyone standing or stable).
  if ( actor.type === "character" && (changes.hp || changes.fell || changes.revived || changes.stable || changes.dying) ) {
    const s = final.system ?? {};
    const down = final.status === STATUS.DOWN && !final.stable;
    set("system.attributes.death.success", down ? (s.deathSuccesses ?? 0) : 0);
    set("system.attributes.death.failure", down ? (s.deathFailures ?? 0) : 0);
  }
  // What it spent this turn (from as it was when the turn began to as it is now).
  const spentOf = c => Math.max(0, (Number(c.from) || 0) - (Number(c.to) || 0));
  for ( const [key, c] of Object.entries(changes.resources ?? {}) ) {
    if ( key === "pact" ) set("system.spells.pact.value", c.to);
    else if ( key === "fate" ) set("system.attributes.inspiration", (c.to ?? 0) > 0);
    else if ( key === "legres" ) set("system.resources.legres.spent", Math.max(0, (actor.system.resources?.legres?.spent ?? 0) + spentOf(c)));
    else if ( key.startsWith("slots:") ) set(`system.spells.spell${key.split(":")[1]}.value`, c.to);
    else if ( key.startsWith("feature:") || key.startsWith("item:") ) {
      const item = actor.items.get(key.split(":")[1]);
      const used = spentOf(c);
      if ( !item || !used ) continue;
      if ( key.startsWith("feature:") && item.system.uses ) {
        undo.itemUpdates.push({ id: item.id, update: { "system.uses.spent": item.system.uses.spent ?? 0 } });
        await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + used });
      } else if ( key.startsWith("item:") ) {
        const quantity = Math.max(0, (item.system.quantity ?? 1) - used);
        if ( quantity <= 0 ) {
          undo.deletedItems.push(item.toObject());
          await item.delete();
        } else {
          undo.itemUpdates.push({ id: item.id, update: { "system.quantity": item.system.quantity } });
          await item.update({ "system.quantity": quantity });
        }
      }
    }
  }
  for ( const [id, c] of Object.entries(changes.uses ?? {}) ) {
    const action = spec.actions.find(a => a.id === id);
    const item = action?.itemId ? actor.items.get(action.itemId) : null;
    const used = spentOf(c);
    if ( !item?.system.uses || !used ) continue;
    undo.itemUpdates.push({ id: item.id, update: { "system.uses.spent": item.system.uses.spent ?? 0 } });
    await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + used });
  }
  // Statuses before hit points (dnd5e adds and lifts Bloodied by itself on an HP change).
  const dead = final.status === STATUS.DEAD;
  if ( !dead && (changes.fell || changes.status?.to === STATUS.DOWN) ) {
    await setStatus(actor, "unconscious", true, undo);
    await setStatus(actor, "prone", true, undo);
  }
  if ( changes.revived ) await setStatus(actor, "unconscious", false, undo);
  if ( changes.prone && !dead && !changes.fell ) await setStatus(actor, "prone", !!changes.prone.to, undo);
  if ( changes.conditions && !dead ) await writeConditions(actor, changes.conditions, final, set, undo);
  // A spell's effects on it (Bless, Bane, Hold Person): its own, put on for the rounds it has; and off when it ends.
  if ( !dead ) for ( const e of changes.effects?.added ?? [] ) await layEffect(actor, e, options, undo);
  for ( const e of changes.effects?.ended ?? [] ) await liftEffect(actor, e, undo);
  if ( changes.died ) {
    await setStatus(actor, "dead", true, undo, { overlay: true });
    const combatant = game.combat?.getCombatantsByToken?.(tokenDoc)?.[0];
    if ( combatant && !combatant.defeated ) {
      await combatant.update({ defeated: true });
      undo.combatant = { uuid: combatant.uuid, defeated: false };
    }
  } else if ( changes.status?.to === STATUS.FLED && options.fledMode !== "leave" && spec.kind !== "pc" ) {
    undo.tokenUpdate = { hidden: tokenDoc.hidden };
    await tokenDoc.update({ hidden: true });
  } else if ( changes.status?.to === STATUS.SURRENDERED ) {
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("FFDND5E.Surrendered"),
      img: "icons/svg/cancel.svg",
      description: game.i18n.localize("FFDND5E.SurrenderedHint"),
      flags: { [MODULE_ID]: { surrendered: true } }
    }]);
    if ( effect ) undo.createdEffects.push(effect.id);
  }
  if ( Object.keys(update).length ) await actor.update(update);
  return undo;
}

/**
 * The dnd5e statuses the engine plays (the ones it reads from a sheet and writes to one). A status not among them (dead,
 * one of another module's) an effect a player wrote doesn't carry onto another's sheet.
 */
const PLAYED_STATUSES = new Set(Object.values(WRITES));

/**
 * An effect from an item a player could write, as the engine plays it: its statuses and changes the engine reads, and
 * none of another module's flags (a macro to run, Midi-QOL's and DAE's own). The GM's client writes it onto a sheet the
 * player couldn't write to, so it carries nothing the fight didn't play out.
 */
function asPlayed(data) {
  data.statuses = (data.statuses ?? []).filter(s => PLAYED_STATUSES.has(s));
  data.changes = (data.changes ?? []).filter(c => modeledChange(c) && !/^macro\./i.test(String(c?.key ?? "")));
  data.flags = Object.fromEntries(Object.entries(data.flags ?? {}).filter(([scope]) => ["core", "dnd5e"].includes(scope)));
  return data;
}

/**
 * A buff or debuff laid this turn: the spell's own effects (the action's effectRef, options.effectSource), copied onto
 * the creature for the rounds it has, marked as laid by FastFighting (and by whom) so it comes off when it ends. From an
 * item a player could write, only as the engine played it (asPlayed).
 */
async function layEffect(actor, e, options, undo) {
  const ref = options?.effectSource?.(e.key)?.action?.effectRef;
  if ( !ref?.uuid ) return;
  let item = null;
  try {
    item = await fromUuid(ref.uuid);
  } catch ( err ) { /* gone */ }
  if ( item?.documentName !== "Item" ) return;
  const theirs = playersOf(item).length > 0;
  for ( const id of ref.ids ?? [] ) {
    const found = item.effects?.get(id)?.toObject();
    if ( !found ) continue;
    const data = theirs ? asPlayed(found) : found;
    delete data._id;
    Object.assign(data, {
      origin: item.uuid, transfer: false, disabled: false,
      // (For the rounds it has left; one with no end keeps the spell's own duration.)
      ...(Number.isFinite(e.rounds) ? { duration: { value: Math.max(1, Math.round(e.rounds)), units: "rounds", expiry: "turnStart" } } : {}),
      flags: { ...(data.flags ?? {}), [MODULE_ID]: { laid: { key: e.key, sourceId: e.sourceId ?? null } } }
    });
    const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    if ( made ) undo.createdEffects.push(made.id);
  }
}

/** A buff or debuff that ended this turn: the effects layEffect put on for it come off. */
async function liftEffect(actor, e, undo) {
  const laid = actor.effects.filter(x => {
    const mark = x.getFlag(MODULE_ID, "laid");
    return mark?.key === e.key && (mark.sourceId ?? null) === (e.sourceId ?? null);
  });
  if ( !laid.length ) return;
  undo.deletedEffects.push(...laid.map(x => x.toObject()));
  await actor.deleteEmbeddedDocuments("ActiveEffect", laid.map(x => x.id));
}

/* -------------------------------------------- */
/*  A player's damage card                      */
/* -------------------------------------------- */

/** What an actor holds of a kind (its items, its effects), each by its id. */
const byId = collection => new Map(Array.from(collection ?? [], d => [d.id, d]));

/**
 * A player's damage (or healing) card applied to a creature in a live battle, as dnd5e's own damage tray applies it:
 * the actor's applyDamage with the card's damages by type (so its resistances, immunities, vulnerabilities, damage
 * threshold and temporary hit points count), times `multiplier`, the card as its origin. Returns one undo record: hit
 * points, temporary and temporary maximum as they were (and the death saves, which healing from 0 clears), what came
 * and went of its items and effects, and its statuses before (dnd5e lays Bloodied, Dead or Unconscious by itself).
 */
export async function applyDnd5eDamageCard(message, tokenDoc, { multiplier = 1 } = {}) {
  const actor = tokenDoc?.actor;
  const attributes = actor?.system?.attributes;
  if ( !message || !attributes?.hp || typeof actor.applyDamage !== "function" ) return [];
  const damages = damagesOf(message);
  if ( !damages.length ) return [];
  // (The stored values, as dnd5e itself works from: the prepared ones may be capped.)
  const source = actor.system._source?.attributes ?? actor._source?.system?.attributes ?? attributes;
  const hp = source.hp ?? attributes.hp;
  const undo = undoRecord(tokenDoc, actor);
  Object.assign(undo.actorUpdate, {
    "system.attributes.hp.value": hp.value ?? attributes.hp.value ?? 0, "system.attributes.hp.temp": hp.temp ?? 0, "system.attributes.hp.tempmax": hp.tempmax ?? 0
  });
  const death = source.death ?? attributes.death;
  if ( death && (Number(attributes.hp.value) || 0) <= 0 ) {
    Object.assign(undo.actorUpdate, { "system.attributes.death.success": death.success ?? 0, "system.attributes.death.failure": death.failure ?? 0 });
  }
  const kinds = [["items", "createdItems", "deletedItems"], ["effects", "createdEffects", "deletedEffects"]];
  const had = kinds.map(([kind]) => byId(actor[kind]));
  await actor.applyDamage(damages, { multiplier: Number.isFinite(multiplier) ? multiplier : 1, isDelta: true, originatingMessage: message, origin: message });
  kinds.forEach(([kind, created, deleted], i) => {
    const now = byId(actor[kind]);
    for ( const id of now.keys() ) if ( !had[i].has(id) ) undo[created].push(id);
    for ( const [id, d] of had[i] ) if ( !now.has(id) && typeof d?.toObject === "function" ) undo[deleted].push(d.toObject());
  });
  return [undo];
}

/* -------------------------------------------- */
/*  Giving something up                         */
/* -------------------------------------------- */

/** dnd5e's coins, each with its worth in copper, smallest first (the core's payFrom). */
export const COINS = Object.freeze([["cp", 1], ["sp", 10], ["ep", 50], ["gp", 100], ["pp", 1000]]);

/** Copper as coins a pocket would hold: gold, silver, copper. */
function coinsFor(copper) {
  return { gp: Math.floor(copper / 100), sp: Math.floor((copper % 100) / 10), cp: copper % 10 };
}

/** An item handed over, the dnd5e way (the core's handOverItem): not equipped, and out of any container it was in. */
function looseItem(data) {
  data.system.equipped = false;
  delete data.system.container;
}

/** Hand over what a creature was talked out of (or had stolen): coins, or one item. Returns undo records. */
export async function commitDnd5eConcession(giverDoc, receiverDoc, concession) {
  const giver = giverDoc?.actor;
  if ( !giver ) return [];
  if ( concession.kind !== "money" ) return handOverItem(giverDoc, receiverDoc, concession.item?.id, { prepare: looseItem });
  const receiver = receiverDoc?.actor ?? null;
  const records = [];
  const before = { ...giver.system.currency };
  const paid = payFrom(before, concession.amount, COINS);
  if ( !paid ) return [];
  const giverUndo = undoRecord(giverDoc, giver);
  giverUndo.actorUpdate["system.currency"] = before;
  await giver.update({ "system.currency": paid });
  records.push(giverUndo);
  if ( receiver ) {
    const got = { ...receiver.system.currency };
    const add = coinsFor(concession.amount);
    const receiverUndo = undoRecord(receiverDoc, receiver);
    receiverUndo.actorUpdate["system.currency"] = got;
    await receiver.update({ "system.currency": { ...got, gp: (got.gp ?? 0) + add.gp, sp: (got.sp ?? 0) + add.sp, cp: (got.cp ?? 0) + add.cp } });
    records.push(receiverUndo);
  }
  return records;
}
