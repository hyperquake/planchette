import type { SurfaceInfo } from './types';
/**
 * Publish the surface geometry as CSS custom properties so that stylesheets can
 * work in millimetres:
 *
 *   .button { min-width: calc(20 * var(--mm)); }
 *   .ring   { width: calc(var(--puck-d) + 40 * var(--mm)); }
 */
export declare function applyCssVars(surface: SurfaceInfo, el?: HTMLElement): void;
export declare const DEG: number;
/** Shortest signed difference between two angles, in radians. */
export declare function angleDelta(from: number, to: number): number;
/** Normalize an angle into [0, 2*PI). */
export declare function wrapAngle(a: number): number;
/**
 * Nearest table edge for a contact, computed in millimetres so that it stays
 * correct on non-square-aspect surfaces. Used as a cheap "which user" hint.
 */
export declare function nearestEdge(mmX: number, mmY: number, widthMm: number, heightMm: number): 'n' | 's' | 'e' | 'w';
