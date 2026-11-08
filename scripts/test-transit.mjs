// Tests for the transit board's pure parts (src/lib/transit.ts, transitconfig.ts, transitcolors.ts, transitnet.ts back-off)
// and the settings migration (loadConfig with and without the transit key).   Run: npm test
import {build} from 'esbuild';
const dir = new URL('../node_modules/', import.meta.url).pathname;
const src = (f) => new URL('../src/' + f, import.meta.url).pathname;
const stubApps = {name: 'stub-apps', setup (b) {
	b.onResolve({filter: /\.\/apps$/}, () => ({path: 'apps-stub', namespace: 'stub'}));
	b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const exec = () => Promise.reject(new Error("no shell"));', loader: 'js'}));
}};
const opts = {bundle: true, format: 'esm', platform: 'node', logLevel: 'error', define: {'import.meta.glob': '__glob'}, banner: {js: 'const __glob = () => ({});'}, plugins: [stubApps]};
await build({...opts, entryPoints: [src('lib/transit.ts')], outfile: dir + '.cache-transit-test.mjs'});
await build({...opts, entryPoints: [src('lib/transitconfig.ts')], outfile: dir + '.cache-transitconfig-test.mjs'});
await build({...opts, entryPoints: [src('lib/transitcolors.ts')], outfile: dir + '.cache-transitcolors-test.mjs'});
await build({...opts, entryPoints: [src('lib/transitnet.ts')], outfile: dir + '.cache-transitnet-test.mjs'});
await build({...opts, entryPoints: [src('lib/storage.ts')], outfile: dir + '.cache-transitstorage-test.mjs'});

const store = {};
globalThis.localStorage = {getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }};

const t = await import(dir + '.cache-transit-test.mjs');
const c = await import(dir + '.cache-transitconfig-test.mjs');
const col = await import(dir + '.cache-transitcolors-test.mjs');
const net = await import(dir + '.cache-transitnet-test.mjs');
const s = await import(dir + '.cache-transitstorage-test.mjs');
let fail = 0;
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } else console.log('ok  ', m); };

// ---- addresses (hand-built: Chromium 38 has no URLSearchParams) ----
const u = t.stationboardUrl('8500897', 15);
eq(u.indexOf('https://transport.opendata.ch/v1/stationboard?id=8500897&limit=15&transportations%5B%5D=tram&transportations%5B%5D=bus') === 0, true, 'stationboard address: id, limit, transportations%5B%5D twice');
eq(u.indexOf('fields%5B%5D=stationboard%2Fstop%2FdepartureTimestamp') > 0, true, 'only the fields the board needs are asked for');
eq(/^https:\/\/[A-Za-z0-9._\/?=&,%-]+$/.test(u), true, 'the address passes the shell fallback\'s safety check');
eq(t.locationsUrl('Basel, Barfüsserplatz'), 'https://transport.opendata.ch/v1/locations?query=Basel%2C%20Barf%C3%BCsserplatz&type=station', 'locations address is encoded');

// ---- reading replies (shape taken from a real reply, 2026-11-08) ----
const reply = JSON.stringify({station: {id: '8500897', name: 'Basel, Barfüsserplatz'}, stationboard: [
	{stop: {departureTimestamp: 1794131940, delay: 0, prognosis: {departure: '2026-11-08T10:59:00+0100'}}, category: 'T', number: '16', operator: 'BVB', to: 'Basel, Messeplatz'},
	{stop: {departureTimestamp: 1794132000, delay: 3}, category: 'T', number: '6', operator: 'BVB', to: 'Allschwil, Dorf'},
	{stop: {departureTimestamp: 1794132180, delay: null}, category: 'T', number: '11', operator: 'BLT', to: 'Basel, St-Louis Grenze'},
	{stop: {departureTimestamp: 1794132240, delay: 0}, category: 'B', number: 'N11', operator: 'BVB', to: 'Riehen, Grenze'},
	{stop: {departureTimestamp: null}, number: '99', to: 'broken'},
	{stop: {departureTimestamp: 1794132300}, number: '', to: 'no line'}
]});
const now0 = 1794131940 * 1000 - 30000;          // 30 s before the first departure
const b = t.parseBoard(reply, '8500897', now0, 15);
eq(b.limit, 15, 'the board remembers how many departures were asked for');
eq(b.departures.length, 4, 'entries without a time or a line are dropped');
eq([b.departures[1].line, b.departures[1].delay, b.departures[2].delay], ['6', 3, 0], 'delay in minutes; null delay reads as 0');
eq(b.stationName, 'Basel, Barfüsserplatz', 'station name kept');
eq(t.parseBoard('nope', 'x', 0, 15), null, 'garbage is not a board');
eq(t.parseBoard('{"station":null,"stationboard":[]}', 'x', 0, 15).stationName, null, 'unknown stop: station null (shown as "Stop not found")');

