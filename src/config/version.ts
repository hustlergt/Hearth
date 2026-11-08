/** This launcher's version. Keep in step with package.json and public/appinfo.json (scripts/test-about.mjs checks that). */
export const HEARTH_VERSION = '2.1.5';

/** This build is an unofficial variant of Hearth (not a release of the original project): the edition is shown next to the
 *  version wherever people read it. The version number itself stays plain x.y.z (webOS and the update check need that). */
export const HEARTH_EDITION = 'Transit edition';
/** "2.1.5 Transit edition": for display only, never compared. */
export const HEARTH_LABEL = HEARTH_EDITION ? HEARTH_VERSION + ' ' + HEARTH_EDITION : HEARTH_VERSION;
