/**
 * D&D 5e "Make it So": write one simulated outcome onto a token's actor, returning an undo record.
 *
 * Undo record shape (consumed by the core's make-it-so.js):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     createdEffects: [id], tokenUpdate, createdActors, createdTokens, deletedTokens, statuses: [{id, active}], combatant }
 */
import { MODULE_ID, STATUS } from "./core.js";

/** Engine conditions that are dnd5e statuses worth leaving on a creature after the fight. */
const LINGERING = { frightened: "frightened", poisoned: "poisoned", blinded: "blinded", restrained: "restrained", paralyzed: "paralyzed", stunned: "stunned", charmed: "charmed", controlled: "charmed", petrified: "petrified" };

const emptyRecord = (tokenDoc, actor) => ({
  tokenUuid: tokenDoc?.uuid ?? null, actorUuid: actor.uuid, actorUpdate: {}, itemUpdates: [], createdItems: [], deletedItems: [], createdEffects: [],
  tokenUpdate: null, createdActors: [], createdTokens: [], deletedTokens: [], statuses: [],
  statusesBefore: [...(actor.statuses ?? [])] // so Undo also lifts what dnd5e adds by itself (Prone with Unconscious)
});

/**
 * Whose side the token is on after the fight, when words (or a quarrel) changed it: won over (switched sides), talked
 * out of the fight (it takes no side now), or a neutral that turned on the party. Null when nothing changed.
 * @returns {"friendly"|"hostile"|"neutral"|null}
 */
export function sideChange(final) {
  if ( final.swayed === "switched" ) return final.side === "friendly" ? "friendly" : "hostile";
  if ( final.side !== "neutralParty" || final.status === STATUS.DEAD ) return null;
  if ( final.against?.includes("friendly") ) return "hostile";
  return final.swayed === "neutral" ? "neutral" : null;
}
const SIDE_LINES = { friendly: "Switches sides (now friendly)", hostile: "Turned on the party (now hostile)", neutral: "Stands aside (now neutral)" };
const DISPOSITIONS = { friendly: "FRIENDLY", hostile: "HOSTILE", neutral: "NEUTRAL" };

/** Human-readable list of what will change, for the confirmation dialog. */
export function describeDnd5eOutcome(spec, final) {
  const lines = [];
  if ( final.hp !== spec.hp.value ) lines.push(`HP ${spec.hp.value} → ${final.hp}`);
  if ( final.status === STATUS.DEAD ) lines.push(spec.kind === "pc" ? "DIES" : "Dead");
  else if ( final.status === STATUS.FLED ) lines.push(spec.kind === "pc" ? "Retreated from the battle" : final.swayed ? "Talked into fleeing (token hidden)" : "Fled the battle (token hidden)");
  else if ( final.status === STATUS.SURRENDERED ) lines.push("Surrenders");
  else if ( final.status === STATUS.STOOD_DOWN ) lines.push("Stands down (talked out of fighting)");
  const changed = sideChange(final);
  if ( changed ) lines.push(final.swayed === "switched" ? `Switches sides (now ${changed})` : SIDE_LINES[changed]);
  if ( final.status === STATUS.DOWN ) {
    const s = final.system ?? {};
    lines.push(final.stable ? "Unconscious (stable)" : `Unconscious, death saves ${s.deathSuccesses ?? 0} ✓ ${s.deathFailures ?? 0} ✗`);
  }
  for ( const k of Object.keys(final.conditions ?? {}) ) if ( LINGERING[k] && !lines.includes(LINGERING[k]) ) lines.push(LINGERING[k]);
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const used = start - (final.resources?.[key] ?? start);
    if ( used > 0 ) lines.push(`Uses ${used}× ${key === "fate" ? (spec.fateLabel ?? "Inspiration") : key === "pact" ? "pact slot" : key.startsWith("slots:") ? `level ${key.split(":")[1]} slot` : spec.resourceNames?.[key] ?? spec.actions.find(a => a.resource === key)?.name ?? key}`);
  }
  for ( const [id, left] of Object.entries(final.uses ?? {}) ) {
    const a = spec.actions.find(x => x.id === id);
    if ( a && Number.isFinite(a.uses) && left < a.uses ) lines.push(`Uses ${a.uses - left}× ${a.name}`);
  }
  for ( const e of final.effects ?? [] ) lines.push(`Still ${e.label || "affected"} (${e.rounds} more round${e.rounds === 1 ? "" : "s"})`);
  return lines;
}

async function setStatus(actor, id, active, undo, { overlay = false } = {}) {
  if ( actor.statuses?.has(id) === active ) return;
  await actor.toggleStatusEffect(id, { active, overlay });
  undo.statuses.push({ id, active: !active, overlay });
}

/**
 * @param {TokenDocument} tokenDoc
 * @param {object} spec
 * @param {object} final
 * @param {object} options  {lootMode, corpseMode, fledMode}
 */
