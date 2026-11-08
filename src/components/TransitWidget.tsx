import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import type {ClockConfig} from '../lib/storage';
import type {ThemeName} from '../theme/tokens';
import {THEMES} from '../theme/tokens';
import {colorInfo, inkIsDark, validInk, type ClockColor} from '../lib/clockcolor';
import {fontFamily} from '../lib/clockfont';
import {countdownText, isFiltered, LIMIT_FILTERED, LIMIT_PLAIN, marqueeOffset, minutesLeft, readTransitCache, shortDestination, upcoming, usableBoard, writeTransitCache, type Board, type Departure} from '../lib/transit';
import {resolveStation, startTransitPoller, type PollTarget} from '../lib/transitnet';
import {lineColor, STATION_AMBER} from '../lib/transitcolors';
import type {TransitConfig, TransitLocation, TransitStation} from '../lib/transitconfig';
import {isWebOS} from '../lib/luna';
import {log} from '../lib/log';
import {t as tt} from '../i18n';

interface Props {
	config: TransitConfig;
	/** the clock's settings: shadow, and what "inherit" means for font, colour and opacity */
	clock: ClockConfig;
	theme: ThemeName;
	/** the launcher is in the background: nothing ticks */
	paused?: boolean;
	/** OLED shift offset (px), null = off */
	shift?: {x: number; y: number} | null;
	/** a default stop's id was looked up: the app saves it (not used by the preview) */
	onStation?: (which: 1 | 2, station: TransitStation) => void;
	/** the home screen's highlight is on the board (↑ from the apps): drawn with a frame */
	focused?: boolean;
	/** changes each time OK is pressed on the focused board: the other location shows and the timer starts again */
	toggle?: number;
	/** Settings preview: nothing is fetched; the saved boards are shown (sample rows when there are none) */
	preview?: boolean;
}

/** Base text size of the rows at 100 %, px at 1080p. */
const ROW_PX = 30;
/** Height of one row, em (the body is always as tall as the chosen number of rows, so the board does not jump when cycling). */
const ROW_EM = 1.55;
const TICK_MS = 10000;
const DELAY_INK = '#FF7A59';

function TransitGlyph ({kind, cls}: {kind: 'tram' | 'bus'; cls: string}) {
	return kind === 'bus'
		? <svg class={cls} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16M8 21v-3M16 21v-3" /><circle cx="8" cy="14.5" r="0.8" /><circle cx="16" cy="14.5" r="0.8" /></svg>
		: <svg class={cls} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6M12 2v3" /><rect x="5" y="5" width="14" height="13" rx="3" /><path d="M5 11h14M8 21l1.5-3M16 21l-1.5-3" /><circle cx="9" cy="14.5" r="0.8" /><circle cx="15" cy="14.5" r="0.8" /></svg>;
}

/** Dark text on a light badge, white on a dark one. */
const badgeInk = (bg: string): string => (inkIsDark(bg) ? '#FFFFFF' : '#111111');

/** The clock's own colour as a hex value ('Follow theme' = the theme's widget ink). */
function widgetInk (clock: ClockConfig, theme: ThemeName): string {
	const ink = validInk(clock.ink);
	if (ink) return ink;
	const info = colorInfo(clock.color);
	return info.color || (THEMES[theme] || THEMES.black).widgetInk;
}

interface Look {text: string; badge: (line: string) => string}

function lookOf (config: TransitConfig, clock: ClockConfig, theme: ThemeName): Look {
	const widget = widgetInk(clock, theme);
	if (config.color === 'station') return {text: STATION_AMBER, badge: () => STATION_AMBER};
	if (config.color === 'lines') return {text: widget, badge: lineColor};
	if (config.color === 'widget') return {text: widget, badge: () => widget};
	const preset = colorInfo(config.color as ClockColor).color || STATION_AMBER;
	return {text: widget, badge: () => preset};
}

/** Settings preview without saved data: a few made-up departures (Barfüsserplatz-like), so colours and sizes can be judged. */
function sampleBoard (id: string, now: number): Board {
	const t = Math.floor(now / 1000);
	const rows: [string, string, string, number, number][] = [['8', 'Weil am Rhein, Bahnhof/Zentrum', 'D', 0, 1], ['14', 'Pratteln, Schlossstrasse', 'C', 2, 3], ['3', 'Birsfelden, Hard', 'A', 0, 6],
		['11', 'Basel, St-Louis Grenze', 'D', 0, 9], ['6', 'Riehen, Grenze', 'D', 1, 12], ['16', 'Basel, Bruderholz', 'C', 0, 15]];
	return {stationId: id, stationName: 'Preview', at: now, limit: LIMIT_PLAIN,
		departures: rows.map(([line, to, platform, delay, min], i) => ({line, to, platform, delay, category: 'T', operator: 'BVB', ts: t + min * 60 + 20 - delay * 60, live: i !== 2}))};
}

