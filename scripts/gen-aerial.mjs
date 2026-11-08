// Builds the Aerial video list and place names for the screen saver from a checkout of custom-screensaver-aerial
// (aabytt, MIT: https://github.com/aabytt/custom-screensaver-aerial). Not part of the build: run it by hand when the
// feed should be refreshed, and commit what it writes.
//
//   node scripts/gen-aerial.mjs <path to the custom-screensaver-aerial checkout>
//
// Writes public/saver/aerial/videos.json (one entry per clip: id, source, name key, place-name timestamps and one URL per
// quality, the fall-backs worked out here so the QML only picks a key) and public/saver/aerial/strings-<lang>.json (only
// the names those clips use, one file per Hearth language). The videos themselves are not copied: they are streamed
// from Apple, Amazon and the AerialCommunity releases when the saver plays.

import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/gen-aerial.mjs <custom-screensaver-aerial checkout>'); process.exit(1); }
const out = new URL('../public/saver/aerial/', import.meta.url).pathname;
mkdirSync(out, {recursive: true});

/** The feed's source names, as the short ids the settings and the QML use. */
const SOURCES = {'Apple Aerials': 'apple', 'Amazon Fire OS': 'amazon', 'Jetson Creative': 'jetson', 'Robin Fourcade': 'robin'};
/** Hearth's languages, and the aabytt locale file for each. */
const LOCALES = {en: 'en-US', ar: 'ar-AE', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', id: 'id-ID', pl: 'pl-PL', 'pt-BR': 'pt-BR', ru: 'ru-RU'};

const feed = JSON.parse(readFileSync(join(src, 'assets/videos.json'), 'utf8'));
const https = (u) => (typeof u === 'string' && /^https:\/\/[\x21-\x7e]+$/.test(u) && u.indexOf('"') === -1 ? u : '');
const assets = [];
const keys = new Set();
for (const a of feed.assets) {
	const source = SOURCES[a.source];
	if (!source) { console.warn(`skipped ${a.id}: unknown source "${a.source}"`); continue; }
	// Full HD: AVC first (every TV decodes it), then HEVC; 4K SDR; HDR / Dolby Vision. Each falls back to 4K SDR.
	const sdr4k = https(a['url-4K-SDR']);
	const hd = https(a['url-1080-H264']) || https(a['url-1080-SDR']) || sdr4k;
	const hdr = https(a['url-4K-HDR']) || https(a['url-1080-HDR']);
	if (!sdr4k && !hd) continue;
	const poi = {};
	for (const [t, k] of Object.entries(a.pointsOfInterest || {})) if (/^\d+$/.test(t)) { poi[t] = k; keys.add(k); }
	keys.add(a.localizedNameKey);
	const entry = {id: a.id, s: source, n: a.localizedNameKey, p: poi, hd, uhd: sdr4k || hd};
	if (hdr) entry.hdr = hdr;
	assets.push(entry);
}
writeFileSync(join(out, 'videos.json'), JSON.stringify({assets}));

for (const [lang, file] of Object.entries(LOCALES)) {
	const all = JSON.parse(readFileSync(join(src, 'assets/locales', file + '.json'), 'utf8')).strings || {};
	const strings = {};
	for (const k of [...keys].sort()) if (typeof all[k] === 'string' && all[k]) strings[k] = all[k];
	writeFileSync(join(out, `strings-${lang}.json`), JSON.stringify(strings));
}
const counts = {};
assets.forEach((a) => { counts[a.s] = (counts[a.s] || 0) + 1; });
console.log(`${assets.length} clips (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}), ${keys.size} names, ${Object.keys(LOCALES).length} languages`);
