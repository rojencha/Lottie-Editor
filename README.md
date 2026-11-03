# Lottie Library

Browser-based Lottie workspace: batch convert dotLottie ↔ Lottie JSON, edit animations, and organize saved assets into groups.
Static site, no runtime dependencies, no bundler.

```
npm run dev     # static dev server on http://localhost:5173
npm test        # unit tests (node --test)
npm run build   # syntax check + tests + copy to dist/
```

Deploy: Vercel picks up `vercel.json` (`npm run build`, output `dist`). ES modules need http(s); opening index.html from disk won't work.

**Current MVP limits:** no sign-in is required. Conversions and the asset library run locally in the browser; saved files are stored in IndexedDB on that device. Group ZIP downloads are supported. Other people and devices cannot access the library yet, and this version does not convert PDF, office documents, or general image formats. Cross-device company storage and sharing need a backend and object storage. The local policy layer is not an access-control boundary.
