/** Window events that connect the shell's deferred pieces (command palette, welcome tour) to the buttons that open them. Kept apart so the buttons do not pull those pieces into the first bundle. */
export const OPEN_COMMAND_EVENT = 'ss:open-command';
export const REPLAY_TOUR_EVENT = 'ss:replay-tour';
export const replayTour = () => window.dispatchEvent(new Event(REPLAY_TOUR_EVENT));
