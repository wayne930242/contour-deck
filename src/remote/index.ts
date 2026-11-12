/**
 * contour-deck/remote: the phone remote, the laser pointer, ink, tilt pointing, and the presenter window.
 * Load it on demand: the deck calls its `remote` option on the R key, and a page opened with
 * `?view=remote` or `?view=presenter` calls `remoteView` or `presenterView`.
 */
export { remoteHost } from "./session.js";
export type { RemoteHost, RemoteOptions } from "./session.js";
export { remoteView } from "./phone.js";
export type { RemoteView, RemoteViewOptions } from "./phone.js";
export { presenterView } from "./presenter.js";
export { broadcast, relay, relayUrl } from "./transport.js";
export type { Incoming, RelayOptions, Transport, TransportStatus } from "./transport.js";
export type { Command, GuestMessage, HostMessage, Message, RelayMessage, StateMessage } from "./protocol.js";
export { defaultRemoteLabels } from "./labels.js";
export type { RemoteLabels } from "./labels.js";
export type { QrEncoder } from "./panel.js";
export { aimOf, calibrate, createPointer, defaultCalibration, project, recentre } from "./tilt.js";
export type { Aim, Calibration, CalibrationTarget, Pointer, TiltSample } from "./tilt.js";
