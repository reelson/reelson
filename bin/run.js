#!/usr/bin/env node
// The `reelson` command. Node will not run TypeScript from under node_modules, so an npm install
// runs reelson.js (compiled beside reelson.ts when the package is packed); a checkout runs the source.
const installed = /[\\/]node_modules[\\/]/.test(import.meta.filename)
await import(installed ? './reelson.js' : './reelson.ts')
