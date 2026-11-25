// Business rules that don't belong to any single app: service order status
// transitions, stock movement invariants, etc. Kept framework-free so both
// apps/api and any future worker can import it without pulling in Nest.
export * from './src/vehicle-variant.js';
export * from './src/estimate.js';
export * from './src/fiscal.js';
