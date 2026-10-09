#!/bin/zsh
cd -- "${0:A:h}"
editor_skill="${CODEX_HOME:-$HOME/.codex}/skills/vector-editor/scripts/launch.py"
if [[ -f "$editor_skill" ]]; then
  exec python3 "$editor_skill" --project "$PWD" --open
fi
exec python3 tools/curve-editor/server.py --project "$PWD" --port auto --open
