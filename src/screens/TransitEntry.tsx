import {useCallback, useEffect, useRef, useState} from 'preact/hooks';
import {PickerIcon} from '../components/Glyph';
import {useKeys, clamp, type NavKey} from '../hooks/useKeys';
import {searchStations} from '../lib/transitnet';
import type {TransitStation} from '../lib/transitconfig';
import {t as tt} from '../i18n';

export type TransitField = 'station' | 'label' | 'lines' | 'direction';

interface Props {
	field: TransitField;
	/** 1 or 2: shown in the title */
	which: 1 | 2;
	/** the current text (label and filters), or the current stop's name */
	value: string;
	/** the search may go through the TV's shell when the web view cannot reach the service */
	allowShell: boolean;
	onStation: (station: TransitStation) => void;
	onText: (value: string) => void;
	onClose: () => void;
}

interface Row {
	key: string;
	kind: 'input' | 'station' | 'info' | 'clear';
	label: string;
	detail?: string;
	station?: TransitStation;
}

const VISIBLE_ROWS = 9;
const DEBOUNCE_MS = 400;
const MIN_CHARS = 2;

/** Settings → Transit: search for a stop (results appear while typing, with the TV's on-screen keyboard), or type a
 *  label or filter. ↑ ↓ choose, OK picks a stop or edits the text, Back returns. */
export function TransitEntry ({field, which, value, allowShell, onStation, onText, onClose}: Props) {
	const searching = field === 'station';
	const [typing, setTyping] = useState(true);
	const [query, setQuery] = useState(searching ? '' : value);
	const [results, setResults] = useState<TransitStation[] | null>(null);       // null: nothing searched yet
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [index, setIndex] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const timer = useRef(0);
	const seq = useRef(0);

	const rows: Row[] = [{key: 'input', kind: 'input', label: query || (searching ? tt('transit.searchHint') : tt('transit.emptyText')), detail: searching && value ? tt('transit.current', {name: value}) : undefined}];
	if (searching) {
		if (busy) rows.push({key: 'busy', kind: 'info', label: tt('citypicker.searching')});
		else if (failed) rows.push({key: 'failed', kind: 'info', label: tt('citypicker.couldNotSearch'), detail: tt('citypicker.checkTheTvS')});
		else if (results && results.length === 0) rows.push({key: 'none', kind: 'info', label: tt('transit.noStop')});
		(results || []).forEach((s) => rows.push({key: 's' + s.id, kind: 'station', label: s.name, station: s}));
	} else if (value) {
		rows.push({key: 'clear', kind: 'clear', label: tt('transit.clear')});
	}

	useEffect(() => { if (typing && input.current) { input.current.focus(); } }, [typing]);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const runSearch = (text: string) => {
		const mine = ++seq.current;
		if (text.trim().length < MIN_CHARS) { setResults(null); setBusy(false); setFailed(false); return; }
		setBusy(true);
		setFailed(false);
		searchStations(text, allowShell).then(
			(list) => { if (mine !== seq.current) return; setResults(list.map((s) => ({id: s.id, name: s.name}))); setBusy(false); },
			() => { if (mine !== seq.current) return; setResults([]); setBusy(false); setFailed(true); }
		);
	};

	const onInput = (e: Event) => {
		const text = (e.target as HTMLInputElement).value;
		setQuery(text);
		if (!searching) return;
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => runSearch(text), DEBOUNCE_MS);
	};

	const leaveField = (toResults: boolean) => {
		setTyping(false);
		if (input.current) input.current.blur();
		setIndex(toResults && rows.length > 1 ? 1 : 0);
	};

	const activate = (i: number) => {
		const row = rows[i];
		if (!row) return;
		if (row.kind === 'input') { setIndex(0); setTyping(true); }
		else if (row.kind === 'station' && row.station) onStation(row.station);
		else if (row.kind === 'clear') onText('');
	};

	const handleKey = useCallback((key: NavKey): boolean => {
		switch (key) {
			case 'up': setIndex((i) => clamp(i - 1, 0, Math.max(0, rows.length - 1))); break;
			case 'down': setIndex((i) => clamp(i + 1, 0, Math.max(0, rows.length - 1))); break;
			case 'enter': activate(index); break;
			case 'back': onClose(); break;
			default: break;
		}
		return true;
	}, [rows.length, index, results, busy, failed, query]);          // eslint-disable-line react-hooks/exhaustive-deps

	useKeys(handleKey, !typing);

	// In the text field: Enter (or the keyboard's Done) searches at once / saves the text; ↓ goes to the results; Back leaves the field.
	const onFieldKey = (e: KeyboardEvent) => {
		const text = (e.target as HTMLInputElement).value;
		if (e.keyCode === 13) {
			e.preventDefault();
			if (!searching) { onText(text.trim()); return; }
			window.clearTimeout(timer.current);
			if (text.trim().length >= MIN_CHARS && (results === null || busy || query !== text)) runSearch(text);
			leaveField(true);
		} else if (e.keyCode === 40 && searching) { e.preventDefault(); leaveField(true); }
		else if (e.keyCode === 461 || e.keyCode === 27) { e.preventDefault(); leaveField(false); }
	};

	const start = clamp(index - Math.floor(VISIBLE_ROWS / 2), 0, Math.max(0, rows.length - VISIBLE_ROWS));
	const visible = rows.slice(start, start + VISIBLE_ROWS);
	const title = tt(`transit.entry.${field}` as 'transit.entry.station', {n: which});

	return (
		<div class="screen screen--picker">
			<div class="settings">
				<h1 class="settings__title">{title}</h1>
				<p class="settings__hint">{typing ? (searching ? tt('transit.typingSearch') : tt('transit.typingText')) : (searching ? tt('transit.pickHint') : tt('transit.textHint'))}</p>
				<div class="picker__path">{searching ? tt('transit.entry.path') : tt(`transit.entry.${field}Desc` as 'transit.entry.labelDesc')}</div>
				<div class="picker">
					{visible.map((row, n) => {
						const i = start + n;
						const editing = typing && row.kind === 'input';
						return (
							<div
								key={row.key}
								class={`picker__row${i === index ? ' picker__row--focused' : ''}${row.kind === 'info' ? ' picker__row--info' : ''}`}
								onMouseEnter={() => { if (!typing) setIndex(i); }}
								onClick={() => { setIndex(i); activate(i); }}
							>
								<PickerIcon kind={row.kind === 'input' ? 'search' : row.kind === 'info' ? 'info' : row.kind === 'clear' ? 'default' : 'pin'} />
								<div class="picker__text">
									{editing
										? <input ref={input} class="picker__input" type="text" value={query} placeholder={searching ? tt('transit.stopName') : ''} maxLength={60} onInput={onInput} onKeyDown={onFieldKey} />
										: <div class="picker__label">{row.label}</div>}
									{!editing && row.detail && <div class="picker__detail">{row.detail}</div>}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
