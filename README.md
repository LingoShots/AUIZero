# Process Writing Assistant

This is a dependency-free MVP of a process-based writing platform with two sides:

- Teacher workspace for assignment creation, AI-assisted prompt/rubric setup, review playback, and suggested grading
- Student workspace for controlled idea generation, tracked drafting, guidance-only feedback, revision, and final reflection

## What is included

- Assignment creation with prompt, word count range, AI limits, and rubric editing
- Teacher AI helper for idea generation, tighter student focus, and rubric suggestions
- Student idea generation limited to bullet points only
- Draft editor with writing-event logging, large-paste flags, and diff snapshots for playback
- Guidance-only feedback requests with hard limits
- Final submission gated by reflection questions
- Teacher dashboard with process indicators, side-by-side comparison, playback, and suggested grading
- Local persistence through `localStorage`

## Run it

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

## Notes

- The app seeds demo data on first load so the full review loop is visible immediately.
- `Reload Demo` restores that sample data.
- `Reset Empty` clears the workspace and leaves the app ready for a fresh pilot.
- The current AI behavior is local heuristic logic in [app.js](/Users/scottcohen/Documents/AUIZero/app.js). It is structured so you can later swap those functions for a real model-backed API.
