from __future__ import annotations
import re
from pathlib import Path

path = Path(".streamlit/config.toml")
path.parent.mkdir(parents=True, exist_ok=True)
text = path.read_text(encoding="utf-8") if path.exists() else ""

if not text.strip():
    text = "[server]\nenableStaticServing = true\n"
elif re.search(r"(?m)^\s*enableStaticServing\s*=", text):
    text = re.sub(
        r"(?m)^(\s*enableStaticServing\s*=\s*).*$",
        r"\1true",
        text,
    )
elif re.search(r"(?m)^\[server\]\s*$", text):
    text = re.sub(
        r"(?m)^(\[server\]\s*)$",
        r"\1\nenableStaticServing = true",
        text,
        count=1,
    )
else:
    if not text.endswith("\n"):
        text += "\n"
    text += "\n[server]\nenableStaticServing = true\n"

path.write_text(text, encoding="utf-8")
print(f"[OK] {path}: enableStaticServing = true")
