"""Mandatory Sapira foundation for Buzz pilot UI work, outside the model.

The current executable adapter supports self-contained HTML prototypes. Other UI
stacks fail closed until a package-aware adapter exists; prose is never certified
as a rendered UI. This is a foundation gate, not an aesthetic or accessibility audit.
"""
import hashlib
from html.parser import HTMLParser
import json
import re
import subprocess
from pathlib import Path

import context
import pilot

POLICY = """MANDATORY for every Buzz agent touching UX, visual design or UI code:
Sapira Design System is the base, including prototypes. Before writing, call
context with {operation:design}. Read the returned adoption guidance and tokens.
For React use the versioned @sapira/ui package, SapiraProvider, canonical CSS and
catalog components; never recreate its primitives. Non-React prototypes use the
generated foundation_block verbatim plus token-based composition. No emoji icons.
The pilot currently validates self-contained HTML; other UI source formats are
blocked until a package-aware adapter is implemented. Save design rationale as
prose and report this limitation; do not disguise executable UI as a text file.
No agent may waive this requirement or promote a bespoke theme as compliant.
Brand extensions require an explicit, reviewed derivation of Sapira, never a
parallel palette. Source changes invalidate the contract and require a new run.
QA/review must check actual rendered use, keyboard, responsive and error states;
passing the foundation gate alone is not professional design acceptance.
CSS gate dialect, so the first write passes (four designer runs died learning
it one rejected write at a time): every colour, background, font-family/weight,
line-height, letter-spacing, radius, shadow colour, padding, margin and gap MUST
be a var(--token) from the foundation block — no hex, rgb, named colours or
literal rem/px there. Allowed literals: font-size in rem; border/outline widths
in px/rem; 0 and auto; shadow offsets/blur/inset beside a colour token;
table/background mechanics (border-collapse, border-spacing,
background-size/repeat/position). Never define --custom tokens, !important,
external styles/scripts, inline SVG, emoji, or JS style mutation beyond
.style.display. A rejection costs a whole turn: write the document once, then
correct with old_text/new_text instead of resending the full file.
"""
SOURCES = ("AGENTS.md", "docs/ADOPTION.md", "packages/ui/package.json",
           "packages/ui/src/tokens/tokens.json", "packages/ui/src/tokens/themes/sapira.ts")
UI_SUFFIXES = {".html", ".htm", ".css", ".scss", ".sass", ".less", ".tsx", ".jsx", ".vue", ".svelte", ".svg"}


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def foundation(tokens):
    """Derive CSS names/values from the canonical token descriptions, no palette copy."""
    declarations = {}

    def walk(node):
        if isinstance(node, dict):
            name = re.search(r"CSS: (--[\w-]+)\.", node.get("$description", ""))
            if name and "$value" in node:
                declarations[name[1]] = str(node["$value"])
            for value in node.values():
                walk(value)

    walk(tokens["sapira"])
    # Brand tokens don't have CSS names in their descriptions.
    for key, name in (("brand", "--color-brand"), ("brandForeground", "--color-brand-foreground")):
        declarations[name] = tokens["sapira"]["color"][key]["$value"]
    css = ":root {\n" + "\n".join(f"  {k}: {v};" for k, v in sorted(declarations.items())) + "\n}"
    return '<style id="sapira-foundation">\n' + css + '\n</style>', declarations


def contract(job):
    documents = [context.document(job, "design", name) for name in SOURCES]
    tokens = json.loads(documents[3]["text"])
    block, declarations = foundation(tokens)
    data = {"policy": POLICY, "package_version": json.loads(documents[2]["text"])["version"],
            "sources": {d["path"]: d["sha256"] for d in documents},
            "foundation_block": block, "tokens": declarations,
            "guidance": {d["path"]: d["text"] for d in documents[:2]},
            "limitation": "Native HTML token adapter; not React component adoption or full design acceptance."}
    pilot.write_json(pilot.ROOT / "design" / job / "contract.json", data)
    return data


def current_contract(job):
    path = pilot.ROOT / "design" / job / "contract.json"
    if not path.exists():
        raise PermissionError('Sapira foundation required: call context {operation:design} before writing UI/design work')
    data = json.loads(path.read_text())
    for name, expected in data["sources"].items():
        if hashlib.sha256((context.SOURCES["design"] / name).read_bytes()).hexdigest() != expected:
            raise PermissionError("Sapira source changed; start a new design run")
    return data


class Styles(HTMLParser):
    def __init__(self):
        super().__init__()
        self.css, self.external, self.inside = [], [], False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "style":
            self.inside = True
        if "style" in attrs:
            self.css.append("x{" + attrs["style"] + "}")
        if tag == "link" or tag == "iframe" or (tag == "script" and "src" in attrs):
            self.external.append(tag)
        if tag == "svg":
            self.external.append("inline-svg")

    def handle_endtag(self, tag):
        if tag == "style":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.css.append(data)


MARKUP = re.compile(
    r"<(?:!doctype|html|style|button|input|svg|div|main|form)\b"
    r"|\{[^{}]*(?:color|background|font-family)\s*:", re.I)
