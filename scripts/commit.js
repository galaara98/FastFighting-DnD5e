/**
 * D&D 5e: what a live battle changes, written onto a token's actor (one turn's changes, and anything handed over), each
 * write returning an undo record; and what a fight changes, in words, for the planner.
 *
 * Undo record shape (the core puts these back when the GM rewinds a turn or the encounter):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     createdEffects: [id], deletedEffects: [data], tokenUpdate, createdActors, createdTokens, deletedTokens,
 *     statuses: [{id, active}], combatant }
 */
import { MODULE_ID, STATUS, commonOutcome, outcomeLine, stillLine } from "./core.js";
import { t, conditionName, playersOf } from "./words.js";
import { modeledChange } from "./effects.js";
import { WRITES, SHEET_STATUSES, hasStatus, ownStatus, statusKeys, exhaustionLevels } from "./conditions.js";

/** Engine conditions a fight's summary names: the dnd5e statuses that outlast it. */
const LINGERING = { frightened: "frightened", poisoned: "poisoned", blinded: "blinded", restrained: "restrained", paralyzed: "paralyzed", stunned: "stunned", charmed: "charmed", controlled: "charmed", petrified: "petrified" };

const emptyRecord = (tokenDoc, actor) => ({
  tokenUuid: tokenDoc?.uuid ?? null, actorUuid: actor.uuid, actorUpdate: {}, itemUpdates: [], createdItems: [], deletedItems: [], createdEffects: [], deletedEffects: [],
  tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: [],
  statusesBefore: [...(actor.statuses ?? [])] // so Undo also lifts what dnd5e adds by itself (Prone with Unconscious)
});

/**
 * Whose side the token is on now, when words (or a quarrel) changed it: won over (switched sides), talked out of the
 * fight (it takes no side now), or a neutral that turned on the party. Null when nothing changed.
 * @returns {"friendly"|"hostile"|"neutral"|null}
 */
export function sideChange(final) {
  if ( final.swayed === "switched" ) return final.side === "friendly" ? "friendly" : "hostile";
  if ( final.side !== "neutralParty" || final.status === STATUS.DEAD ) return null;
  if ( final.against?.includes("friendly") ) return "hostile";
  return final.swayed === "neutral" ? "neutral" : null;
}
const DISPOSITIONS = { friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" };

/** What a fight changes on a creature, a line each, for the planner's summary. */
export function describeDnd5eOutcome(spec, final) {
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
    if ( used > 0 ) lines.push(outcomeLine("Uses", { n: used, what: resourceLabel(spec, key) }));
  }
  for ( const [id, left] of Object.entries(final.uses ?? {}) ) {
    const a = spec.actions.find(x => x.id === id);
    if ( a && Number.isFinite(a.uses) && left < a.uses ) lines.push(outcomeLine("Uses", { n: a.uses - left, what: a.name }));
  }
  for ( const e of final.effects ?? [] ) lines.push(stillLine(e));
  return lines;
}

/** What a used-up resource is called. */
function resourceLabel(spec, key) {
  if ( key === "fate" ) return spec.fateLabel ?? t("Inspiration");
  if ( key === "legres" ) return spec.standFirm?.label ?? t("LegendaryResistance");
  if ( key === "pact" ) return t("PactSlot");
  if ( key.startsWith("slots:") ) return t("SpellSlot", { level: key.split(":")[1] });
  return spec.resourceNames?.[key] ?? spec.actions.find(a => a.resource === key)?.name ?? key;
}

/**
 * A status put on (unless it shows already) or taken off, by its own effect. One that's only part of another's
 * (Incapacitated with Stunned) isn't its to take off: nothing would come off, and the undo record would put it on.
 */
async function setStatus(actor, id, active, undo, { overlay = false } = {}) {
  if ( active ? actor.statuses?.has(id) : !ownStatus(actor, id) ) return;
  await actor.toggleStatusEffect(id, { active, overlay });
  undo.statuses.push({ id, active: !active, overlay });
}

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
 * surrendering, a change of side.
 * @returns {Promise<object>} an undo record (its shape at the top of this file)
 */
