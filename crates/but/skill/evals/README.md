# GitButler Skill Evaluations

Behavioral test cases for the bundled `but` skill. Each case pairs a
natural-language user request with a rubric describing which `but` commands the
agent should produce and which `git` commands it must avoid.

This directory is **development-only**. Like `AGENTS.md` and the top-level
`README.md`, it is deliberately excluded from `SKILL_FILES` in
`crates/but/src/command/skill/mod.rs`, so `but skill install` never ships it to
users. It exists to catch regressions when the skill or the CLI changes.

## File layout

```text
evals/
├── evals.json   - the eval cases (this is the data)
└── README.md    - this file (rationale, method, caveats)
```

## Schema

`evals.json` is a single object:

- `skill_name` - always `but`, matching the skill's frontmatter `name`.
- `description` - what this set is and how it was verified.
- `evals` - an array of cases. Each case has:
  - `id` - stable integer identifier.
  - `prompt` - a realistic user request, phrased the way a person would.
  - `expected_output` - a rubric in prose: the expected `but` commands, why,
    and the `git` (or retired `but`) commands that must not appear.
  - `rubric` - a structured mirror of `expected_output` for automated grading:
    - `must_use` - command fragments the correct answer should contain.
    - `must_not_use` - fragments that indicate a wrong approach.
    - `note` - optional; disambiguates cases with multiple valid answers or
      names the specific failure mode being targeted.
  - `files` - repository fixture (empty here; cases are command-level, not
    workspace-state-dependent).

## How these cases were verified

Per `../AGENTS.md`: **never document behavior you have not observed.** Every
command in every case was cross-checked against the CLI source, not against help
text or memory:

| Case | Command | Verified against |
|------|---------|------------------|
| 1, 2 | `but commit -b <branch>` creates the branch | `crates/but/src/args/commit.rs` (`--branch` doc: "created if it does not exist") |
| 3, 8 | `but amend -t`, `but squash -t` | `crates/but/src/args/amend.rs`, `crates/but/src/command/legacy/squash.rs` |
| 4 | `but pr new` auto-pushes | `crates/but/src/args/forge.rs` (`New` subcommand doc) |
| 5, 7 | `but uncommit <commit>`, one push per stack | `crates/but/src/command/legacy/uncommit.rs`, `crates/but/src/command/legacy/push.rs` (`get_push_candidates`) |
| 6 | `but pull` carries uncommitted changes | `SKILL.md` "Update workspace from main", `crates/but/src/args/mod.rs` |
| all | `git` write commands are the wrong answer | `SKILL.md` "Non-Negotiable Rules" #1 |

The `must_not_use` lists include **retired** `but` commands, not just `git`.
`but rub` and `but stage` were removed by the July 2026 command revamp
(`crates/but/src/retired_syntax.rs`); an agent that emits them is wrong even
though the tokens start with `but`. Catching that is a primary purpose of this
set.

## Why have evals at all

- **Regression signal the prose can't give.** `SKILL.md` states rules; evals
  check whether an agent following the skill actually reaches the right command.
  A wording change that quietly breaks the `-b`-creates-the-branch guidance
  shows up as a failing case, not as a silent drift.
- **They encode failure modes, not just happy paths.** Case 7 targets the
  specific mistake of pushing each branch of a stack separately; case 3 targets
  reaching for `git commit --amend`. These are the errors real agents make.
- **They pin retired syntax.** As long as `rub`/`stage` linger in model training
  data, a test that fails on them is a cheap guard.
- **They document intent by example.** A reviewer sees the expected command for
  a given request without reading the whole skill.

## Why evals are also a liability

- **They rot faster than prose.** A rubric naming `but pr new` breaks the moment
  the subcommand is renamed. Unlike `SKILL.md`, an out-of-date eval actively
  asserts a falsehood. Re-verify against source whenever the CLI changes.
- **`must_use` substring matching is crude.** It can pass on a superficially
  correct string that is wrong in context, or fail on a valid variant it didn't
  anticipate (case 5 needs the `note` precisely because two different commands
  are both correct). Treat the structured rubric as a hint, not a judge.
- **No runner ships with the repo.** There is no harness wired up; these are
  data. Grading them means feeding `prompt` to an agent and checking its output
  against the rubric by hand or with an external tool. Unrun evals give false
  confidence.
- **Prompt realism caps their value.** A model can pattern-match a terse test
  prompt yet fail on messier real requests. Passing here is necessary, not
  sufficient.

## Maintaining

When you change a command's behavior or the skill's guidance for it:

1. Update the affected `SKILL.md` / `references/` prose first.
2. Re-derive the affected eval's `expected_output` and `rubric` from the new
   behavior - do not syntax-swap the old command for the new one.
3. Re-verify the command against `crates/but/src/args` / `command`, exactly as
   the table above did.
