import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {Clock} from './Clock';
import {TransitWidget} from './TransitWidget';
import {layoutSize, layoutX} from '../lib/fitscale';
import type {TimeFormat} from '../lib/clock';
import type {ClockConfig} from '../lib/storage';
import type {TransitConfig} from '../lib/transitconfig';
import type {ThemeName} from '../theme/tokens';
import type {WeatherView} from '../lib/weather';
import {LAYOUT} from '../theme/tokens';

const GAP = 16;            // clear space between the option list and the preview
const EDGE = 20;           // clear space at the right of the screen
const MIN_W = 160;         // narrower than this: no preview
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
	const [free, setFree] = useState<{left: number; width: number} | null>(null);
	const boardRef = useRef<HTMLDivElement>(null);
	const [boardH, setBoardH] = useState(0);
	useEffect(() => {
		const measure = () => {
			const list = document.querySelector('.options');
			const right = list ? layoutX(list.getBoundingClientRect().right) : 1392;
			const left = Math.round(right + GAP);
			const width = Math.floor(layoutSize().w - EDGE - left);
			setFree((was) => (was && was.left === left && was.width === width ? was : {left, width}));
		};
		measure();
		const timer = window.setTimeout(measure, 150);      // the list may still be drawing when the tab opens
		window.addEventListener('resize', measure);
		return () => { window.clearTimeout(timer); window.removeEventListener('resize', measure); };
	}, []);
	// the board's own height (it depends on the rows, size and font): measured after drawing
	useLayoutEffect(() => {
		const el = boardRef.current && boardRef.current.querySelector('.transit') as HTMLElement | null;
		const h = el ? el.offsetHeight : 0;
		if (h && h !== boardH) setBoardH(h);
	});
	if (!free || free.width < MIN_W) return null;
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
					<TransitWidget preview config={alone} clock={clock} theme={theme} />
				</div>
			</div>
			<div class="transit-preview__screen" style={{marginTop: `${BETWEEN}px`, height: `${Math.round(LAYOUT.screenHeight * screenScale)}px`}}>
				<div class="transit-preview__strip" style={{width: `${LAYOUT.screenWidth}px`, height: `${LAYOUT.screenHeight}px`, transform: ts, WebkitTransform: ts}}>
					{clock.show && <Clock now={now} format={format} config={clock} weather={weather} />}
					<TransitWidget preview config={config} clock={clock} theme={theme} />
				</div>
			</div>
		</div>
	);
}
