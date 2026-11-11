// Errors meant for the person using the app. Anything else (a library's message, a network
// error) is logged for diagnosis and answered with a fixed message, so internals never leak.
export class SourceError extends Error {}