export async function commitDnd5eChanges(tokenDoc, spec, changes, final, options = {}) {
  const actor = tokenDoc.actor;
  const undo = emptyRecord(tokenDoc, actor);
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
  const side = changes.side ? sideChange(final) : null;
  if ( side ) {
    undo.tokenUpdate = { ...(undo.tokenUpdate ?? {}), disposition: tokenDoc.disposition };
    await tokenDoc.update({ disposition: CONST.TOKEN_DISPOSITIONS[DISPOSITIONS[side]] });
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
/*  Giving something up                         */
/* -------------------------------------------- */

const COINS = [["cp", 1], ["sp", 10], ["ep", 50], ["gp", 100], ["pp", 1000]];

/** Pay `amount` copper from a purse: small coins first, breaking a bigger coin (and taking change) when needed. */
export function payFrom(currency, amount) {
  const purse = Object.fromEntries(COINS.map(([k]) => [k, Number(currency?.[k]) || 0]));
  let owed = amount;
  for ( const [k, v] of COINS ) {
    const n = Math.min(purse[k], Math.floor(owed / v));
    purse[k] -= n;
    owed -= n * v;
  }
  // Still owed less than one of the coins left: break the smallest coin that covers it and take the change in copper.
  if ( owed > 0 ) {
    const coin = COINS.find(([k, v]) => purse[k] > 0 && v >= owed);
    if ( !coin ) return null;
    purse[coin[0]] -= 1;
    let change = coin[1] - owed;
    for ( const [k, v] of [...COINS].reverse() ) {
      if ( v >= coin[1] ) continue;
      const n = Math.floor(change / v);
      purse[k] += n;
      change -= n * v;
    }
    owed = 0;
  }
  return purse;
}

/** Copper as coins a pocket would hold: gold, silver, copper. */
function coinsFor(copper) {
  return { gp: Math.floor(copper / 100), sp: Math.floor((copper % 100) / 10), cp: copper % 10 };
}

/** Hand over what a creature was talked out of (or had stolen): coins, or one item. Returns undo records. */
export async function commitDnd5eConcession(giverDoc, receiverDoc, concession) {
  const giver = giverDoc?.actor;
  if ( !giver ) return [];
  const receiver = receiverDoc?.actor ?? null;
  const records = [];
  if ( concession.kind === "money" ) {
    const before = { ...giver.system.currency };
    const paid = payFrom(before, concession.amount);
    if ( !paid ) return [];
    const giverUndo = emptyRecord(giverDoc, giver);
    giverUndo.actorUpdate["system.currency"] = before;
    await giver.update({ "system.currency": paid });
    records.push(giverUndo);
    if ( receiver ) {
      const got = { ...receiver.system.currency };
      const add = coinsFor(concession.amount);
      const receiverUndo = emptyRecord(receiverDoc, receiver);
      receiverUndo.actorUpdate["system.currency"] = got;
      await receiver.update({ "system.currency": { ...got, gp: (got.gp ?? 0) + add.gp, sp: (got.sp ?? 0) + add.sp, cp: (got.cp ?? 0) + add.cp } });
      records.push(receiverUndo);
    }
    return records;
  }
  const item = giver.items.get(concession.item?.id);
  if ( !item ) return [];
  const giverUndo = emptyRecord(giverDoc, giver);
  const data = item.toObject();
  delete data._id;
  data.system.quantity = 1;
  data.system.equipped = false;
  delete data.system.container;
  if ( (item.system.quantity ?? 1) > 1 ) {
    giverUndo.itemUpdates.push({ id: item.id, update: { "system.quantity": item.system.quantity } });
    await item.update({ "system.quantity": item.system.quantity - 1 });
  } else {
    giverUndo.deletedItems.push(item.toObject());
    await item.delete();
  }
  records.push(giverUndo);
  if ( receiver ) {
    const receiverUndo = emptyRecord(receiverDoc, receiver);
    const [created] = await receiver.createEmbeddedDocuments("Item", [data]);
    if ( created ) receiverUndo.createdItems.push(created.id);
    records.push(receiverUndo);
  }
  return records;
}
