// input:  none
// output: shared dashboard rendering constants
// pos:    Single source for the per-tab visible-row cap. Dashboard tabs render multi-line
//         rows; an uncapped list overflows the terminal and Ink cannot clear the rows that
//         scrolled past the top, leaving ghost rows. Cap the rendered slice via
//         computeFocusWindow and show "↑/↓ N more" affordances for the remainder.

export const DASHBOARD_MAX_VISIBLE_ROWS = 6;