const stations = t.parseStations(JSON.stringify({stations: [{id: '8500010', name: 'Basel SBB', icon: 'train'}, {id: '8578143', name: 'Basel, Bahnhof SBB', icon: 'tram'}, {id: null, name: 'x'}, {id: '1;rm', name: 'evil'}]}));
eq(stations.map((x) => x.id), ['8500010', '8578143'], 'stations without a clean id are dropped');
eq(t.exactStation(stations, 'Basel, Bahnhof SBB'), {id: '8578143', name: 'Basel, Bahnhof SBB'}, 'the tram stop is found by its exact name, not the train station');
eq(t.exactStation(stations, 'basel, bahnhof sbb').id, '8578143', 'exact name ignores case');
eq(t.exactStation(stations, 'Basel'), null, 'a partial name is not an exact match');

// ---- filters ----
eq(t.parseLines(' 1, 8 ,N11,, '), ['1', '8', 'n11'], 'line filter: split, trimmed, lower case, empties dropped');
eq(t.filterDepartures(b.departures, '16, n11', '').map((d) => d.line), ['16', 'N11'], 'line filter: exact, case-insensitive');
eq(t.filterDepartures(b.departures, '1', '').length, 0, 'line filter: "1" does not match "16" or "11"');
eq(t.filterDepartures(b.departures, '', 'st-louis').map((d) => d.line), ['11'], 'direction filter: substring, case-insensitive');
eq(t.filterDepartures([{line: '3', to: 'Basel, Barfüsserplatz', ts: 1, delay: 0}], '', 'barfusser').length, 1, 'direction filter ignores accents (ü = u)');
eq(t.filterDepartures([{line: '3', to: 'Basel, Barfusserplatz', ts: 1, delay: 0}], '', 'Barfüsser').length, 1, 'direction filter ignores accents in the filter too');
eq(t.filterDepartures(b.departures, '', '').length, 4, 'empty filters: everything');
eq([t.isFiltered('', ''), t.isFiltered(' , ', ''), t.isFiltered('8', ''), t.isFiltered('', 'x')], [false, false, true, true], 'isFiltered (decides limit 15 or 40)');

// ---- countdown, delay, past departures ----
const dep = (ts, delay) => ({line: '8', to: 'x', category: 'T', operator: 'BVB', ts, delay});
eq(t.minutesLeft(dep(1000, 0), 1000 * 1000 - 30000), 0, 'less than a minute left: 0');
eq(t.minutesLeft(dep(1000, 0), 1000 * 1000 - 5 * 60000), 5, 'five minutes left');
eq(t.minutesLeft(dep(1000, 2), 1000 * 1000 - 5 * 60000), 7, 'delay is added: 5 + 2');
eq(t.minutesLeft(dep(1000, 0), 1000 * 1000 + 1000) < 0, true, 'after departure: negative');
const list = [dep(1000, 0), dep(1060, 0), dep(1030, 5), dep(1120, 0), dep(1200, 0)];
const up = t.upcoming(list, '', '', 3, 1000 * 1000 + 10000);
eq(up.map((d) => d.ts), [1060, 1120, 1200], 'gone departures dropped; sorted by real departure (1030 + 5 min = 1330 s comes last); first 3');
eq(t.upcoming(list, '', '', 6, 1000 * 1000 + 10000).map((d) => d.ts), [1060, 1120, 1200, 1030], 'the delayed one sorts by its real time');
eq(t.upcoming(list, '', '', 6, 1300 * 1000 + 1).length, 1, 'only the delayed one is still to come');
eq(t.upcoming(list, '', '', 4, 0).length, 4, 'rows limit');
eq([t.countdownText(3, 'tick'), t.countdownText(3, 'min'), t.countdownText(-2, 'tick')], ['3\'', '3 min', '0\''], 'countdown formats');

