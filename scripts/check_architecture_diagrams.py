"""Keep architecture Markdown diagrams consistent with the rendered graph source."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "docs/design/system-block-diagram.html"
DOC = ROOT / "docs/design/architecture.md"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Regenerate Markdown summaries")
    args = parser.parse_args()
    source = re.search(
        r'<script type="application/json" id="architecture-graphs">(.*?)</script>',
        HTML.read_text(), re.DOTALL,
    )
    if not source:
        raise ValueError("Missing shared architecture graph data")
    graphs = json.loads(source[1])
    doc = DOC.read_text()
    errors = []
    for key, graph in graphs.items():
        nodes = {node["id"] for node in graph["nodes"]}
        if len(nodes) != len(graph["nodes"]):
            raise ValueError(f"Duplicate node in {key}")
        lines = ["```mermaid", "flowchart TB"]
        for node in graph["nodes"]:
            label = node["title"].replace('"', "&quot;")
            lines.append(f'    {key}_{node["id"]}["{label}"]')
        for edge in graph["edges"]:
            if edge["from"] not in nodes or edge["to"] not in nodes:
                raise ValueError(f"Unknown edge endpoint in {key}")
            if key == "ownership":
                if edge.get("two"):
                    raise ValueError("Ownership requests must have one direction")
                if edge["from"] in {"domain", "state"}:
                    raise ValueError("Pure rules/state cannot initiate I/O or mutate callers")
                if edge["to"] == "state" and edge.get("mode") != "read" and edge["from"] != "owner":
                    raise ValueError("Only the operation owner may publish accepted state")
            arrow = "<-->" if edge.get("two") else "-.->" if edge.get("mode") in {"read", "optional"} else "-->"
            lines.append(f'    {key}_{edge["from"]} {arrow}|{edge["label"]}| {key}_{edge["to"]}')
        lines.append("```")
        expected = "\n".join(lines)
        pattern = rf'(<!-- architecture-diagram:{key}:start -->)\n.*?\n?(<!-- architecture-diagram:{key}:end -->)'
        match = re.search(pattern, doc, re.DOTALL)
        if not match:
            raise ValueError(f"Missing generated section for {key}")
        replacement = f"{match[1]}\n{expected}\n{match[2]}"
        if match[0] != replacement:
            errors.append(key)
            doc = doc[:match.start()] + replacement + doc[match.end():]
    if args.write:
        DOC.write_text(doc)
    elif errors:
        print("Stale diagram summaries: " + ", ".join(errors))
        print("Run python3 scripts/check_architecture_diagrams.py --write")
        return 1
    print("Deployment/ownership graphs and write/read boundaries are consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
