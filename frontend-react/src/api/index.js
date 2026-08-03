/**
 * src/api/index.js
 *
 * Re-exports everything from the canonical src/api.js so that any legacy
 * import paths (e.g. from older generated code) continue to work without
 * duplicating logic or maintaining a second axios instance.
 *
 * The authoritative API client lives in src/api.js — edit that file, not this one.
 */
export { default, default as api } from '../api.js'
export * from '../api.js'
