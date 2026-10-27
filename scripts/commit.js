/**
 * D&D 5e: what a live battle changes, written onto a token's actor (one turn's changes, a player's damage card, and
 * anything handed over), each write returning an undo record; and what a fight changes, in words, for the planner.
 *
 * Undo record shape (the core puts these back when the GM rewinds a turn or the encounter):
 *   { tokenUuid, actorUuid, actorUpdate, itemUpdates: [{id, update}], createdItems: [id], deletedItems: [data],
 *     createdEffects: [id], deletedEffects: [data], tokenUpdate, createdActors, createdTokens, deletedTokens,
 *     statuses: [{id, active}], combatant }
 */
import { MODULE_ID, STATUS, commonOutcome, outcomeLine, stillLine, toggleStatus, undoRecord, escapeHtml, inertHtml } from "./core.js";
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
 * A consumable after `used` of its pool (the adapter's: this one's charges left, then the rest of the stack's) as
 * dnd5e's own consumption leaves it: its charges spent first (`uses.spent`); one run out, the next of the stack begun
 * (quantity one less, none spent); the last run out, gone if it's autoDestroy, else kept with none left. One with no
 * charges: its quantity, gone at none. Returns {quantity, spent (undefined: no charges), gone}.
 */
export function itemSpent(system, used) {
  let quantity = Math.max(0, Number(system?.quantity ?? 1) || 0);
  const max = Number(system?.uses?.max) || 0;
  if ( !max ) {
    quantity = Math.max(0, quantity - used);
    return { quantity, spent: undefined, gone: quantity <= 0 };
  }
  let spent = Math.min(max, Math.max(0, Number(system.uses.spent) || 0));
  let left = used;
  while ( left > 0 && quantity > 0 ) {
    const take = Math.min(left, max - spent);
    spent += take;
    left -= take;
    if ( spent < max ) break;
    if ( quantity === 1 ) return { quantity, spent, gone: !!system.uses.autoDestroy };
    quantity -= 1;
    spent = 0;
  }
  return { quantity, spent, gone: false };
}

/**
 * The flag a creature knocked out under the 2024 rules carries while it lies Unconscious at 1 HP: FastFighting's own,
 * so Rewind puts it back. (An older one, in this module's scope, is still read, and cleared with it.)
 */
export const KNOCKED_OUT = "fast-fighting.knockedOut";
export const KNOCKED_OUT_BEFORE = "fast-fighting-dnd5e.knockedOut";

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
    // (A flag it didn't have goes back to none.)
    undo.actorUpdate[path] = before ?? (path.startsWith("flags.") ? null : 0);
  };
  // Knocked out under the 2024 rules: 1 HP and Unconscious, not 0 (the SRD 5.2's Knocking Out a Creature: rules.js
  // knockOut), marked so the sheet still reads as out of the fight (readLiveState) until it wakes: unmarked once it's
  // no longer down (up again, dead) or its Unconscious comes off.
  const knockedOut = spec.rulesVersion !== "legacy" && !!final.system?.knockedOut && final.status === STATUS.DOWN;
  const woke = final.status !== STATUS.DOWN || (changes.conditions?.cleared ?? []).includes("unconscious");
  if ( changes.hp ) set("system.attributes.hp.value", knockedOut ? Math.max(1, Number(changes.hp.to) || 0) : changes.hp.to);
  if ( knockedOut ) set(`flags.${KNOCKED_OUT}`, true);
  else if ( woke ) for ( const flag of [KNOCKED_OUT, KNOCKED_OUT_BEFORE] ) if ( foundry.utils.getProperty(actor, `flags.${flag}`) ) set(`flags.${flag}`, false);
  if ( changes.temp ) set("system.attributes.hp.temp", changes.temp.to ?? 0);
  // Death saves: where the turn left them (none for anyone standing or stable).
  // (A success changes nothing but the rules' own tallies: the change set's `system`, core API 24.)
  if ( actor.type === "character" && (changes.hp || changes.fell || changes.revived || changes.stable || changes.dying || changes.system) ) {
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
        const { quantity, spent, gone } = itemSpent(item.system, used);
        if ( gone ) {
          undo.deletedItems.push(item.toObject());
          await item.delete();
        } else {
          const was = { "system.quantity": item.system.quantity ?? 1 };
          const update = { "system.quantity": quantity };
          if ( spent !== undefined ) {
            was["system.uses.spent"] = item.system.uses?.spent ?? 0;
            update["system.uses.spent"] = spent;
          }
          undo.itemUpdates.push({ id: item.id, update: was });
          await item.update(update);
        }
      }
    }
  }
  // Legendary actions: what's left of this round's (rules.capture), written as spent.
  const legact = actor.system.resources?.legact;
  if ( changes.system && Number(legact?.max) > 0 && Number.isFinite(final.system?.legendaryLeft) ) {
    set("system.resources.legact.spent", Math.max(0, Math.min(Number(legact.max), Number(legact.max) - final.system.legendaryLeft)));
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
  // Who got which effect, from whom, where no roll of dnd5e's names it (core API 21).
  await tellGiven(tokenDoc, spec, changes, options);
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
  // (Its changes where they are: v14's system.changes, an older one's changes.)
  const played = list => list.filter(c => modeledChange(c) && !/^macro\./i.test(String(c?.key ?? "")));
  if ( Array.isArray(data.system?.changes) ) data.system.changes = played(data.system.changes);
  if ( Array.isArray(data.changes) || !Array.isArray(data.system?.changes) ) data.changes = played(data.changes ?? []);
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

/** Does a roll of dnd5e's own name whom an action's effect went to: a save's card, a check's, an attack's target? */
const rollNames = a => !!(a?.save || a?.check || a?.afflict?.save || a?.harm?.save || Number.isFinite(a?.bonus) || a?.kind === "strike" || a?.kind === "spell-attack");

/** An action that can go only to its user (Rage, a potion): its own card names whom it went to. */
const ownOnly = a => a?.targets === "self" || !!a?.selfOnly;

/**
 * A card naming who got which effect, from whoever gave it, after the action's own card: "Bless → Lem (blessed)". For
 * each effect laid this turn (the core's change set: `effects.added`, and `laid`, conditions an effect lays alone)
 * where no roll of dnd5e's names whom it went to (a buff, a debuff with no save: the action's card is its user's and
 * names only who it may go to), and for each the table settles itself (`left`, API 21: a player's character's at
 * another, Apply players' damage off), waiting for its players to apply it from the action's card (its effects tray).
 * Not one an action only its user can take laid on itself. Its effect linked, to drag onto the token, where the action
 * has one. To whom the core says (options.audience: the GMs alone where the one who gave it or the one who got it is
 * hidden from the players); a name the GM keeps secret, the GMs' alone. Nothing without the core's options (an older
 * core): no card.
 */
async function tellGiven(tokenDoc, spec, changes, options) {
  if ( typeof options?.tokenOf !== "function" || typeof options?.effectSource !== "function" ) return;
  const given = [
    ...[...(changes.effects?.added ?? []), ...(changes.laid ?? [])].map(e => ({ e, waits: false })),
    ...[...(changes.left?.effects ?? []), ...(changes.left?.laid ?? [])].map(e => ({ e, waits: true }))
  ];
  const Message = globalThis.CONFIG?.ChatMessage?.documentClass ?? globalThis.ChatMessage;
  for ( const { e, waits } of given ) {
    const action = options.effectSource(e.key)?.action;
    if ( !action || rollNames(action) || (ownOnly(action) && e.sourceId === spec.id) ) continue;
    const by = options.tokenOf(e.sourceId) ?? tokenDoc;
    const gm = [e.sourceId, spec.id].some(id => options.audience?.(id) === "gm");
    const secret = !!tokenDoc.actor?.getFlag?.("fast-fighting", "secretName");
    const name = escapeHtml(tokenDoc.name ?? "");
    const target = gm || !secret ? name : `<span data-visibility="gm">${name}</span>`;
    const words = t(waits ? "GivenWaits" : "Given", { action: escapeHtml(action.name ?? ""), target, effect: escapeHtml(e.label || action.name || "") });
    const link = effectLink(action);
    try {
      await Message.create({
        speaker: Message.getSpeaker({ token: by, actor: by.actor }),
        content: inertHtml(`<p>${words}</p>${link ? `<p>${link}</p>` : ""}`),
        ...(gm ? { whisper: (globalThis.game?.users ?? []).filter(u => u.isGM).map(u => u.id) } : {})
      });
    } catch ( err ) {
      console.error(`fast-fighting-dnd5e | naming who got ${action.name}`, err);
    }
  }
}

/** The effect an action lays (its effectRef's first), as a link to drag (Foundry's own anchor), or "" (none found). */
function effectLink(action) {
  const ref = action?.effectRef;
  for ( const id of ref?.ids ?? [] ) {
    let effect = null;
    try {
      effect = globalThis.fromUuidSync?.(`${ref.uuid}.ActiveEffect.${id}`) ?? null;
    } catch ( err ) { /* gone */ }
    if ( effect?.documentName === "ActiveEffect" && typeof effect.toAnchor === "function" ) return effect.toAnchor({ attrs: { draggable: "true" } }).outerHTML;
  }
  return "";
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
 * threshold and temporary hit points count), times `multiplier`, the card as its origin. In a turn FastFighting plays,
 * also a strike's damage card (rollDnd5eStrike) and an action's rolled once for all it catches (rollDnd5eDamage), each
 * target its share (a save's half). Nothing at a multiplier of 0. Returns one undo record: hit points, temporary and
 * temporary maximum as they were (and the death saves, which healing from 0 clears), what came and went of its items and
 * effects, and its statuses before (dnd5e lays Bloodied, Dead or Unconscious by itself).
 */
export async function applyDnd5eDamageCard(message, tokenDoc, { multiplier = 1, halve = false } = {}) {
  let times = Number.isFinite(multiplier) ? multiplier : 1;
  // (Halved by a reaction the target used against it, in a live battle: 5e's Uncanny Dodge.)
  if ( halve ) times *= 0.5;
  if ( !(times > 0) ) return [];
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
  await actor.applyDamage(damages, { multiplier: times, isDelta: true, originatingMessage: message, origin: message });
  kinds.forEach(([kind, created, deleted], i) => {
    const now = byId(actor[kind]);
    for ( const id of now.keys() ) if ( !had[i].has(id) ) undo[created].push(id);
    for ( const [id, d] of had[i] ) if ( !now.has(id) && typeof d?.toObject === "function" ) undo[deleted].push(d.toObject());
  });
  return [undo];
}
