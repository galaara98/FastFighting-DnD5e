/**
 * Goods for the core's deals (API 26: behavior/deals.js, foundry/loot-drop.js): money and things taken off a sheet and
 * put on another (a creature's, a pile's), dnd5e's way; what a pile holds; and, for a player's dialog, a character's
 * skills and what it could hand over. Goods are {items: [item data], coins: {pp, gp, ep, sp, cp}} (null coins: none),
 * and on the way in, money (in copper: a team's purse's, on no sheet). Every change leaves undo records.
 * dnd5e has no loot pile of its own (no dropValuables): the core puts goods on the ground with Item Piles, or its own.
 */
import { undoRecord, payFrom } from "./core.js";
import { coin, skillName } from "./words.js";

/** dnd5e's physical item types (what can lie on the ground and change hands). */
export const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/** dnd5e's coins, each with its worth in copper, smallest first (the core's payFrom). */
export const COINS = Object.freeze([["cp", 1], ["sp", 10], ["ep", 50], ["gp", 100], ["pp", 1000]]);

/** Copper value of an item's price (dnd5e prices are {value, denomination}), for one of it. */
export function copperValue(price) {
  const per = Object.fromEntries(COINS);
  return Math.round((Number(price?.value) || 0) * (per[price?.denomination ?? "gp"] ?? 100));
}

/** Copper as coins a pocket would hold: gold, silver, copper. */
export function coinsFor(copper) {
  return { gp: Math.floor(copper / 100), sp: Math.floor((copper % 100) / 10), cp: copper % 10 };
}

/** All its coins, in copper. */
export const copperOf = currency => COINS.reduce((s, [k, v]) => s + (Number(currency?.[k]) || 0) * v, 0);

/** Any coins at all. */
const anyCoins = coins => !!coins && COINS.some(([k]) => (Number(coins[k]) || 0) > 0);

/** How many of it. */
const quantityOf = item => Math.max(0, Number(item.system?.quantity ?? 1) || 0);

/** Carried put away: not equipped (dnd5e has no other way of carrying), and not a container (its contents would go too). */
export const stowed = item => item.type !== "container" && !item.system?.equipped;

/** A thing as it lies on the ground or changes hands: not equipped, out of any container, so many of it. */
export function loose(data, count = null) {
  delete data._id;
  if ( count !== null ) data.system.quantity = count;
  if ( data.system.equipped !== undefined ) data.system.equipped = false;
  delete data.system.container;
  return data;
}

/**
 * Goods off a creature's sheet: the money (in coins, change made), and each thing, as many as asked (the core's
 * concessions: {kind: "money", amount} in copper, {kind: "item", item: {id}, count}). {goods, records}.
 */
export async function takeDnd5eGoods(tokenDoc, goods = []) {
  const actor = tokenDoc?.actor;
  if ( !actor?.system ) return { goods: null, records: [] };
  const records = [];
  let coins = null;
  const items = [];
  const money = goods.filter(g => g?.kind === "money").reduce((s, g) => s + (Number(g.amount) || 0), 0);
  const before = { ...(actor.system.currency ?? {}) };
  const amount = Math.min(money, copperOf(before));
  const paid = amount > 0 ? payFrom(before, amount, COINS) : null;
  if ( paid ) {
    const undo = undoRecord(tokenDoc, actor);
    undo.actorUpdate["system.currency"] = before;
    await actor.update({ "system.currency": paid });
    records.push(undo);
    coins = coinsFor(amount);
  }
  for ( const g of goods.filter(x => x?.kind === "item") ) {
    const item = actor.items.get(g.item?.id);
    // (Only what it carries put away: nothing held or worn changes hands, but off a fallen foe robbed.)
    if ( !item || !PHYSICAL.has(item.type) || (g.how !== "loot" && !stowed(item)) ) continue;
    const have = Math.max(1, quantityOf(item));
    const n = Math.max(1, Math.min(have, Number(g.count) || 1));
    const undo = undoRecord(tokenDoc, actor);
    items.push(loose(item.toObject(), n));
    if ( n < have ) {
      undo.itemUpdates.push({ id: item.id, update: { "system.quantity": have } });
      await item.update({ "system.quantity": have - n });
    } else {
      undo.deletedItems.push(item.toObject());
      await item.delete();
    }
    records.push(undo);
  }
  return { goods: items.length || coins ? { items, coins } : null, records };
}

