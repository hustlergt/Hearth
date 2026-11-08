// Fetching for the transit board: departures, stop search, and the poller that keeps the boards fresh. The requests go
// through weathernet's fetchText (XMLHttpRequest with a 10 s limit; on TVs that cannot verify modern certificates, the TV's
// own curl/wget when the Homebrew Channel is there). No fetch() and no URLSearchParams: Chromium 38 has neither.

import {fetchText} from './weathernet';
import {exactStation, locationsUrl, parseBoard, parseStations, stationboardUrl, type Board} from './transit';
import type {TransitStation} from './transitconfig';

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

/** Fetches every target now (after `firstDelayMs`), then once a minute. Paused while the page is hidden; fetched again at once
 *  when it shows. Returns the stop function. */
export function startTransitPoller (targets: PollTarget[], allowShell: boolean, cb: PollCallbacks, firstDelayMs: number): () => void {
	let stopped = false;
	let timer = 0;
	let failures = 0;
	let running = false;

	const schedule = (ms: number) => {
		window.clearTimeout(timer);
		if (!stopped) timer = window.setTimeout(run, ms);
	};

	function run (): void {
		if (stopped || running) return;
		if (document.hidden) return;          // coming back to the front starts it again (onVisibility)
		running = true;
		let failed = false;
		let left = targets.length;
		const done = () => {
			if (--left > 0) return;
			running = false;
			if (stopped) return;
			failures = failed ? failures + 1 : 0;
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

	const onVisibility = () => {
		if (document.hidden) window.clearTimeout(timer);
		else schedule(0);
	};
	document.addEventListener('visibilitychange', onVisibility);
	schedule(firstDelayMs);
	return () => {
		stopped = true;
		window.clearTimeout(timer);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
