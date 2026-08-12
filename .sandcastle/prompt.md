# INPUTS

Here is a PRD for the feature you need to build:

<prd>

!`p="{{ PRD_LOCATION }}"; if [ -f "$p" ]; then cat "$p"; else echo "PRD_LOCATION must point to a readable file: $p" >&2; exit 1; fi`

</prd>

And here is the multi-phase plan for it:

<plan>

!`p="{{ PLAN_LOCATION }}"; if [ -f "$p" ]; then cat "$p"; elif [ -d "$p" ]; then first=$(find "$p" -maxdepth 1 -type f \( -name '*.md' -o -name '*.markdown' \) -print | LC_ALL=C sort | head -n 1); if [ -z "$first" ]; then echo "PLAN_LOCATION directory contains no Markdown files: $p" >&2; exit 1; fi; find "$p" -maxdepth 1 -type f \( -name '*.md' -o -name '*.markdown' \) -print | LC_ALL=C sort | while IFS= read -r file; do printf '\n<!-- Plan source: %s -->\n\n' "$file"; cat "$file" || exit 1; done; else echo "PLAN_LOCATION must point to a readable Markdown file or directory: $p" >&2; exit 1; fi`

</plan>

Treat the entire plan as one delivery task. The phases are implementation
milestones, not separate sessions.

Before changing code:

1. Read the complete PRD and plan.
2. Inspect the repository, tests, and git history to determine which phases are
   already complete, partially complete, or still pending.
3. Build a checklist of every unfinished phase and its acceptance criteria.

Implement every unfinished phase in dependency order. After completing and
verifying one phase, continue to the next phase automatically in the same
session. Do not stop merely because a phase is complete, and do not ask for
confirmation between phases.

Do not redo work that is already present and verified. Preserve unrelated user
changes in the working tree.

# EXPLORATION

Explore the repo.

# IMPLEMENTATION

Complete all unfinished phases and satisfy the PRD's final acceptance criteria.

You may pause only when genuinely blocked by a missing product decision,
credential, permission, required input, or unavailable external system. Before
pausing, exhaust safe in-scope alternatives and report the exact blocker, what
you tried, and what is needed to continue.

# FEEDBACK LOOPS

After each phase, run the narrowest relevant checks. Before declaring the whole
plan complete, run the full feedback loop:

- `npm test` to run the complete test suite
- Any additional build, lint, typecheck, or interactive acceptance commands
  required by the PRD or the changed area

Fix regressions before moving on. Review `git diff` and confirm there are no
secrets, generated junk, debug instrumentation, or unrelated changes.

# COMMIT

Create one or more coherent commits after the implementation and verification
are complete. Prefer Chinese commit messages. Each commit message should state:

1. Include key decisions made
2. Include files changed
3. Blockers or follow-up notes, if any

# FINAL RULES

The task is complete only when every unfinished phase and the PRD's final
acceptance criteria are implemented and verified. Then output:

<promise>NO MORE TASKS</promise>

Never emit that signal while a planned phase, acceptance criterion, test,
required review, or required commit remains unfinished.
