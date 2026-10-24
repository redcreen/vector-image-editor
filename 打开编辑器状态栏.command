#!/bin/zsh
cd -- "${0:A:h}"
menu_launcher="${CODEX_HOME:-$HOME/.codex}/skills/vector-editor/scripts/menubar.py"
if [[ -f "$menu_launcher" ]]; then
  exec python3 "$menu_launcher" --project "$PWD"
fi
menu_app="$HOME/Applications/通用矢量图编辑器.app"
python3 tools/curve-editor/menubar/build.py --output "$menu_app" --manager "$PWD/tools/curve-editor/manager.py" --project "$PWD" || exit $?
open "$menu_app"
