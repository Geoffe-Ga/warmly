# Release gates

How Warmly decides whether a commit may be released, and how to change
that decision safely (PRD §10; AC-24).

## The short version

- `release/required-checks.yml` lists every check a release needs.
- The **Release Gate** job in CI passes only when every check on that
  list is there, finished and successful.
- A pull request that weakens the list fails the **Release Policy Guard**
  unless a person puts the `release-policy-change` label on it.
- There is no manual approval step in the normal path. A release that
  passes the gate needs no sign-off; one that fails it cannot be waved
  through.

**Nothing deploys to production yet.** Hosting and the deploy pipeline
are a separate, later change. When it is added, the production deploy
must depend on the Release Gate, for the commit being deployed.

## What "fail closed" means here

A gate that only looks for failures lets through anything that did not
run. This one looks for successes:

| What GitHub reports for a required check | The gate |
| --- | --- |
| Finished, `success` | Counts as passed |
| Finished, `failure`, `timed_out`, `action_required` | Blocks |
| Finished, `skipped`, `cancelled`, `neutral`, `stale` | Blocks |
| Not finished yet | Blocks |
| No result at all | Blocks, as `missing` |
| A state the script does not know | Blocks |
| The manifest or the results cannot be read | Blocks |

The same idea applies inside the checks:

- **Bandit** exits with 1 for a finding of any severity, so CI cannot use
  its exit code. It writes a report, and
  `scripts/release/bandit_report.py` reads it. No report, an unreadable
  report, a file Bandit could not parse, or a high-severity finding all
  fail the job. (Before this, a Bandit run that crashed and wrote no
  report passed.)
- **The secret scan and SAST scripts** exit with 2 when the tool is not
  installed or could not run. That is a failure, never a pass.

## The required checks

Each entry in the manifest has:

- `id`: its own short name.
- `job`: the name of the CI job that runs it, exactly as it appears on a
  pull request.
- `paths` (optional): the test files and folders that make it up.
- `prd`: the PRD IDs it serves.

Several checks share one job. That is deliberate: the gate needs the job
to succeed, and the policy guard protects each check's files separately,
so nobody can keep a job green by deleting the suite inside it.

`tests/release/test_manifest.py` keeps the manifest honest: every job it
names is a job CI runs, no required job has a condition that could skip
it, the gate waits for all of them, every path holds files, and every
threshold can be read.

## The scans

| Scan | Tool, pinned | Where | Blocks on |
| --- | --- | --- | --- |
| Python dependencies | pip-audit | Quality Checks | Any known vulnerability |
| npm dependencies | npm audit | Frontend Quality | High and critical |
| Secrets | gitleaks v8.30.1, built from source | Secret Scan | Any secret in any commit |
| Backend static analysis | Bandit | Quality Checks | High severity |
| Static analysis, all code | Semgrep 1.187.0 with the security rules of `semgrep/semgrep-rules` at a pinned commit | SAST | Semgrep's highest severity (`ERROR`) |

Lower-severity Semgrep findings are printed and do not block. The rules
are read from a checkout on disk: nothing is fetched while scanning, and
no code or metrics are sent anywhere.

What the secret scan passes over is in `.gitleaks.toml`: published test
vectors under `tests/fixtures/` and the detect-secrets baseline. Never
add a path there that could hold a real key.

`npm audit` reports eight moderate findings today, all in build and test
tooling (`glob`, `minimatch`, `qs` and what depends on them), none in
what ships to the browser (`npm audit --omit=dev` finds nothing). They
are printed in CI and do not block.

### Running them yourself

```bash
go install github.com/zricethezav/gitleaks/v8@v8.30.1
```

```bash
./scripts/release/secret-scan.sh
```

```bash
git clone https://github.com/semgrep/semgrep-rules ../semgrep-rules
```

```bash
SEMGREP_RULES=../semgrep-rules ./scripts/release/sast.sh
```

Semgrep is not in `requirements-dev.txt`: install it in a virtual
environment of its own (`pip install semgrep==1.187.0`), so its
dependencies cannot disturb the project's. Neither scan is part of
`./scripts/check-all.sh`; CI runs both on every pull request.

## Changing the policy

Adding a check, a path or a threshold needs nothing special.

These need the `release-policy-change` label, put on by a person:

- removing a check, moving it to another job, or removing one of its
  paths;
- deleting a file under a required path (a file that only moves, with
  the same contents, to a place that is still required does not count);
- removing a threshold, or moving its number the unsafe way: a coverage
  floor down, the download budget up.

A label put on by a bot does not count. The guard reads who added the
label from the pull request's history. The guard runs again when a label
is added or removed.

A manifest that cannot be read fails whatever the labels say.

### What the guard cannot do

Be clear about its limits:

- **A pull request can edit the workflow that runs the guard.** GitHub
  runs a pull request's own copy of a workflow file. The guard's script
  is taken from the base branch, but the workflow that calls it is not.
- **It protects only what the manifest lists.** A threshold nobody listed
  can be lowered without it noticing.
- **It does not read the workflow for other ways to weaken a check**, such
  as removing a step from a required job or changing what a step runs.
  One case is caught, by a test rather than by the guard: a required job
  may not have an `if:` or `continue-on-error`
  (`tests/release/test_manifest.py`).
- **The label proves an account, not a person's judgement.** The guard
  accepts the label from any account GitHub calls a `User`. That includes
  the pull request's own author, and an agent acting through a person's
  account looks the same as that person. The project's rule is that an
  agent never adds the label, but nothing in the guard can enforce it.

These are closed by repository settings, which a person must set:

1. Make **Release Gate** and **Release Policy Guard** required status
   checks on `main` (Settings, Branches, branch protection).
2. Require review from a code owner for `.github/workflows/`,
   `release/` and `scripts/release/`.
3. Create the `release-policy-change` label.
4. Require an approving review from someone other than the author on
   `main`. That is what turns "a person labelled it" into "a second
   person agreed".

Until the first is done, the gate reports and does not prevent a merge.

## Updating a pinned tool

1. Change the version in one place: `GITLEAKS_VERSION` in
   `scripts/release/secret-scan.sh` and the `go install` line in CI; the
   Semgrep version and the rules commit in CI.
2. Run the scan locally at the new version and read every new finding.
3. Never update a pin and add an allow-list entry in the same change
   without saying why in the pull request.

Actions in the new jobs are pinned by commit, with the version in a
comment. To update one, look the commit up from the action's own tags.
