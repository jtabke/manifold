import { ArrowUpRight } from "lucide-react";

export function ReferencedNote({
  text,
  links,
  labels,
  open,
}: {
  text: string;
  links: Record<string, string>;
  labels: Record<string, string>;
  open: (id: string) => void;
}) {
  const aliases = Object.keys(links);
  if (!aliases.length) return <>{text}</>;
  const parts = text.split(
    new RegExp(
      `(?<![A-Za-z_0-9])(${aliases.sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z_0-9])`,
      "g",
    ),
  );
  return (
    <>
      {parts.map((part, i) =>
        links[part] ? (
          <button
            className="er-note-reference"
            key={i}
            aria-label={`Open reference ${labels[links[part]] || part}`}
            onClick={(e) => {
              e.stopPropagation();
              open(links[part]);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {labels[links[part]] || part}
            <ArrowUpRight size={11} />
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}
