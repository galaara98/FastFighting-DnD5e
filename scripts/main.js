/**
 * FastFighting D&D 5e: teaches FastFighting Core how Dungeons & Dragons Fifth Edition works.
 * Registers the dnd5e adapter (actor data, rules, personality defaults, leadership, live battles) through the
 * core's public API.
 */
import { Dnd5eAdapter } from "./adapter.js";
import { registerSettings, moveLoreBoost } from "./settings.js";
import { loadReading } from "./reading.js";
import { hideApply, hideApplyMenu } from "./cards.js";

export const MODULE_ID = "fast-fighting-dnd5e";

/**
 * The core API majors this helper is known to work with (the core's api.major). Its own call: the core never refuses a
 * helper. Older than the oldest, it doesn't run (it uses what came since); any other it doesn't know, it runs, and the
 * GM is told it hasn't been tried with that core yet. Add a major once this helper has been tried with it.
 */
const KNOWN_API = Object.freeze([35]);

/** The core's API major, when it's one this helper doesn't know: the GM is told when the world is ready. */
let untested = null;

/**
 * The last translation module we knew of for this game system, by language: in a language other than English, this
 * module's settings recommend it when it isn't on (FastFighting Core's api.adviseTranslation).
 */
const KNOWN_TRANSLATIONS = {
  es: { id: "translate-dnd5e-sdr2-es", title: "Translation: DnD5e SRD 5.2 2024 Spanish Translation (Babele)", url: "https://github.com/foundryvtt-sinregistrar/translate-dnd5e-sdr2-es" }
};

Hooks.once("init", () => {
  // The homebrew Delay (settings.js).
  registerSettings();
});

Hooks.once("fastFighting.init", api => {
  // module.json limits this module to dnd5e worlds; this guard covers anything that slips past.
  if ( game.system.id !== "dnd5e" ) {
    console.warn(`${MODULE_ID} | not a D&D Fifth Edition world (${game.system.id}); FastFighting D&D 5e stays inactive.`);
    return;
  }
  const major = Number(api.major) || 0;
  if ( major < Math.min(...KNOWN_API) ) {
    console.error(`${MODULE_ID} | FastFighting Core is too old for this version of FastFighting D&D 5e; update it.`);
    ui.notifications?.error(game.i18n.localize("FFDND5E.CoreTooOld"), { permanent: true });
    return;
  }
  if ( !KNOWN_API.includes(major) ) untested = major;
  api.registerAdapter("dnd5e", Dnd5eAdapter, { priority: 10, source: MODULE_ID });
  // The words dnd5e's own text is read by, where its data says nothing (reading.js).
  loadReading();
  // The cards FastFighting rolls and applies itself: no tray or Apply on them, which would apply them again (cards.js).
  // (dnd5e adds its trays after renderChatMessageHTML, then says so: dnd5e.renderChatMessage.)
  Hooks.on("renderChatMessageHTML", hideApply);
  Hooks.on("dnd5e.renderChatMessage", hideApply);
  Hooks.on("getChatMessageContextOptions", hideApplyMenu);
  api.adviseTranslation(MODULE_ID, game.system.title, KNOWN_TRANSLATIONS);
  // Words kept in English for now, while the system isn't translated (hardcoded-toEN.json).
  api.keepEnglish(MODULE_ID);
});

Hooks.once("ready", () => {
  moveLoreBoost();
  if ( untested !== null && game.user.isGM ) ui.notifications.warn(game.i18n.format("FFDND5E.CoreUntested", { major: untested }));
  if ( !game.modules.get("fast-fighting")?.active && game.user.isGM ) {
    ui.notifications.warn(game.i18n.localize("FFDND5E.NeedsCore"));
  }
});
