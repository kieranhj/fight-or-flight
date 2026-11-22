# Wrapper so that `make` works from PowerShell / Windows Terminal.
# Wraps the npm scripts in package.json. GNU make runs recipes with cmd.exe
# here (no sh on PATH). Servers are not started by default: see `make help`.

.PHONY: all build typecheck install help
all: build

build:
	npm run build

typecheck:
	npm run typecheck

install:
	npm install

help:
	@echo make            - npm run build (tsc -b + vite build to dist\)
	@echo make typecheck  - npm run typecheck
	@echo make install    - npm install
	@echo make help       - this list
	@echo To run locally use two terminals:  npm run worker:dev  and  npm run dev  (http://localhost:5173)
	@echo Deploy the Worker with: npm run worker:deploy
