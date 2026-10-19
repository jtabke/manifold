.PHONY: setup canvas canvas-dev check check-python check-canvas check-docs check-browser build

PYTHON ?= python3

setup:
	npm --prefix apps/canvas ci

canvas:
	npm --prefix apps/canvas run build
	$(PYTHON) apps/canvas/server.py

# Keep the Python server running in another terminal.
canvas-dev:
	npm --prefix apps/canvas run dev

check: check-docs check-python check-canvas

check-docs:
	$(PYTHON) scripts/check_docs.py

check-python:
	$(PYTHON) -m unittest discover -s apps/canvas/tests -p 'test_*.py'

check-canvas:
	npm --prefix apps/canvas run format:check
	npm --prefix apps/canvas run build
	npm --prefix apps/canvas test

# Uses a temporary server on port 58312. Requires installed Chrome.
check-browser:
	npm --prefix apps/canvas run build
	npm --prefix apps/canvas run test:all-browser

build:
	npm --prefix apps/canvas run build
