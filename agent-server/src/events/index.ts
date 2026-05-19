// input:  event-bus, event-types, event-logger
// output: public API for events/ layer
// pos:    events/ barrel — import from '@events/index' or './events/index.js'
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

export type { CortexEvent, CortexEventInput, DistributiveOmit } from './event-types.js';
export { EventBus } from './event-bus.js';
export type { Subscription } from './event-bus.js';
export { createEventLogger } from './event-logger.js';
export type { EventLogger, EventLoggerOptions } from './event-logger.js';
