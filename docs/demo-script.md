# Demo Script

Use the `viral` conda environment for local commands:

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run typecheck
```

## 1. Run Local Checks

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm test
```

## 2. Render a Case

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run render:case -- --case marketing --out docs/artifacts/final_submission
```

Valid cases:

- `marketing`
- `editing`
- `motion_graph_1`
- `motion_graph_2`

If rendering is blocked, do not create fake output. Record the blocker and let final gates report it.

## 3. Export Showcase Report

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run showcase:report -- --out docs/artifacts/showcase_report --cases marketing,editing,motion_graph_1,motion_graph_2
```

Open:

- `docs/artifacts/showcase_report/index.html`
- `docs/artifacts/showcase_report/showcase-report.json`

## 4. Evaluate One Case

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run gates:final -- --case-root docs/artifacts/learned_samples_max/marketing
```

Use `--strict` only when the artifacts are expected to pass all gates.

