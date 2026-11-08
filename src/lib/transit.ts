// The transit board's pure part: the timetable service's addresses, reading its replies, the line and direction filters,
// the countdown, and the saved copy. transitnet.ts does the fetching. Data: transport.opendata.ch (free, no key, CORS *).
//
// Old TV engines (Chromium 38): no fetch, no URLSearchParams, and Date.parse cannot read the service's "+0100" offsets, so
// addresses are built by hand and times come only from the numeric `departureTimestamp` (seconds) plus `delay` (minutes).

import type {TransitStation} from './transitconfig';

const BASE = 'https://transport.opendata.ch/v1/';

/** One departure as kept (and saved): only what the board shows. */
export interface Departure {
	/** line, e.g. "8", "N11" */
	line: string;
	to: string;
	/** "T" tram, "B" bus, ... */
	category: string;
	operator: string;
	/** scheduled departure, seconds since 1970 */
	ts: number;
	/** minutes late (0 when the service does not know) */
	delay: number;
	/** the stop's platform letter ("A".."K"), '' when not given */
	platform: string;
	/** the service gave a delay (real-time data); false = timetable only */
	live: boolean;
}

/** What one location shows: the same three filters as its settings. */
export interface DepartureFilter {
	lines: string;
	direction: string;
	platform: string;
}

export interface Board {
	stationId: string;
	/** null: the service does not know this stop */
	stationName: string | null;
	departures: Departure[];
	/** when it was fetched (ms since 1970) */
	at: number;
	/** how many departures were asked for (a filter turned on needs a longer list: fetched again at once) */
	limit: number;
}

/** An empty filter fetches 15; a filter fetches 40, so enough are left to fill the rows. */
export const LIMIT_PLAIN = 15;
export const LIMIT_FILTERED = 40;

/** Only these fields are asked for: a full reply is about 130 KB for 15 departures (each lists every later stop); this is about 3 KB. */
const FIELDS = ['station/id', 'station/name', 'stationboard/number', 'stationboard/to', 'stationboard/category', 'stationboard/operator',
	'stationboard/stop/departureTimestamp', 'stationboard/stop/delay', 'stationboard/stop/platform'];

const q = (name: string, value: string): string => encodeURIComponent(name) + '=' + encodeURIComponent(value);

export function stationboardUrl (stationId: string, limit: number): string {
	const parts = [q('id', stationId), q('limit', String(limit)), q('transportations[]', 'tram'), q('transportations[]', 'bus')];
	FIELDS.forEach((f) => parts.push(q('fields[]', f)));
	return BASE + 'stationboard?' + parts.join('&');
}

export function locationsUrl (query: string): string {
	return BASE + 'locations?' + q('query', query.trim().slice(0, 60)) + '&' + q('type', 'station');
}

const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) ? x : null);
const str = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');

/** Reads a stationboard reply; null when it isn't one. */
export function parseBoard (json: string, stationId: string, now: number, limit: number): Board | null {
	try {
		const data = JSON.parse(json);
		if (!data || !Array.isArray(data.stationboard)) return null;
		const station = data.station && typeof data.station.name === 'string' ? data.station.name : null;
		const departures: Departure[] = [];
		data.stationboard.forEach((e: Record<string, unknown>) => {
			const stop = (e && e.stop) as Record<string, unknown> | undefined;
			const ts = stop ? num(stop.departureTimestamp) : null;
			const line = str(e && e.number).trim();
			if (ts === null || !line) return;
			const delay = stop ? num(stop.delay) : null;
			departures.push({line: line.slice(0, 8), to: str(e.to).slice(0, 80), category: str(e.category).slice(0, 4), operator: str(e.operator).slice(0, 12), ts,
				delay: delay !== null && delay > 0 ? Math.round(delay) : 0, platform: str(stop && stop.platform).trim().slice(0, 6), live: delay !== null});
		});
		return {stationId, stationName: station, departures, at: now, limit};
	} catch {
		return null;
	}
}

/** Reads a locations reply into stops (tram and bus stops first, in the service's order). */
export function parseStations (json: string): (TransitStation & {icon: string})[] {
	try {
		const data = JSON.parse(json);
		const list = data && Array.isArray(data.stations) ? data.stations : [];
		const out: (TransitStation & {icon: string})[] = [];
		list.forEach((s: Record<string, unknown>) => {
			const id = str(s && s.id);
			if (!id || !/^[0-9A-Za-z:_-]{1,40}$/.test(id) || typeof s.name !== 'string' || !s.name) return;
			out.push({id, name: s.name.slice(0, 80), icon: str(s.icon)});
		});
		return out;
	} catch {
		return [];
	}
}

/** The stop whose name is exactly `name` (case and accents ignored); a train station of the same place is not taken for a tram stop. */
export function exactStation (list: TransitStation[], name: string): TransitStation | null {
	const want = fold(name);
	for (const s of list) if (fold(s.name) === want) return {id: s.id, name: s.name};
	return null;
}

/** Lower case without accents: "Barfüsserplatz" and "barfusserplatz" are the same. */
export function fold (s: string): string {
	const lower = s.toLowerCase();
	return typeof lower.normalize === 'function' ? lower.normalize('NFD').replace(/[̀-ͯ]/g, '') : lower;
}

