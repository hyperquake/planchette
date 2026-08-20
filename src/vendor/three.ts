/**
 * Entry point for the standalone Three.js bundle served at /three.js.
 *
 * Three ships `three.module.js` as a thin file that imports from a sibling
 * `three.core.js`, so the packaged app cannot simply copy one file out of
 * node_modules. Re-exporting through a bundler produces a single self-contained
 * module that an import map can point at.
 */
export * from 'three'