export async function commitDnd5eOutcome(tokenDoc, spec, final, options = {}) {
  const actor = tokenDoc.actor;
  const undo = emptyRecord(tokenDoc, actor);
  const sys = actor.system;
  const update = {};
  const set = (path, value) => {
    const before = foundry.utils.getProperty(actor, path);
    if ( before === value ) return;
    update[path] = value;
    undo.actorUpdate[path] = before ?? 0;
  };
  set("system.attributes.hp.value", final.hp);
  set("system.attributes.hp.temp", final.temp ?? 0);
  // Death saves: where the fight left them (reset for anyone standing or stable).
  const s = final.system ?? {};
  const down = final.status === STATUS.DOWN && !final.stable;
  if ( actor.type === "character" ) {
    set("system.attributes.death.success", down ? (s.deathSuccesses ?? 0) : 0);
    set("system.attributes.death.failure", down ? (s.deathFailures ?? 0) : 0);
  }
  // Spell slots used.
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    const left = final.resources?.[key] ?? start;
    if ( left === start ) continue;
    if ( key === "pact" ) set("system.spells.pact.value", left);
    else if ( key.startsWith("feature:") ) continue; // (a feature's uses: with the items, below)
    else if ( key === "fate" ) set("system.attributes.inspiration", left > 0);
    else if ( key.startsWith("slots:") ) set(`system.spells.spell${key.split(":")[1]}.value`, left);
  }
  // Conditions first, HP last: dnd5e reacts to an HP change by adding or removing Bloodied on its own, and on an
  // unlinked token two changes at once can overwrite each other.
  if ( final.status === STATUS.DOWN ) {
    await setStatus(actor, "unconscious", true, undo);
    await setStatus(actor, "prone", true, undo);
  } else if ( final.status === STATUS.STANDING && final.prone ) {
    await setStatus(actor, "prone", true, undo);
  }
  if ( final.status !== STATUS.DEAD ) {
    for ( const k of Object.keys(final.conditions ?? {}) ) if ( LINGERING[k] ) await setStatus(actor, LINGERING[k], true, undo);
  }

  // Death, fleeing, surrender, switching sides
  if ( final.status === STATUS.DEAD ) {
    await setStatus(actor, "dead", true, undo, { overlay: true });
    const combatant = game.combat?.getCombatantsByToken?.(tokenDoc)?.[0];
    if ( combatant && !combatant.defeated ) {
      await combatant.update({ defeated: true });
      undo.combatant = { uuid: combatant.uuid, defeated: false };
    }
  } else if ( final.status === STATUS.FLED && options.fledMode !== "leave" && spec.kind !== "pc" ) {
    undo.tokenUpdate = { hidden: tokenDoc.hidden };
    await tokenDoc.update({ hidden: true });
  } else if ( final.status === STATUS.SURRENDERED ) {
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: game.i18n.localize("FFDND5E.Surrendered"),
      img: "icons/svg/cancel.svg",
      description: game.i18n.localize("FFDND5E.SurrenderedHint"),
      flags: { [MODULE_ID]: { surrendered: true } }
    }]);
    if ( effect ) undo.createdEffects.push(effect.id);
  }
  const changed = sideChange(final);
  if ( changed ) {
    undo.tokenUpdate = { ...(undo.tokenUpdate ?? {}), disposition: tokenDoc.disposition };
    await tokenDoc.update({ disposition: CONST.TOKEN_DISPOSITIONS[DISPOSITIONS[changed]] });
  }
  await commitItems(actor, spec, final, undo);
  if ( Object.keys(update).length ) await actor.update(update);
  await lingeringEffects(actor, final, options, undo);
  return undo;
}

/** Buffs and debuffs still running when the fight ends stay on, copied from their spell, for the rounds left. */
async function lingeringEffects(actor, final, options, undo) {
  for ( const e of final.effects ?? [] ) {
    const ref = options?.effectSource?.(e.key)?.action?.effectRef;
    if ( !ref?.uuid ) continue;
    let item = null;
    try {
      item = await fromUuid(ref.uuid);
    } catch ( err ) { /* gone */ }
    for ( const id of ref.ids ?? [] ) {
      const data = item?.effects?.get(id)?.toObject();
      if ( !data ) continue;
      delete data._id;
      Object.assign(data, {
        origin: item.uuid, transfer: false, disabled: false,
        duration: { value: Math.max(1, e.rounds), units: "rounds", expiry: "turnStart" },
        flags: { ...(data.flags ?? {}), [MODULE_ID]: { lingering: true } }
      });
      const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      if ( made ) undo.createdEffects.push(made.id);
    }
  }
}

/** Potions and other consumables used, and limited-use features spent. */
async function commitItems(actor, spec, final, undo) {
  // Uses of a feature others draw on (Focus or ki for Stunning Strike, superiority dice for maneuvers).
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    if ( !key.startsWith("feature:") ) continue;
    const used = start - (final.resources?.[key] ?? start);
    const item = used > 0 ? actor.items.get(key.slice(8)) : null;
    if ( !item?.system.uses ) continue;
    const spent = item.system.uses.spent ?? 0;
    undo.itemUpdates.push({ id: item.id, update: { "system.uses.spent": spent } });
    await item.update({ "system.uses.spent": spent + used });
  }
  for ( const [key, start] of Object.entries(spec.resources ?? {}) ) {
    if ( !key.startsWith("item:") ) continue;
    const used = start - (final.resources?.[key] ?? start);
    if ( used <= 0 ) continue;
    const item = actor.items.get(key.slice(5));
    if ( !item ) continue;
    const quantity = Math.max(0, (item.system.quantity ?? 1) - used);
    if ( quantity <= 0 ) {
      undo.deletedItems.push(item.toObject());
      await item.delete();
    } else {
      undo.itemUpdates.push({ id: item.id, update: { "system.quantity": item.system.quantity } });
      await item.update({ "system.quantity": quantity });
    }
  }
  for ( const [id, left] of Object.entries(final.uses ?? {}) ) {
    const action = spec.actions.find(a => a.id === id);
    if ( !action?.itemId || !Number.isFinite(action.uses) || left >= action.uses ) continue;
    const item = actor.items.get(action.itemId);
    if ( !item?.system.uses ) continue;
    const spent = item.system.uses.spent ?? 0;
    undo.itemUpdates.push({ id: item.id, update: { "system.uses.spent": spent } });
    await item.update({ "system.uses.spent": spent + (action.uses - left) });
  }
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