// ---- the saved copy ----
const board = {stationId: 'A', stationName: 'Stop A', departures: [dep(5, 1)], at: 1000000, limit: 40};
eq(!!t.usableBoard(board, 1000000 + t.CACHE_MAX_MS - 1), true, 'under 3 hours: shown');
eq(t.usableBoard(board, 1000000 + t.CACHE_MAX_MS + 1), null, 'over 3 hours: ignored');
eq(t.usableBoard(board, 1000000 - 120000), null, 'from the future: ignored');
t.writeTransitCache({A: board, B: {...board, stationId: 'B'}}, ['A']);
eq(Object.keys(JSON.parse(store[t.TRANSIT_CACHE_KEY])), ['A'], 'only the stops in use are saved');
eq([t.readTransitCache().A.departures[0].delay, t.readTransitCache().A.limit], [1, 40], 'saved boards read back (with their limit)');
store[t.TRANSIT_CACHE_KEY] = '{"A":{"stationId":"B","at":1,"departures":[]},"C":"x"}';
eq(t.readTransitCache(), {}, 'damaged or mismatched entries are dropped');
store[t.TRANSIT_CACHE_KEY] = 'nope';
eq(t.readTransitCache(), {}, 'an unreadable copy reads as empty');

// ---- back-off ----
eq([0, 1, 2, 3, 9].map(net.nextDelay), [60000, 60000, 120000, 300000, 300000], 'poll 60 s; after failures 60 -> 120 -> 300 s (max)');

// ---- line colours ----
eq(col.lineColor('nonexistent-line'), col.STATION_AMBER, 'unknown line: station amber');
eq(/^#[0-9A-F]{6}$/i.test(col.lineColor('8')), true, 'a listed line has a colour');

// ---- settings: defaults and migration ----
const d = c.cleanTransit(undefined);
eq([d.on, d.loc1.station, d.loc2On, d.loc2.station, d.cycleSec, d.rows, d.countdown, d.color], [false, {id: '', name: 'Basel, Barfüsserplatz'}, false, {id: '', name: 'Basel, Bahnhof SBB'}, 10, 4, 'tick', 'station'], 'defaults: off, the two Basel stops (ids looked up later), 10 s, 4 rows');
const g = c.cleanTransit({on: true, rows: 99, cycleSec: 7, size: 155, font: 'tv', color: 'neon', opacity: 5, loc1: {station: {id: '8500897', name: 'Basel, Barfüsserplatz'}, lines: '8', label: 42}, loc2: 'junk'});
eq([g.on, g.rows, g.cycleSec, g.size, g.font, g.color, g.opacity], [true, 4, 10, 100, 'clock', 'station', 0], 'out-of-range values fall back (TV font is not bundled, so not offered)');
eq([g.loc1.station.id, g.loc1.lines, g.loc1.label, g.loc2.station.name], ['8500897', '8', '', 'Basel, Bahnhof SBB'], 'locations cleaned; a broken one reads as its default');
eq(c.cleanTransit({loc1: {station: null}}).loc1.station, null, 'a cleared stop stays cleared');
eq(c.cleanTransit({loc1: {station: {id: 'a;b', name: 'X'}}}).loc1.station, {id: '', name: 'X'}, 'an unsafe id is dropped (the stop is looked up again)');

const KEY = 'customlauncher-config-v1';
store[KEY] = JSON.stringify({defaultsV: 1, theme: 'grey', weather: {on: false}});
const old = s.loadConfig();
eq([old.theme, old.transit.on, old.transit.rows], ['grey', false, 4], 'a config from before the board: other settings kept, transit at its defaults');
store[KEY] = JSON.stringify({defaultsV: 1, theme: 'grey', transit: {on: true, rows: 6, loc2On: true}});
const kept = s.loadConfig();
eq([kept.transit.on, kept.transit.rows, kept.transit.loc2On], [true, 6, true], 'saved transit settings are read back');
store[KEY] = JSON.stringify({theme: 'grey', transit: {on: true, rows: 6}});          // defaultsV missing: the one-time look reset runs
eq(s.loadConfig().transit.rows, 6, 'the one-time look reset keeps the transit settings (chosen stops are the user\'s own)');

process.exit(fail ? 1 : 0);
