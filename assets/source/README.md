# assets/source

Authoring files: `.blend`, Material Maker graphs, reference images, bakes.
**Not shipped.** Vite does not serve this directory; only `public/` ships.

Layout:

```
assets/source/<category>/<name>/
  <name>.blend        the authoring file
  <name>.glb          the export the ingest step reads
  tags.json           optional, e.g. ["street","transit"] — drives placement
  ref/                reference images
```

Run `npm run ingest` after any export. See `docs/PIPELINE.md`.
