/**
 * The words this helper reads dnd5e's own text by, where an item's structured data says nothing (when an aura goes
 * off and what it takes, which saves a feature gives advantage on): reading/en.json always, and the reader's
 * language's reading/<lang>.json tried first when there is one (a creature's text may be in either, as it was
 * imported). Like the core's keywords, a translation is a copy of the file, nothing else. Loaded once, at startup;
 * whatever reads an actor waits for it.
 *
 * Each file is an object of sections ({"auras": {...}}); a section is whatever its reader takes. Merged, all the way
 * down: a list, the reader's language's entries first, then the English ones; a word ({pattern}) in both, either
 * pattern (the reader's language's tried first); an object, key by key. Whatever a file lacks is the other file's.
 */
import { language } from "./core.js";

const MODULE_ID = "fast-fighting-dnd5e";

let loaded = mergeReading();
let loading = null;

const isObject = v => !!v && typeof v === "object" && !Array.isArray(v);
const isWord = v => isObject(v) && typeof v.pattern === "string";

/** One reading file and another (the reader's language's first), merged all the way down. */
export function mergeReading(english = null, local = null) {
  const out = {};
  for ( const key of new Set([...Object.keys(english ?? {}), ...Object.keys(local ?? {})]) ) {
    const en = english?.[key];
    const own = local?.[key];
    if ( key.startsWith("$") ) continue;
    if ( Array.isArray(en) || Array.isArray(own) ) out[key] = [...(Array.isArray(own) ? own : []), ...(Array.isArray(en) ? en : [])];
    else if ( isWord(en) && isWord(own) ) out[key] = { ...en, ...own, pattern: `(?:${own.pattern})|(?:${en.pattern})` };
    else if ( isObject(en) && isObject(own) ) out[key] = mergeReading(en, own);
    else if ( isObject(en) || isObject(own) ) out[key] = mergeReading(isObject(en) ? en : null, isObject(own) ? own : null);
    else out[key] = own ?? en;
  }
  return out;
}

/** A reading file from this module's reading/ folder, or nothing if there isn't one. */
async function fetchFile(lang) {
  try {
    const response = await fetch(`modules/${MODULE_ID}/reading/${lang}.json`);
    return response.ok ? await response.json() : null;
  } catch ( err ) {
    return null;
  }
}

/** Read the files (once; called at startup, and by whatever needs them first). */
export function loadReading() {
  loading ??= (async () => {
    const lang = language();
    const english = await fetchFile("en");
    if ( !english ) console.warn(`${MODULE_ID} | reading/en.json could not be read`);
    loaded = mergeReading(english, lang && lang !== "en" ? await fetchFile(lang) : null);
    return loaded;
  })();
  return loading;
}

/** The reading words, once they're read. */
export const reading = () => loadReading();

/** The reading words as they are now (none, before they're read). */
export const currentReading = () => loaded;

/** For tests: the words to read by, as given (a file's contents, or a merge). */
export function setReading(words) {
  loaded = mergeReading(words);
  loading = Promise.resolve(loaded);
}
