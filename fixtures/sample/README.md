# Sample fixture (development only)

**This is not a licensed catalog.** Everything here is fictional placeholder data used to develop and test
the pipeline locally.

- `sample-tone-440hz.wav` - a 2-second 440 Hz sine tone synthesized by FFmpeg (`npm run fixtures:generate`).
  It is test signal, not music, and contains no third-party material.
- `sample-catalog.json` - fictional artist/release/track metadata that points at the tone.

Rules:
- Never import this into a production database.
- Never present it to listeners as real music. Real catalog items need documented permission and must go
  through the rights + moderation flow.
- Do not add real songs or artwork here.
