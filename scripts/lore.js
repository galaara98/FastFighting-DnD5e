/**
 * The Lore-Collector's payoff for sizing a foe up in 5e: how much likelier its next rolls are to succeed, a
 * world setting from 1.25× to 3×. The default: Study takes the whole turn and works only a little over half the time, so the payoff has to be large to be worth it.
 */
import { numberSetting } from "./core.js";

export const LORE_BOOST = Object.freeze({ min: 1.25, max: 3, step: 0.05, default: 2.5 });

const setting = numberSetting("fast-fighting-dnd5e", "loreBoost", {
  ...LORE_BOOST, name: "FFDND5E.Settings.loreBoost.Name", hint: "FFDND5E.Settings.loreBoost.Hint"
});

/** Register the setting (on init). */
export const registerLoreBoost = setting.register;

/** The world's setting, within its bounds (the default if there's none to read). */
export const loreBoost = setting.read;