/** "1, 8, N11" -> ["1", "8", "n11"] (also used for platforms: "C, D") */
export function parseLines (filter: string): string[] {
	return filter.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function isFiltered (f: DepartureFilter): boolean {
	return parseLines(f.lines).length > 0 || f.direction.trim().length > 0 || parseLines(f.platform).length > 0;
}

/** Departures that pass the line filter (exact line number, any case), the direction filter (part of the destination, accents
 *  ignored) and the platform filter (exact platform letters, any case). */
export function filterDepartures (list: Departure[], f: DepartureFilter): Departure[] {
	const wanted = parseLines(f.lines);
	const platforms = parseLines(f.platform);
	const dir = fold(f.direction.trim());
	return list.filter((d) => (wanted.length === 0 || wanted.indexOf(d.line.toLowerCase()) !== -1)
		&& (platforms.length === 0 || platforms.indexOf(d.platform.toLowerCase()) !== -1)
		&& (!dir || fold(d.to).indexOf(dir) !== -1));
}

/** When it really leaves: the timetable time plus the delay, in ms. */
export function leavesAt (d: Departure): number {
	return (d.ts + d.delay * 60) * 1000;
}

/** Whole minutes until it leaves (0 in its last minute); negative once it has left. */
export function minutesLeft (d: Departure, now: number): number {
	return Math.floor((leavesAt(d) - now) / 60000);
}

/** What the board shows: filtered, without the ones that have left, sorted by when they really leave, the first `rows`. */
export function upcoming (list: Departure[], f: DepartureFilter, rows: number, now: number): Departure[] {
	return filterDepartures(list, f)
		.filter((d) => leavesAt(d) >= now)
		.sort((a, b) => leavesAt(a) - leavesAt(b))
		.slice(0, rows);
}

/** The destination without the stop's own town: at "Basel, Barfüsserplatz", "Basel, Neuweilerstrasse" reads "Neuweilerstrasse";
 *  another town ("Weil am Rhein, Bahnhof/Zentrum") is kept, since that is the useful part. Case and accents are ignored. */
export function shortDestination (to: string, stationName: string | null | undefined): string {
	const comma = stationName ? stationName.indexOf(',') : -1;
	if (!stationName || comma <= 0) return to;
	const town = stationName.slice(0, comma).trim();
	const prefix = town + ',';
	if (fold(to.slice(0, prefix.length)) !== fold(prefix)) return to;
	const rest = to.slice(prefix.length).trim();
	return rest || to;
}

/** Marquee for a name `overflow` px too wide for its column: still for `pauseMs`, then sliding left at `speed` px/s until its end
 *  shows, still again, then back to the start. Returns the offset (px, 0 or negative) at `elapsedMs`. */
export const MARQUEE_SPEED = 45;
export const MARQUEE_PAUSE_MS = 2500;
export function marqueeOffset (elapsedMs: number, overflow: number, speed = MARQUEE_SPEED, pauseMs = MARQUEE_PAUSE_MS): number {
	if (overflow <= 0) return 0;
	const travel = overflow / speed * 1000;
	const cycle = pauseMs + travel + pauseMs;
	const t = ((elapsedMs % cycle) + cycle) % cycle;
	if (t < pauseMs) return 0;
	if (t < pauseMs + travel) return -Math.round((t - pauseMs) / travel * overflow);
	return -Math.round(overflow);
}

/** "3'" or "3 min" (callers show an icon for 0). */
export function countdownText (minutes: number, format: 'tick' | 'min'): string {
	const m = Math.max(0, minutes);
	return format === 'min' ? m + ' min' : m + '\'';
}

// ----- the saved copy (one key for every stop, so the board is drawn at once at start) -----

export const TRANSIT_CACHE_KEY = 'customlauncher-transit-v1';
/** An older copy than this is not shown. */
export const CACHE_MAX_MS = 3 * 60 * 60 * 1000;

/** A saved board, if it is not too old (and not from the future: a clock that was set back). */
export function usableBoard (board: Board | null | undefined, now: number): Board | null {
	return board && now - board.at < CACHE_MAX_MS && now >= board.at - 60000 ? board : null;
}

function cleanBoard (v: unknown): Board | null {
	if (!v || typeof v !== 'object') return null;
	const b = v as Record<string, unknown>;
	if (typeof b.stationId !== 'string' || num(b.at) === null || !Array.isArray(b.departures)) return null;
	const departures = (b.departures as Record<string, unknown>[]).filter((d) => d && typeof d.line === 'string' && num(d.ts) !== null).map((d) => ({
		line: d.line as string, to: str(d.to), category: str(d.category), operator: str(d.operator), ts: d.ts as number, delay: num(d.delay) || 0,
		platform: str(d.platform), live: d.live !== false          // a copy saved before these fields: shown as real-time, without platforms
	}));
	return {stationId: b.stationId, stationName: typeof b.stationName === 'string' ? b.stationName : null, departures, at: b.at as number, limit: num(b.limit) || 0};
}

export function readTransitCache (): Record<string, Board> {
	const out: Record<string, Board> = {};
	try {
		const raw = localStorage.getItem(TRANSIT_CACHE_KEY);
		if (!raw) return out;
		const data = JSON.parse(raw);
		if (!data || typeof data !== 'object') return out;
		for (const id in data) { const b = cleanBoard(data[id]); if (b && b.stationId === id) out[id] = b; }
	} catch { /* unreadable: start empty */ }
	return out;
}

/** Saves the boards of the stops in use (others are dropped, so the copy never grows). */
export function writeTransitCache (boards: Record<string, Board>, keep: string[]): void {
	const out: Record<string, Board> = {};
	keep.forEach((id) => { if (boards[id]) out[id] = boards[id]; });
	try { localStorage.setItem(TRANSIT_CACHE_KEY, JSON.stringify(out)); } catch { /* storage full: it is just fetched again */ }
}
