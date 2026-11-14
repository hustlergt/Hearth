import {useEffect, useRef, useState} from 'preact/hooks';

export interface Search<T> {
	/** null: nothing searched yet (or reset) */
	results: T[] | null;
	busy: boolean;
	failed: boolean;
	/** searches now; `clear` empties the old results while it runs. Resolves with the list, or null when the search failed or
	 *  a newer one (or a reset) replaced it. */
	run: (text: string, clear?: boolean) => Promise<T[] | null>;
	/** searches once the typing has stopped for `ms` */
	runSoon: (text: string, ms: number) => void;
	/** back to "nothing searched"; a reply still on its way is ignored */
	reset: () => void;
}

/** Search as you type (CityPicker, TransitEntry): only the newest search's reply is used, and nothing is set after the
 *  screen has closed. */
export function useSearch<T> (search: (text: string) => Promise<T[]>): Search<T> {
	const [results, setResults] = useState<T[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const seq = useRef(0);
	const timer = useRef(0);
	const searchRef = useRef(search);
	searchRef.current = search;
	useEffect(() => () => { seq.current++; window.clearTimeout(timer.current); }, []);

	const run = (text: string, clear?: boolean): Promise<T[] | null> => {
		window.clearTimeout(timer.current);
		const mine = ++seq.current;
		if (clear) setResults([]);
		setBusy(true);
		setFailed(false);
		return searchRef.current(text).then(
			(list) => { if (mine !== seq.current) return null; setResults(list); setBusy(false); return list; },
			() => { if (mine !== seq.current) return null; setResults([]); setBusy(false); setFailed(true); return null; }
		);
	};
	const reset = () => {
		window.clearTimeout(timer.current);
		seq.current++;
		setResults(null);
		setBusy(false);
		setFailed(false);
	};
	const runSoon = (text: string, ms: number) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => { void run(text); }, ms);
	};
	return {results, busy, failed, run, runSoon, reset};
}