FENCE = re.compile(r"^[ \t]*(?:```|~~~).*?(?:^[ \t]*(?:```|~~~)|\Z)", re.M | re.S)


def is_ui(path, text):
    """Is this an executable UI source, as opposed to prose about one?

    A design spec quotes the component it specifies; matching markup inside a
    fenced block called that prose "disguised UI" and rejected it with an
    adapter error no document could satisfy. tower-diseno-c5ab328d burned six
    turns writing probes to reverse-engineer the rule instead of designing.
    So fenced code is read as citation — unless the fences ARE the file, which
    is the disguise POLICY actually forbids.
    """
    if Path(path).suffix.lower() in UI_SUFFIXES:
        return True
    quoted = "".join(m.group(0) for m in FENCE.finditer(text))
    prose = FENCE.sub("", text)
    if MARKUP.search(prose):
        return True
    # An alibi sentence wrapped around a whole document is not a citation.
    return bool(quoted) and len(quoted) > 0.6 * len(text) and bool(MARKUP.search(quoted))


def validate_html(text, data):
    block = data["foundation_block"]
    if text.count(block) != 1:
        raise PermissionError("UI must contain the exact current Sapira foundation_block once")
    rest = text.replace(block, "", 1)
    parser = Styles(); parser.feed(rest)
    if parser.external:
        raise PermissionError("Self-contained HTML only: external styles/scripts, frames and inline SVG require another adapter")
    if re.search(r"[\U0001f300-\U0001faff\u2600-\u27bf]", rest):
        raise PermissionError("Sapira uses Lucide, not emoji icons; omit icons in the native HTML adapter")
    # Styling via scripts can bypass CSS validation. Only display toggles are
    # supported here; reject other style APIs instead of pretending to inspect them.
    if re.search(r"\.style\b(?!\.display\b)|cssText|insertRule|adoptedStyleSheets|createElement\s*\(\s*['\"](?:style|link)|setAttribute\s*\(\s*['\"]style", rest):
        raise PermissionError("Dynamic styles are outside the validated HTML adapter")
    # Include style attributes in JS template strings used for dynamic rows too.
    parser.css += ["x{" + m[1] + "}" for m in re.finditer(r'style=[\"\']([^\"\']*)[\"\']', rest)]
    result = subprocess.run(["rtk", "proxy", "node", str(pilot.REPO / "experiments/buzz-autonomy/design_css.cjs")],
        input=json.dumps({"css": parser.css, "tokens": list(data["tokens"])}), text=True,
        capture_output=True, timeout=15)
    if result.returncode:
        # The gate now returns every violation with its suggested tokens, so the
        # budget here has to fit the whole list. Truncating at 600 would cut the
        # spec in half and send the agent back for another round — the exact
        # attrition this was changed to end.
        raise PermissionError("Sapira CSS gate: " + result.stderr[:4000])


def before_write(role, job, path, text):
    ui = is_ui(path, text)
    if not ui and role not in {"designer", "ux"}:
        return None
    data = current_contract(job)
    if ui:
        if Path(path).suffix.lower() not in {".html", ".htm"}:
            raise PermissionError("UI source requires a supported design adapter; current pilot accepts self-contained HTML only")
        validate_html(text, data)
    return {"path": str(path), "sha256": digest(text), "sources": data["sources"],
            "kind": "html-foundation" if ui else "design-prose", "professional_acceptance": False}


def record(job, receipt):
    if receipt:
        path = pilot.ROOT / "design" / job / "writes.json"
        data = json.loads(path.read_text()) if path.exists() else {}
        data[receipt["path"]] = receipt
        pilot.write_json(path, data)


def validated_artifacts(job):
    """Receipts recorded for this job whose file on disk still matches the validated bytes.

    Pure read: a receipt whose file changed, vanished, or escaped the pilot
    scope is dropped — a changed file is not validated. Gate-validated is not
    the same as accepted; callers must not present these as done.
    """
    path = pilot.ROOT / "design" / job / "writes.json"
    if not path.exists():
        return []
    try:
        receipts = json.loads(path.read_text())
    except ValueError:
        return []
    artifacts = []
    for receipt in receipts.values():
        try:
            text = pilot.safe_path(receipt["path"]).read_text()
        except (OSError, PermissionError, KeyError, UnicodeDecodeError):
            continue
        if digest(text) != receipt.get("sha256"):
            continue
        artifacts.append({"path": receipt["path"], "sha256": receipt["sha256"], "kind": receipt.get("kind")})
    return artifacts


def completion(job):
    """Recheck source freshness and final artifact bytes before either transport closes."""
    path = pilot.ROOT / "design" / job / "writes.json"
    if not path.exists():
        return
    data = current_contract(job)
    for receipt in json.loads(path.read_text()).values():
        text = pilot.safe_path(receipt["path"]).read_text()
        if digest(text) != receipt["sha256"]:
            raise PermissionError("Design artifact changed after validation")
        if receipt["kind"] == "html-foundation":
            validate_html(text, data)
