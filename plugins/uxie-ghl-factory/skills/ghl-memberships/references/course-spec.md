# Course spec format

Input to `scripts/build-course.mjs`. A worked example is `example-spec.json`.
Always `--dry-run` first — validation runs before anything touches the account.

```jsonc
{
  "locationId": "<YOUR_LOCATION_ID>",       // or pass GHL_LOC

  "course": {
    "title": "Franchisee Launchpad",           // required
    "description": "Signed agreement to opening day."
  },

  "theme": {                                   // optional
    "name": "House Theme",
    "templateId": "NeoClassic",
    "brandColor": "#0B6B53",
    "heroTitleColor": "#FFFFFF",
    "instructor": { "name": "…", "title": "…", "bio": "…" }
  },

  "offer": { "type": "free", "publish": true }, // ONLY free is supported (see below)
                                                // omit entirely, or set null, for no offer

  "credential": {                               // optional — creates the template AND
    "title": "Onboarding Certificate",          // attaches it to auto-issue on completion
    "type": "certificate"                       // certificate | badge
  },

  "enroll": ["contactId1", "contactId2"],       // optional — grants the offer, then polls
                                                // user-progress to confirm it landed

  "chapters": [
    {
      "title": "Module 1",                      // required
      "dripDays": 0,                            // 0 = immediate; N = unlock N days after enrollment
      "description": "",
      "lessons": [

        // TEXT lesson — omit every media key
        { "title": "Welcome", "text": "<h2>Hi</h2><p>Rich <strong>HTML</strong> works.</p>" },

        // VIDEO (uploaded) — path relative to the spec file
        { "title": "Walkthrough", "text": "<p>…</p>", "video": "./media/intro.mp4" },

        // AUDIO — same rail
        { "title": "Briefing", "audio": "./media/brief.mp3" },

        // EMBED (Vimeo/YouTube/Loom) — either paste the iframe, or give the parts
        { "title": "Hosted video",
          "embed": { "iframe": "<iframe src=\"https://player.vimeo.com/video/123\" width=\"640\" height=\"360\" allowfullscreen></iframe>" } },
        { "title": "Hosted video",
          "embed": { "src": "https://player.vimeo.com/video/123", "width": 640, "height": 360, "allowFullScreen": true } },

        // DOWNLOADABLE FILES — attach to any lesson, N per lesson
        { "title": "Standards", "text": "<p>Read first.</p>", "files": ["./media/standards.pdf"] },

        // ASSIGNMENT — the "learner uploads a document" primitive
        { "type": "assignment", "title": "Upload your Licence", "text": "<p>PDF or photo.</p>" },

        // QUIZ — questions are optional but this is the only way to populate them
        { "type": "quiz", "title": "Compliance Check", "text": "<p>Five minutes.</p>",
          "questions": [
            { "title": "Capital of France?",
              "questionType": "single",              // single | multiple
              "explanation": "Shown after answering.",
              "options": [
                { "statement": "Berlin" },
                { "statement": "Paris", "isCorrect": true }
              ] }
          ] }
      ]
    }
  ]
}
```

## Rules the validator enforces

- `course.title` and at least one chapter with a title.
- `lessons[].type` ∈ `lesson | quiz | assignment` (default `lesson`). **There is no `embed`,
  `pdf`, `html` or `text` type** — `content_type` is a closed ENUM; text lessons simply omit media.
- Quiz `questions[]` need ≥2 options and **at least one `isCorrect`**.
- A lesson cannot have both `video` and `embed`.
- `offer.type` other than `free` is **rejected**: `one_time`/`recurring` return 500 without a
  payment provider connected on the sub-account.
- Wall-clock is estimated up front and checked against token headroom, so a build fails *before*
  starting rather than dying half-done when the ~1 h token expires.

## Ordering and gating

- Chapter order = array order. Lesson order = array order within a chapter.
- `dripDays` unlocks a chapter N days after enrollment.
- Nesting (`parentCategory`) and prerequisite gating (`lockedByCategory`) exist on the API
  (`engine/api.mjs → createCategory`) but are not yet surfaced in the spec — add them there if needed.

## What the build prints

Every created id, a per-item verification pass (read-back, not status codes), and the exact
teardown command. Remember offers and credential templates do **not** cascade on product delete.