type View =
	| {kind: 'rows'; rows: Departure[]; stale: boolean}
	| {kind: 'message'; text: string; stale?: boolean};

/** The departure board (Settings → Transit): one or two stops, alternating in the same place. The data is fetched once a
 *  minute; the minutes are counted down here, from the departure time and the delay, every few seconds. */
export function TransitWidget ({config, clock, theme, paused, shift, onStation, focused, toggle, preview}: Props) {
	const [boards, setBoards] = useState<Record<string, Board>>(readTransitCache);
	const [errors, setErrors] = useState<Record<string, boolean>>({});
	const [resolveFailed, setResolveFailed] = useState<Record<string, boolean>>({});
	const [now, setNow] = useState(Date.now());
	const [page, setPage] = useState(0);
	const allowShell = isWebOS();

	const locs: TransitLocation[] = config.loc2On ? [config.loc1, config.loc2] : [config.loc1];
	const cycling = locs.length > 1 && config.cycleSec > 0;
	const shown: TransitLocation[] = cycling ? locs : [config.loc1];
	const targets: PollTarget[] = [];
	shown.forEach((l) => {
		if (l.station && l.station.id && !targets.some((t) => t.id === l.station!.id)) targets.push({id: l.station.id, limit: isFiltered(l) ? LIMIT_FILTERED : LIMIT_PLAIN});
	});
	const targetKey = targets.map((t) => t.id + ':' + t.limit).join(',');
	const keepRef = useRef<string[]>([]);
	keepRef.current = targets.map((t) => t.id);

	// The default stops are known by name only: their ids are looked up once and saved (retried each minute until found).
	const onStationRef = useRef(onStation);
	onStationRef.current = onStation;
	const pending: {which: 1 | 2; name: string}[] = [];
	if (config.loc1.station && !config.loc1.station.id) pending.push({which: 1, name: config.loc1.station.name});
	if (cycling && config.loc2.station && !config.loc2.station.id) pending.push({which: 2, name: config.loc2.station.name});
	const pendingKey = pending.map((p) => p.which + ':' + p.name).join('|');
	const asking = useRef<Record<string, boolean>>({});          // names being looked up (one request per name, even when the effect runs again)
	// A reply is used whenever it arrives while the board is on screen (not only by the effect run that asked: the other stop's
	// answer re-runs the effect); the app ignores it when that stop was changed meanwhile.
	const alive = useRef(true);
	useEffect(() => () => { alive.current = false; }, []);
	const [retryTick, setRetryTick] = useState(0);
	useEffect(() => {
		if (preview || !pending.length || paused) return;
		pending.forEach((p) => {
			const key = p.which + ':' + p.name;
			if (asking.current[key]) return;
			asking.current[key] = true;
			resolveStation(p.name, allowShell).then((s) => {
				asking.current[key] = false;
				if (!alive.current) return;
				if (s) { log(`transit: stop "${p.name}" is ${s.id}`); if (onStationRef.current) onStationRef.current(p.which, s); }
				else setResolveFailed((r) => ({...r, [p.name]: true}));
			}, () => {
				asking.current[key] = false;
				if (!alive.current) return;
				setResolveFailed((r) => ({...r, [p.name]: true}));
				window.setTimeout(() => { if (alive.current) setRetryTick((n) => n + 1); }, 60000);          // tried again in a minute
			});
		});
	}, [pendingKey, paused, retryTick]);          // eslint-disable-line react-hooks/exhaustive-deps

	// Fetch the boards once a minute (paused in the background; back-off after failures, the saved boards stay shown).
	useEffect(() => {
		if (preview || !targets.length || paused) return undefined;
		const start = Date.now();
		const fresh = targets.every((t) => { const b = boards[t.id]; return !!b && b.limit >= t.limit && start - b.at < 30000 && start >= b.at; });
		const hasAny = targets.some((t) => !!usableBoard(boards[t.id], start));
		return startTransitPoller(targets, allowShell, {
			onBoard: (board) => {
				setBoards((prev) => {
					const next = {...prev, [board.stationId]: board};
					writeTransitCache(next, keepRef.current);
					return next;
				});
				setErrors((e) => (e[board.stationId] ? {...e, [board.stationId]: false} : e));
				setNow(Date.now());
			},
			onError: (id) => {
				log(`transit: departures for ${id} could not be fetched`);
				setErrors((e) => (e[id] ? e : {...e, [id]: true}));
			}
		}, fresh ? 30000 : hasAny ? 2000 : 0);
	}, [targetKey, paused]);          // eslint-disable-line react-hooks/exhaustive-deps

	// The countdown is worked out here, from the departure time and the delay. The preview also reads the saved boards again
	// (the home screen's board, still running underneath Settings, keeps them fresh).
	useEffect(() => {
		if (paused) return undefined;
		setNow(Date.now());
		const timer = window.setInterval(() => { setNow(Date.now()); if (preview) setBoards(readTransitCache()); }, TICK_MS);
		return () => window.clearInterval(timer);
	}, [paused]);          // eslint-disable-line react-hooks/exhaustive-deps

	// Location 1 and 2 take turns; OK on the focused board switches at once and starts the wait again.
	useEffect(() => { if (!cycling) setPage(0); }, [cycling]);
	const lastToggle = useRef(toggle);
	useEffect(() => {
		if (toggle === lastToggle.current) return;
		lastToggle.current = toggle;
		if (cycling) setPage((p) => (p + 1) % 2);
	}, [toggle]);          // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		if (!cycling || paused) return undefined;
		const timer = window.setInterval(() => setPage((p) => (p + 1) % 2), config.cycleSec * 1000);
		return () => window.clearInterval(timer);
	}, [cycling, config.cycleSec, paused, toggle]);

	// Long destinations slide to their end and back. Driven from script (Hearth's legacy CSS engine drops @keyframes, so a CSS
	// animation would not move on webOS 3.x): the offsets are written straight onto the elements, without redrawing the board;
	// the widths are measured about once a second; with nothing too long, it only looks again each second.
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		const setX = (el: HTMLElement, x: number) => {
			const v = x ? `translate3d(${x}px, 0, 0)` : '';
			if (el.style.transform === v) return;
			el.style.transform = v;
			el.style.webkitTransform = v;
		};
		const texts = () => root.querySelectorAll('.transit__to-text');
		if (!config.scrollNames || paused) { const all = texts(); for (let i = 0; i < all.length; i++) setX(all[i] as HTMLElement, 0); return undefined; }
		let stopped = false;
		let raf = 0;
		let timer = 0;
		let items: {el: HTMLElement; over: number}[] = [];
		let measuredAt = 0;
		const start = Date.now();
		const shownPage = (el: HTMLElement): boolean => {          // not on the page that is fading out (no Element.closest on Chromium 38)
			for (let n: HTMLElement | null = el; n && n !== root; n = n.parentNode as HTMLElement | null) if (n.className && String(n.className).indexOf('transit__page--off') !== -1) return false;
			return true;
		};
		const measure = () => {
			items = [];
			const all = texts();
			for (let i = 0; i < all.length; i++) {
				const el = all[i] as HTMLElement;
				const box = el.parentNode as HTMLElement;
				const over = el.offsetWidth - box.clientWidth;
				if (over > 1 && shownPage(el)) items.push({el, over}); else setX(el, 0);
			}
			measuredAt = Date.now();
		};
		const frame = () => {
			if (stopped) return;
			const now = Date.now();
			if (now - measuredAt > 1000) measure();
			for (const it of items) setX(it.el, marqueeOffset(now - start, it.over));
			if (items.length) raf = window.requestAnimationFrame(frame); else timer = window.setTimeout(frame, 1000);
		};
		measure();
		frame();
		return () => { stopped = true; window.cancelAnimationFrame(raf); window.clearTimeout(timer); };
	}, [config.scrollNames, paused, page]);

	const look = lookOf(config, clock, theme);
	const views: View[] = useMemo(() => shown.map((l): View => {
		const st = l.station;
		if (preview) {
			const saved = st && st.id ? usableBoard(boards[st.id], now) : null;
			const board = saved && saved.stationName !== null ? saved : sampleBoard(st ? st.id : '', now);
			const rows = upcoming(board.departures, l, config.rows, now);
			return rows.length ? {kind: 'rows', rows, stale: false} : {kind: 'message', text: isFiltered(l) ? tt('transit.noMatch') : tt('transit.noDepartures')};
		}
		if (!st) return {kind: 'message', text: tt('transit.notSet')};
		if (!st.id) return {kind: 'message', text: resolveFailed[st.name] ? tt('transit.unavailable') : tt('transit.loading')};
		const board = usableBoard(boards[st.id], now);
		const failed = !!errors[st.id];
		if (!board) return {kind: 'message', text: failed ? tt('transit.unavailable') : tt('transit.loading'), stale: failed};
		if (board.stationName === null) return {kind: 'message', text: tt('transit.notFound')};
		const rows = upcoming(board.departures, l, config.rows, now);
		if (!rows.length) return {kind: 'message', text: isFiltered(l) ? tt('transit.noMatch') : tt('transit.noDepartures'), stale: failed};
		return {kind: 'rows', rows, stale: failed};
	}), [boards, errors, resolveFailed, now, config, shown.length, preview]);          // eslint-disable-line react-hooks/exhaustive-deps

	// ----- look -----
	const px = Math.round(ROW_PX * config.size / 100);
	const ink = look.text;
	const darkInk = inkIsDark(ink);
	const style: Record<string, string> = {
		top: `${config.top}%`,
		left: `${config.left}%`,
		fontFamily: fontFamily(config.font === 'clock' ? clock.font : config.font),
		fontSize: `${px}px`,
		width: `${Math.round(px * 17)}px`,
		color: ink
	};
	let boxShadow = '';
	if (clock.shadow && !darkInk) {
		// the clock's shadow formula (Clock.tsx): strength 50 % = 40 % black, 8 px blur
		const a = (clock.shadowStrength * 0.008).toFixed(2);
		const blur = Math.round(4 + clock.shadowStrength * 0.08);
		style.textShadow = `0 2px ${blur}px rgba(0, 0, 0, ${a})`;
		boxShadow = `0 2px ${blur}px rgba(0, 0, 0, ${(clock.shadowStrength * 0.005).toFixed(2)})`;
	}
	const opacity = config.opacity > 0 ? config.opacity : clock.opacity;
	if (opacity < 100) style.opacity = String(opacity / 100);
	const base = config.align === 'center' ? 'translateX(-50%)' : config.align === 'right' ? 'translateX(-100%)' : '';
	const transform = (base + (shift ? ` translate3d(${shift.x}px, ${shift.y}px, 0)` : '')).trim();
	if (transform) { style.transform = transform; style.WebkitTransform = transform; }

	const label = (l: TransitLocation): string => l.label.trim() || (l.station ? l.station.name : tt('transit.title'));
	const kindOf = (v: View): 'tram' | 'bus' => (v.kind === 'rows' && v.rows.every((d) => d.category === 'B') ? 'bus' : 'tram');
	const bodyStyle = {minHeight: `${(config.rows * ROW_EM).toFixed(2)}em`};
	const destination = (l: TransitLocation, d: Departure): string => (config.shortNames ? shortDestination(d.to, l.station ? l.station.name : null) : d.to);

	const renderPage = (l: TransitLocation, v: View, i: number) => (
		<div key={i} class={`transit__page${cycling ? (i === page ? ' transit__page--on' : ' transit__page--off') : ''}`}>
			<div class="transit__head">
				<TransitGlyph kind={kindOf(v)} cls="transit__icon" />
				<span class="transit__stop">{label(l)}</span>
				{v.stale && <span class="transit__stale">{tt('transit.offline')}</span>}
				{cycling && <span class="transit__pager">{`${i + 1} / ${shown.length}`}</span>}
			</div>
			<div class="transit__rule" style={{background: ink}} />
			<div class="transit__body" style={bodyStyle}>
				{v.kind === 'message'
					? <div class="transit__message">{v.text}</div>
					: v.rows.map((d) => {
						const m = minutesLeft(d, now);
						const bg = look.badge(d.line);
						return (
							<div class="transit__row" key={d.line + d.to + d.ts}>
								<span class="transit__badge" style={{background: bg, color: badgeInk(bg), boxShadow: boxShadow || undefined}}>{d.line}</span>
								{config.scrollNames
									? <span class="transit__to transit__to--scroll"><span class="transit__to-text">{destination(l, d)}</span></span>
									: <span class="transit__to">{destination(l, d)}</span>}
								{config.showPlatform && <span class="transit__platform">{d.platform}</span>}
								<span class="transit__delay">{d.delay > 0 && <span class="transit__delay-badge" style={{background: DELAY_INK, boxShadow: boxShadow || undefined}}>{`+${d.delay}'`}</span>}</span>
								<span class={`transit__min${config.countdown === 'min' ? ' transit__min--wide' : ''}${d.live ? '' : ' transit__min--sched'}`}>
									{m <= 0 ? <TransitGlyph kind={d.category === 'B' ? 'bus' : 'tram'} cls="transit__now" /> : countdownText(m, config.countdown)}
								</span>
							</div>
						);
					})}
			</div>
		</div>
	);

	return (
		<div ref={rootRef} class={`transit${focused ? ' transit--focused' : ''}`} style={style}>
			<div class="transit__pages">
				{shown.map((l, i) => renderPage(l, views[i], i))}
			</div>
		</div>
	);
}

/** Can OK on the home screen switch the board's location? (two locations taking turns) */
export function transitSwitchable (config: TransitConfig | null | undefined): boolean {
	return !!config && config.on && config.loc2On && config.cycleSec > 0;
}
