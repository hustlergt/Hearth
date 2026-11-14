// Fetching for the transit board: departures, stop search, and the poller that keeps the boards fresh. The requests go
// through weathernet's fetchText (XMLHttpRequest with a 10 s limit; on TVs that cannot verify modern certificates, the TV's
// own curl/wget when the Homebrew Channel is there). No fetch() and no URLSearchParams: Chromium 38 has neither.

import {fetchText} from './weathernet';
import {exactStation, isFiltered, LIMIT_FILTERED, LIMIT_PLAIN, locationsUrl, parseBoard, parseStations, stationboardUrl, type Board} from './transit';
import type {TransitLocation, TransitStation} from './transitconfig';

export function fetchBoard (stationId: string, limit: number, allowShell: boolean): Promise<Board> {
	return fetchText(stationboardUrl(stationId, limit), allowShell).then((text) => {
		const board = parseBoard(text, stationId, Date.now(), limit);
		if (!board) throw new Error('unreadable reply');
		return board;
	});
}

export function searchStations (query: string, allowShell: boolean): Promise<(TransitStation & {icon: string})[]> {
	if (query.trim().length < 2) return Promise.resolve([]);
	return fetchText(locationsUrl(query), allowShell).then(parseStations);
}

/** The id of a stop known only by name (the defaults): the exact name, else the first tram or bus stop found. */
export function resolveStation (name: string, allowShell: boolean): Promise<TransitStation | null> {
	return searchStations(name, allowShell).then((list) => {
		const exact = exactStation(list, name);
		if (exact) return exact;
		const stop = list.filter((s) => s.icon === 'tram' || s.icon === 'bus')[0];
		return stop ? {id: stop.id, name: stop.name} : null;
	});
}

// ----- the poller -----

export const POLL_MS = 60000;
/** after a failure (HTTP 429 or 5xx, no network, timeout): wait longer each time; the saved boards stay on screen meanwhile */
export const BACKOFF_MS: readonly number[] = [60000, 120000, 300000];

export interface PollTarget {
	id: string;
	limit: number;
}

export interface PollCallbacks {
	onBoard: (board: Board) => void;
	/** a target could not be fetched this round */
	onError: (id: string) => void;
}

/** The wait before the next round: the normal minute, or the back-off step for `failures` failed rounds in a row. */
export function nextDelay (failures: number): number {
	return failures === 0 ? POLL_MS : BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
}

/** One fetch per stop, however many locations use it; a stop shared by a filtered and an unfiltered location is fetched
 *  with the larger limit, so the filtered one still finds its lines. Stops without an id yet are left out. */
export function pollTargets (locations: TransitLocation[]): PollTarget[] {
	const targets: PollTarget[] = [];
	locations.forEach((l) => {
		if (!l.station || !l.station.id) return;
		const limit = isFiltered(l) ? LIMIT_FILTERED : LIMIT_PLAIN;
		const same = targets.filter((t) => t.id === l.station!.id)[0];
		if (same) same.limit = Math.max(same.limit, limit);
		else targets.push({id: l.station.id, limit});
	});
	return targets;
}

/** The back-off outlives one poller: the board stops the poller when the launcher goes to the background and starts a new
 *  one when it comes back, and that new one must not fetch at once while a failure back-off is still running. */
const lastRound = {key: '', failures: 0, at: 0};

const targetsKey = (targets: PollTarget[]): string => targets.map((t) => t.id + ':' + t.limit).join(',');

/** Notes how the last round for these targets went (exported for the tests). */
export function noteRound (key: string, failures: number, at: number): void {
	lastRound.key = key;
	lastRound.failures = failures;
	lastRound.at = at;
}

/** The first wait of a new poller: `requested`, or longer when the same targets are still in a failure back-off. */
export function resumeDelay (key: string, requested: number, now: number): number {
	if (lastRound.key !== key || !lastRound.failures) return requested;
	return Math.max(requested, lastRound.at + nextDelay(lastRound.failures) - now);
}

/** Fetches every target (after `firstDelayMs`, or after the rest of a running back-off), then once a minute. The caller stops
 *  it while the launcher is in the background and starts a new one when it comes back; a round that comes due while the page
 *  is hidden is skipped. Returns the stop function. */
export function startTransitPoller (targets: PollTarget[], allowShell: boolean, cb: PollCallbacks, firstDelayMs: number): () => void {
	const key = targetsKey(targets);
	let stopped = false;
	let timer = 0;
	let failures = lastRound.key === key ? lastRound.failures : 0;
	let running = false;

	const schedule = (ms: number) => {
		window.clearTimeout(timer);
		if (!stopped) timer = window.setTimeout(run, ms);
	};

	function run (): void {
		if (stopped || running) return;
		if (document.hidden) return;          // the caller starts a new poller when the launcher comes back
		running = true;
		let failed = false;
		let left = targets.length;
		const done = () => {
			if (--left > 0) return;
			running = false;
			if (stopped) return;
			failures = failed ? failures + 1 : 0;
			noteRound(key, failures, Date.now());
			schedule(nextDelay(failures));
		};
		if (!left) { running = false; return; }
		targets.forEach((t) => {
			fetchBoard(t.id, t.limit, allowShell).then(
				(board) => { if (!stopped) cb.onBoard(board); done(); },
				() => { failed = true; if (!stopped) cb.onError(t.id); done(); }
			);
		});
	}

	schedule(resumeDelay(key, firstDelayMs, Date.now()));
	return () => {
		stopped = true;
		window.clearTimeout(timer);
	};
}
