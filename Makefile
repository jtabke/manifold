.PHONY: setup canvas canvas-dev build check check-repo check-docs check-docs-worktree check-python check-canvas check-browser check-foundation-package check-foundation-package-browser foundation verify verify-application-foundation

PYTHON ?= python3

setup:
	npm ci

canvas: build
	$(PYTHON) apps/canvas/server.py

# Keep the Python server running in another terminal.
canvas-dev:
	npm --prefix apps/canvas run dev

build:
	npm --prefix apps/canvas run build

check: check-repo check-docs check-python check-canvas check-assistant check-foundation-package

check-repo:
	node_modules/.bin/prettier --check package.json scripts/check_repo.mjs scripts/repo_policy.test.mjs scripts/browser.mjs .github/workflows/ci.yml
	node --test scripts/repo_policy.test.mjs
	node scripts/check_repo.mjs

check-docs:
	$(PYTHON) scripts/check_architecture_diagrams.py
	$(PYTHON) scripts/check_docs.py --worktree

check-docs-worktree: check-docs

check-python:
	$(PYTHON) -m unittest discover -s apps/canvas/tests -p 'test_*.py'

check-canvas:
	npm --prefix apps/canvas run format:check
	npm --prefix apps/canvas run build
	npm --prefix apps/canvas test

.PHONY: check-assistant
check-assistant:
	node_modules/.bin/prettier --check apps/assistant/package.json apps/assistant/src/*.mjs apps/assistant/test/*.mjs
	npm --workspace manifold-assistant test

# Uses a temporary server on port 58312. Requires installed Chromium.
check-browser:
	npm --prefix apps/canvas run build
	npm --prefix apps/canvas run test:all-browser

check-foundation-package:
	node_modules/.bin/prettier --check packages/foundation/src/*.ts packages/foundation/workbench/*.ts packages/foundation/workbench/*.html packages/foundation/workbench/*.css packages/foundation/test/*.mjs packages/foundation/package.json packages/foundation/tsconfig.json packages/foundation/vite.config.mjs
	node_modules/.bin/tsc -p packages/foundation/tsconfig.json
	node --test packages/foundation/test/*.test.mjs
	node node_modules/vite/bin/vite.js build --config packages/foundation/vite.config.mjs

check-foundation-package-browser: check-foundation-package
	node packages/foundation/test/browser.mjs
	node packages/foundation/test/composition-browser.mjs

foundation:
	npm --prefix packages/foundation run dev

# Public-checkout correctness checks, serialized because builds share output.
verify:
	$(MAKE) check
	node packages/foundation/test/browser.mjs
	node packages/foundation/test/composition-browser.mjs
	# check-canvas already built the canvas; do not rebuild it for the browser phase.
	npm --prefix apps/canvas run test:all-browser

# Retain the documented entry point, without requiring private evaluation archives.
verify-application-foundation: verify

# Optional reproducible diagnostics. Generated reports stay local/CI-ephemeral.
.PHONY: measure-drawing-browser
measure-drawing-browser: build prepare-reports
	npm --prefix apps/canvas run test:all-browser -- --diagnostic check-drawing-performance-browser
.PHONY: prepare-reports
prepare-reports:
	mkdir -p evidence/current/canvas evidence/current/foundation

measure-foundation-package measure-foundation-retention measure-foundation-storage measure-foundation-reclamation measure-foundation-composition measure-foundation-selection measure-foundation-typed measure-artifact-computations measure-foundation-models measure-sampling-plans measure-canvas-capacity measure-canvas-scene measure-authored-models measure-model-analyses measure-worksheet-evaluation: prepare-reports

.PHONY: measure-foundation-package measure-foundation-retention measure-foundation-storage measure-foundation-reclamation measure-foundation-composition measure-foundation-selection measure-foundation-typed
measure-foundation-package:
	node packages/foundation/test/workload.mjs
measure-foundation-retention:
	node packages/foundation/test/retention-workload.mjs
measure-foundation-storage:
	node packages/foundation/test/storage-workload.mjs
measure-foundation-reclamation:
	node packages/foundation/test/reclamation-workload.mjs
measure-foundation-composition:
	node packages/foundation/test/composition-workload.mjs
measure-foundation-selection:
	node packages/foundation/test/selection-workload.mjs
measure-foundation-typed:
	node packages/foundation/test/typed-workload.mjs

.PHONY: measure-artifact-computations measure-foundation-models measure-sampling-plans measure-canvas-capacity measure-canvas-scene measure-authored-models measure-model-analyses measure-worksheet-evaluation
measure-artifact-computations:
	node apps/canvas/tools/measure-artifact-computations.mjs
measure-foundation-models:
	node apps/canvas/tools/measure-foundation-models.mjs
measure-sampling-plans:
	node apps/canvas/tools/measure-sampling-plans.mjs
measure-canvas-capacity:
	node apps/canvas/tools/measure-canvas-capacity.mjs
measure-canvas-scene:
	node apps/canvas/tools/measure-canvas-scene.mjs
measure-authored-models:
	node apps/canvas/tools/measure-authored-models.mjs
measure-model-analyses:
	node apps/canvas/tools/measure-model-analyses.mjs
measure-worksheet-evaluation:
	node apps/canvas/tools/measure-worksheet-evaluation.mjs
