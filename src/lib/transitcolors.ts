// Line colours for Settings → Transit → Colour style → "BVB line colours". Edit freely: key = the line number exactly as the
// timetable service gives it ("8", "N11", ...), value = '#RRGGBB'. A line that is not listed is drawn in station amber.
//
// IMPORTANT: none of these values come from an official BVB/BLT source. They are rough approximations from memory of the
// network map and MUST be checked against the current BVB/BLT network map before anyone relies on them.

export const STATION_AMBER = '#FFB000';

export const LINE_COLORS: Record<string, string> = {
	'1': '#8B5A2B',     // TODO verify
	'2': '#A0522D',     // TODO verify
	'3': '#1E5AA8',     // TODO verify
	'6': '#0067B1',     // TODO verify
	'8': '#E2007A',     // TODO verify
	'10': '#F5C400',    // TODO verify (BLT)
	'11': '#E30613',    // TODO verify (BLT)
	'14': '#D6006F',    // TODO verify
	'15': '#009846',    // TODO verify
	'16': '#7AB51D',    // TODO verify
	'17': '#00A0DF',    // TODO verify
	'21': '#00A19A'     // TODO verify
};

/** The badge colour for a line in "line colours" mode (station amber when the line is not listed). */
export function lineColor (line: string): string {
	const c = LINE_COLORS[line] || LINE_COLORS[line.toUpperCase()];
	return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : STATION_AMBER;
}
