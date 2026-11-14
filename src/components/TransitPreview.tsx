import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {Clock} from './Clock';
import {TransitWidget} from './TransitWidget';
import {useFreeSpace} from '../hooks/useFreeSpace';
import {readTransitCache, type Board} from '../lib/transit';
import type {TimeFormat} from '../lib/clock';
import type {ClockConfig} from '../lib/storage';
import type {TransitConfig} from '../lib/transitconfig';
import type {ThemeName} from '../theme/tokens';
import type {WeatherView} from '../lib/weather';
import {LAYOUT} from '../theme/tokens';

const REREAD_MS = 10000;   // the saved boards are read again this often (the home screen's board keeps them fresh)
const BETWEEN = 18;        // space between the board and the miniature screen

interface Props {
	config: TransitConfig;
	clock: ClockConfig;
	theme: ThemeName;
	now: Date;
	format: TimeFormat;
	weather: WeatherView | null;
}

/** Settings -> Transit: the board as it looks (colour, font, size, opacity, shadow), scaled to the free space right of the rows,
 *  and under it a miniature of the whole screen with the clock and the board at their real positions. Nothing is fetched: the
 *  saved departures are shown (made-up sample rows when there are none yet). Same measuring as WidgetPreview. */
export function TransitPreview ({config, clock, theme, now, format, weather}: Props) {
	const free = useFreeSpace(1392);
	// read once for both widgets (each would otherwise parse the saved boards itself every tick)
	const [saved, setSaved] = useState<Record<string, Board>>(readTransitCache);
	useEffect(() => {
		const timer = window.setInterval(() => setSaved(readTransitCache()), REREAD_MS);
		return () => window.clearInterval(timer);
	}, []);
	const boardRef = useRef<HTMLDivElement>(null);
	const [boardH, setBoardH] = useState(0);
	// the board's own height (it depends on the rows, size and font): measured after drawing
	useLayoutEffect(() => {
		const el = boardRef.current && boardRef.current.querySelector('.transit') as HTMLElement | null;
		const h = el ? el.offsetHeight : 0;
		if (h && h !== boardH) setBoardH(h);
	});
	if (!free) return null;
	const boardW = Math.round(30 * config.size / 100 * 17);
	const scale = Math.min(1, free.width / boardW);
	const screenScale = free.width / LAYOUT.screenWidth;
	const t = `scale(${scale.toFixed(4)})`;
	const ts = `scale(${screenScale.toFixed(4)})`;
	const alone = {...config, align: 'left' as const, left: 0, top: 0};
	return (
		<div class="transit-preview" style={{left: `${free.left}px`, width: `${free.width}px`}} aria-hidden="true">
			<div class="transit-preview__board" style={{height: `${Math.round(boardH * scale)}px`}}>
				<div ref={boardRef} class="transit-preview__strip" style={{width: `${boardW}px`, height: `${boardH || 300}px`, transform: t, WebkitTransform: t}}>
					<TransitWidget preview saved={saved} config={alone} clock={clock} theme={theme} />
				</div>
			</div>
			<div class="transit-preview__screen" style={{marginTop: `${BETWEEN}px`, height: `${Math.round(LAYOUT.screenHeight * screenScale)}px`}}>
				<div class="transit-preview__strip" style={{width: `${LAYOUT.screenWidth}px`, height: `${LAYOUT.screenHeight}px`, transform: ts, WebkitTransform: ts}}>
					{clock.show && <Clock now={now} format={format} config={clock} weather={weather} />}
					{/* the miniature is too small to read the names: they do not slide here (one marquee loop, not two) */}
					<TransitWidget preview saved={saved} config={{...config, scrollNames: false}} clock={clock} theme={theme} />
				</div>
			</div>
		</div>
	);
}
