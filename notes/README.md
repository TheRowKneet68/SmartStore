# Working notes

Engineer's working notes. **Not the specification and not governance.** `/docs` is the source of truth for
business behaviour; `CLAUDE.md`, `BUILD-STATUS.md`, `OPEN-QUESTIONS.md` and `SMARTSTORE-CONSTITUTION.md` at the root
are the governance record. Nothing in this folder overrides any of those, and nothing here is approved work.

Every file is dated in its own text, names what it was measured against, and says what was verified versus
inferred. If a number in here disagrees with `/docs`, `/docs` wins and the note is wrong.

| File | What it is | Dated |
|---|---|---|
| [MISSING-FEATURES.md](MISSING-FEATURES.md) | 33 things the system does not do, split into "specced and unbuilt" and "not specced" | 2026-10-01 |
| [WORK-SPLIT.md](WORK-SPLIT.md) | The same inventory sorted into hard and routine, so effort can be split between two agents, with the method and the caveats | 2026-10-01 |

## Why these are here and not in `/docs`

They are analysis, not requirements. Putting them under `docs/` would make them look like approved specification,
and `docs/repository-analysis/` already holds the frozen Phase-0 comparison corpus, which is a different thing.
Keeping them in one small folder at the root makes them easy to find and easy to throw away.

## What is deliberately absent

No feature is listed here that has no citation somewhere in `/docs`. Items with no requirement text at all are
listed under "Not specced" in `MISSING-FEATURES.md` and left as questions; they belong in `OPEN-QUESTIONS.md` and
have not been copied in, because inventing an answer is what that file exists to prevent.
