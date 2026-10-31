# Contributing

Thank you for helping people learn Kubernetes. Corrections, clearer
explanations, new levels and new examples are all welcome.

## Ground rules

1. **Original work only.** Write explanations in your own words. Do not
   copy from courses, books, blogs or other repositories, even with small
   changes. Linking to the official Kubernetes docs is encouraged.
2. **Everything must run.** Manifests must pass `kubeconform`, scripts must
   pass `shellcheck`, and every level must pass `tests/run-level.sh`.
3. **No secrets, ever.** No credentials, tokens, kubeconfigs, real AWS
   account IDs, subnet IDs or hostnames. Use placeholders like
   `<AWS_ACCOUNT_ID>` and `<REGION>`.
4. **Pin versions.** `nginx:1.27`, not `nginx:latest`.
5. **Plain, friendly English.** Short sentences. Explain why, not only what.
   Assume the reader is smart but new.

## Running the checks locally

```bash
shellcheck -x nimbus labs/lib.sh labs/*/*.sh tests/*.sh .devcontainer/*.sh
find reference labs -name '*.yaml' -not -name kind.yaml -not -path '*/app/*' -print0 | xargs -0 kubeconform -strict -summary -ignore-missing-schemas
python3 tests/check_links.py                # every internal link resolves
python3 -m unittest discover -s tests      # dashboard server
node tests/check_site_data.js               # site levels and quiz data
node tests/check_playground.js              # playground scenarios
node tests/check_reference.js               # deep links, Troubleshoot entries, problems.html
./nimbus up
tests/run-level.sh 6      # starts level 6, expects failure, solves it, expects success
```

To preview the site, serve the `site/` folder with any static server, for
example `python3 -m http.server -d site 8000`.

`site/problems.html` is generated from the Troubleshoot entries in
`site/data.js`. After changing them, run `node tools/build-problems.js`;
`tests/check_reference.js` fails while the committed page is out of date.
Each entry needs an `id` (its `#fix/<id>` link: never rename one), a
symptom, the exact error text, the causes, commands to confirm, a fix, how
to prevent it, and at least one playground scenario to practise it.

## Adding a level

1. Copy an existing level folder to `labs/NN-short-name/`.
2. `README.md`: the first line must be `# Level NN · Title`. Then the
   ticket (a short story from a teammate), **You will learn**, **Mission**
   (one checkbox per check), **Field notes** (the concept, with the
   commands that reveal it) and **Production lens** (how it shows up at
   work).
3. `setup.yaml` and/or `setup.sh`: the broken starting state. Do not set
   `metadata.namespace`; `./nimbus` applies everything into `nimbus-NN`.
4. `check.sh`: one `check "<what the learner should see>" <command>` per
   mission item, using the helpers in [`labs/lib.sh`](labs/lib.sh). Checks
   must be read-only (throwaway probe Pods are fine) and must **fail** on
   the starting state.
5. `hints.txt`: three hints separated by `---`, from a nudge to the answer.
6. `solution.sh` (executable): the reference fix, with comments. CI runs it.
7. `cleanup.sh` (optional): undo anything cluster-wide (node labels,
   taints, cluster roles). It must be safe to run at any time.
8. Add the level to [`labs/README.md`](labs/README.md), the README,
   [`docs/roadmap.md`](docs/roadmap.md), `levels` and `quiz` in
   [`site/data.js`](site/data.js), questions in
   [`site/quiz-bank.js`](site/quiz-bank.js), and the matrix in
   [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Quiz questions should test understanding, not memory: prefer "you see X,
what is the cause?" over definitions. Every question needs four plausible
options and a `why` that explains the right answer and the most tempting
wrong one.

## Pull requests

Small and focused is best. Fill in the template: what changed, why, and how
you tested it. By contributing, you agree that your work is released under
the [MIT License](LICENSE).
