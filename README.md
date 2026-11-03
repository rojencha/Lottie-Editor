# Lottie Library

Internal Lottie asset platform: convert dotLottie ↔ Lottie JSON, edit, and share through a governed library.
Static site, no runtime dependencies, no bundler.

```
npm run dev     # static dev server on http://localhost:5173
npm test        # unit tests (node --test)
npm run build   # syntax check + tests + copy to dist/
```

Deploy: Vercel picks up `vercel.json` (`npm run build`, output `dist`). ES modules need http(s); opening index.html from disk won't work.

**Development build:** sign-in is simulated and the library lives in the browser's IndexedDB. See `docs/HANDOFF.docx` for what is real, what is mocked, and what must be connected for production.
