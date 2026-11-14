import {useEffect, useState} from 'preact/hooks';
import {layoutSize, layoutX} from '../lib/fitscale';

/** clear space between the option list and a preview */
export const PREVIEW_GAP = 16;
/** clear space at the right of the screen */
export const PREVIEW_EDGE = 20;
/** narrower than this: no preview */
export const PREVIEW_MIN_W = 160;
/** the width a preview is given on a tab that has one: the rows panel is kept narrow enough to leave it */
export const PREVIEW_ROOM = 492;

/** The widest the rows panel may be on a tab with a preview, when the panel starts at `panelLeft` (layout px). */
export function previewPanelMax (panelLeft: number): number {
	return Math.floor(layoutSize().w - PREVIEW_EDGE - PREVIEW_ROOM - PREVIEW_GAP - panelLeft);
}

/** The free space right of the Settings option list (layout px), where a live preview is drawn (Widget, Transit). Measured
 *  from the list itself, so a preview never overlaps the rows; `fallbackRight` is used when the list is not found. */
export function useFreeSpace (fallbackRight: number): {left: number; width: number} | null {
	const [free, setFree] = useState<{left: number; width: number} | null>(null);
	useEffect(() => {
		const measure = () => {
			const list = document.querySelector('.options');
			const right = list ? layoutX(list.getBoundingClientRect().right) : fallbackRight;
			const left = Math.round(right + PREVIEW_GAP);
			const width = Math.floor(layoutSize().w - PREVIEW_EDGE - left);
			setFree((was) => (was && was.left === left && was.width === width ? was : {left, width}));
		};
		measure();
		const timer = window.setTimeout(measure, 150);      // the list may still be drawing when the tab opens
		window.addEventListener('resize', measure);
		return () => { window.clearTimeout(timer); window.removeEventListener('resize', measure); };
	}, [fallbackRight]);
	return free && free.width >= PREVIEW_MIN_W ? free : null;
}
