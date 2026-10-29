// Preloaded when the CLI runs on bun: bun defines `self`, so elkjs takes the process for a web worker and never starts its layout.
delete globalThis.self;