/** Goods onto a sheet (a creature's, a pile's): each thing a new item, the coins added to its own. Undo records. */
export async function putDnd5eGoods(tokenDoc, goods) {
  const actor = tokenDoc?.actor;
  if ( !actor?.system || !goods ) return [];
  const records = [];
  const coins = { ...(goods.coins ?? {}) };
  // (Money in the smallest coin, a team's purse's: the coins people hand over, added to any given.)
  if ( Number(goods.money) > 0 ) for ( const [k, n] of Object.entries(coinsFor(Math.round(Number(goods.money)))) ) coins[k] = (Number(coins[k]) || 0) + n;
  if ( goods.items?.length ) {
    const undo = undoRecord(tokenDoc, actor);
    const made = await actor.createEmbeddedDocuments("Item", goods.items.map(d => loose(foundry.utils.deepClone(d))));
    undo.createdItems.push(...made.map(i => i.id));
    records.push(undo);
  }
  if ( anyCoins(coins) ) {
    const had = { ...(actor.system.currency ?? {}) };
    const undo = undoRecord(tokenDoc, actor);
    undo.actorUpdate["system.currency"] = had;
    const now = { ...had };
    for ( const [k] of COINS ) now[k] = (Number(had[k]) || 0) + (Number(coins[k]) || 0);
    await actor.update({ "system.currency": now });
    records.push(undo);
  }
  return records;
}

/** Everything a pile holds, as goods: its things, and its coins. Null: nothing to hold anything. */
export function dnd5eGoodsOf(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor?.system ) return null;
  const items = actor.items.filter(i => PHYSICAL.has(i.type)).map(i => loose(i.toObject()));
  const c = actor.system.currency ?? {};
  const coins = Object.fromEntries(COINS.map(([k]) => [k, Number(c[k]) || 0]));
  return { items, coins: anyCoins(coins) ? coins : null };
}

/**
 * What a pile holds, for the core's engine (API 27: a thief's, a scavenger's, a hungry creature's to go for): its money
 * (in copper) and each thing in it, containers aside, with how many and what each is worth (copper). Whatever way it's
 * carried: a pile's things are all there for the taking. {money, items: [{id, name, value, quantity}]}.
 */
export function dnd5ePileContents(tokenDoc) {
  const actor = tokenDoc?.actor;
  if ( !actor?.system ) return null;
  const items = [];
  for ( const item of actor.items ) {
    if ( !PHYSICAL.has(item.type) || item.type === "container" || !(quantityOf(item) > 0) ) continue;
    items.push({ id: item.id, name: item.name, value: copperValue(item.system.price), quantity: quantityOf(item) });
  }
  return { money: copperOf(actor.system.currency), items };
}

/** Its skills, for a player's deal: {key, label, mod, talk} (talk: the core's kind of pitch the skill makes, or null). */
export function dnd5eSkillsOf(actor) {
  const talk = { per: "persuade", dec: "deceive", itm: "intimidate" };
  return Object.entries(actor?.system?.skills ?? {}).map(([key, s]) => ({ key, label: skillName(key), mod: Number(s?.total ?? s?.mod) || 0, talk: talk[key] ?? null }));
}

/** The coins a deal names, largest first: dnd5e's, but electrum (which few carry). */
export const denominations = () => [["pp", 1000], ["gp", 100], ["sp", 10], ["cp", 1]].map(([key, value]) => ({ key, label: coin(key), value }));

/**
 * What a character could hand over in a deal: its money (in copper), and each thing it carries put away (stowed: never
 * what it has equipped, nor a container), with how many and what each is worth (copper).
 */
export function dnd5eGiveables(actor) {
  const items = [];
  for ( const item of actor?.items ?? [] ) {
    if ( !PHYSICAL.has(item.type) || !stowed(item) || !(quantityOf(item) > 0) ) continue;
    items.push({ id: item.id, name: item.name, img: item.img, quantity: quantityOf(item), value: copperValue(item.system.price) });
  }
  return { money: copperOf(actor?.system?.currency), denominations: denominations(), items };
}

/**
 * Hand over what a creature gave up (talked out of it, robbed of it, a deal: the core's concession): coins (with change
 * made), or a thing, as many as it says (its count, one if it doesn't), from the giver to the receiver (none: gone).
 * Returns undo records for both sides.
 */
export async function commitDnd5eConcession(giverDoc, receiverDoc, concession) {
  const taken = await takeDnd5eGoods(giverDoc, [concession]);
  return [...taken.records, ...(receiverDoc?.actor?.system ? await putDnd5eGoods(receiverDoc, taken.goods) : [])];
}
