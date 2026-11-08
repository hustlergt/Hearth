// The transit board's settings (Settings → Transit): their shape, defaults and the check every saved value goes through
// (loadConfig calls cleanTransit, so a config from before this feature, or a damaged one, reads as the defaults).
// No addresses or fetching here: this file is in every build, the board itself only when TRANSIT_ENABLED.

import {BUILTIN_FONT_IDS} from './clockfont';
import {PLAIN_COLOR_IDS} from './clockcolor';
import type {ClockAlign} from './storage';

/** A stop as the timetable service knows it. `id` '' = not looked up yet (the default stops are found by name at first use). */
export interface TransitStation {
	id: string;
	name: string;
}

export interface TransitLocation {
	station: TransitStation | null;
	/** shown instead of the stop's name ('' = the stop's name) */
	label: string;
	/** comma-separated line numbers ('' = every line) */
	lines: string;
	/** part of a destination's name ('' = every direction) */
	direction: string;
}

/** 'station' = BVB station amber; 'lines' = each line's own colour; 'widget' = the clock's colour; or one of the plain widget colours */
export type TransitColor = string;
export type TransitCountdown = 'tick' | 'min';

export interface TransitConfig {
	on: boolean;
	loc1: TransitLocation;
	/** Location 2 is shown too (alternating with Location 1) */
	loc2On: boolean;
	loc2: TransitLocation;
	/** seconds between the two locations; 0 = Location 1 only */
	cycleSec: number;
	rows: number;
	countdown: TransitCountdown;
	color: TransitColor;
	align: ClockAlign;
	/** % of the screen width (the board's left edge, centre or right edge, following `align`), like the clock's position */
	left: number;
	/** % of the screen height */
	top: number;
	/** % of the standard text size */
	size: number;
	/** 'clock' = the clock's typeface, else a bundled font id */
	font: string;
	/** % (0 = the widget opacity of the clock) */
	opacity: number;
}

export const TRANSIT_CYCLE_VALUES: readonly number[] = [0, 5, 8, 10, 15, 20, 30, 60];
export const TRANSIT_ROW_VALUES: readonly number[] = [2, 3, 4, 5, 6];
export const TRANSIT_SIZE_VALUES: readonly number[] = [70, 80, 90, 100, 110, 120, 130, 140, 150];
export const TRANSIT_OPACITY_VALUES: readonly number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const TRANSIT_LEFT_VALUES: readonly number[] = steps(0, 100, 2);
export const TRANSIT_TOP_VALUES: readonly number[] = steps(0, 90, 2);
export const TRANSIT_COLOR_IDS: readonly string[] = ['station', 'lines', 'widget'].concat(PLAIN_COLOR_IDS);
/** Only fonts shipped with Hearth ('tv' is the TV's own font, not bundled) */
export const TRANSIT_FONT_IDS: readonly string[] = ['clock'].concat(BUILTIN_FONT_IDS.filter((id) => id !== 'tv'));

function steps (min: number, max: number, step: number): number[] {
	const out: number[] = [];
	for (let v = min; v <= max; v += step) out.push(v);
	return out;
}

/** The default stops: looked up by name the first time the board is on (ids are never guessed). */
export const DEFAULT_STOP_1 = 'Basel, Barfüsserplatz';
export const DEFAULT_STOP_2 = 'Basel, Bahnhof SBB';

const location = (name: string): TransitLocation => ({station: {id: '', name}, label: '', lines: '', direction: ''});

export const DEFAULT_TRANSIT: TransitConfig = {
	on: false,             // off on a fresh install, like the weather
	loc1: location(DEFAULT_STOP_1),
	loc2On: false,
	loc2: location(DEFAULT_STOP_2),
	cycleSec: 10,
	rows: 4,
	countdown: 'tick',
	color: 'station',
	align: 'right',
	left: 96,
	top: 6,
	size: 100,
	font: 'clock',
	opacity: 0
};

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const oneOf = <T>(list: readonly T[], v: unknown, def: T): T => (list.indexOf(v as T) !== -1 ? (v as T) : def);

function cleanStation (v: unknown): TransitStation | null {
	if (!v || typeof v !== 'object') return null;
	const s = v as {id?: unknown; name?: unknown};
	const id = typeof s.id === 'string' && /^[0-9A-Za-z:_-]{0,40}$/.test(s.id) ? s.id : '';
	const name = text(s.name, 80);
	return name ? {id, name} : null;
}

function cleanLocation (v: unknown, def: TransitLocation): TransitLocation {
	if (!v || typeof v !== 'object') return {...def, station: def.station ? {...def.station} : null};
	const l = v as Partial<Record<keyof TransitLocation, unknown>>;
	return {
		station: l.station === undefined ? (def.station ? {...def.station} : null) : cleanStation(l.station),
		label: text(l.label, 60),
		lines: text(l.lines, 80),
		direction: text(l.direction, 60)
	};
}

/** A saved transit config made safe: anything missing or out of range reads as its default (existing users lose nothing, crash on nothing). */
export function cleanTransit (saved: unknown): TransitConfig {
	const d = DEFAULT_TRANSIT;
	if (!saved || typeof saved !== 'object') return {...d, loc1: cleanLocation(null, d.loc1), loc2: cleanLocation(null, d.loc2)};
	const t = saved as Partial<Record<keyof TransitConfig, unknown>>;
	return {
		on: t.on === true,
		loc1: cleanLocation(t.loc1, d.loc1),
		loc2On: t.loc2On === true,
		loc2: cleanLocation(t.loc2, d.loc2),
		cycleSec: oneOf(TRANSIT_CYCLE_VALUES, t.cycleSec, d.cycleSec),
		rows: oneOf(TRANSIT_ROW_VALUES, t.rows, d.rows),
		countdown: t.countdown === 'min' ? 'min' : 'tick',
		color: oneOf(TRANSIT_COLOR_IDS, t.color, d.color),
		align: t.align === 'left' || t.align === 'center' || t.align === 'right' ? t.align : d.align,
		left: oneOf(TRANSIT_LEFT_VALUES, t.left, d.left),
		top: oneOf(TRANSIT_TOP_VALUES, t.top, d.top),
		size: oneOf(TRANSIT_SIZE_VALUES, t.size, d.size),
		font: oneOf(TRANSIT_FONT_IDS, t.font, d.font),
		opacity: oneOf(TRANSIT_OPACITY_VALUES, t.opacity, d.opacity)
	};
}
