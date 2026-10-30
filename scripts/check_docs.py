"""Check local links and heading anchors in the proposed Git checkout."""

import argparse
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--worktree", action="store_true",
        help="Include nonignored untracked files while reviewing unstaged designs",
    )
    args = parser.parse_args()
    # Keep the default index-based review; never stage files just to check local drafts.
    command = ["git", "ls-files", "-z"]
    if args.worktree:
        command.extend(["--cached", "--others", "--exclude-standard"])
    tracked = set(subprocess.check_output(command, cwd=ROOT).decode().split("\0"))
    files = [ROOT / name for name in tracked if name.endswith(".md")]
    errors = []
    for path in sorted(files):
        # Code samples can contain Markdown syntax without being document links.
        text = re.sub(r"```.*?```", "", path.read_text(), flags=re.DOTALL)
        targets = re.findall(r"\]\(([^\s)]+)\)", text)
        targets += re.findall(r'(?:href|src)="([^"]+)"', text)
        for target in targets:
            url = urlsplit(target.strip("<>"))
            if url.scheme or url.netloc:
                continue
            destination = (path.parent / unquote(url.path)).resolve() if url.path else path
            if not destination.is_relative_to(ROOT):
                # Some research references intentionally point to sibling projects.
                continue
            if not destination.exists() or (
                destination.is_file() and str(destination.relative_to(ROOT)) not in tracked
            ):
                errors.append(f"{path.relative_to(ROOT)}: missing {target}")
            elif destination.suffix == ".md" and url.fragment and destination.exists():
                headings = {
                    re.sub(r"[^\w\- ]", "", line.lstrip("#").strip().lower()).replace(" ", "-")
                    for line in destination.read_text().splitlines()
                    if line.startswith("#")
                }
                if unquote(url.fragment) not in headings:
                    errors.append(f"{path.relative_to(ROOT)}: missing heading {target}")
    if errors:
        print("\n".join(errors))
        return 1
    print(f"Local links and heading anchors pass in {len(files)} maintained Markdown files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
