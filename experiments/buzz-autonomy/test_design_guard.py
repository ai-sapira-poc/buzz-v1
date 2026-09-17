"""Adversarial foundation checks at the real pilot write boundary."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import capabilities
import context
import design_guard as guard
import pilot


class DesignEnforcement(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for module in (pilot, context, capabilities):
            p = patch.object(module, "ROOT", root / "runtime")
            p.start(); self.addCleanup(p.stop)
        source = root / "source"
        source.mkdir()
        for name in guard.SOURCES:
            target = source / name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((context.SOURCES["design"] / name).read_bytes())
        p = patch.dict(context.SOURCES, {"design": source})
        p.start(); self.addCleanup(p.stop)
        self.source = source

    def html(self):
        packet = capabilities.operate("coder", "design", "context", {"operation": "design"})
        return '<!doctype html><html><head>' + packet["foundation_block"] + '''
<style>body {font-family: var(--font-sans); color: var(--color-text-primary);
background: var(--color-surface-default); padding: var(--space-page-margin);}
button {color: var(--color-interactive-foreground);background: var(--color-interactive-default);}</style>
</head><body><button>Pedido</button></body></html>'''

    def write(self, role, text, path="ui.html"):
        return capabilities.operate(role, "design", "write", {"path": path, "content": text})

    def test_every_role_cannot_write_unbased_ui(self):
        for role in pilot.ROLES:
            with self.subTest(role=role), self.assertRaises(PermissionError):
                self.write(role, '<html><style>body{color:red}</style></html>')
        self.assertFalse((pilot.ROOT / 'artifacts/ui.html').exists())

    def test_valid_foundation_and_completion(self):
        receipt = self.write("coder", self.html())
        self.assertFalse(receipt["design_foundation"]["professional_acceptance"])
        guard.completion("design")

    def test_reading_sources_alone_does_not_allow_custom_palette(self):
        html = self.html().replace('</head>', '<style>button{background:orange}</style></head>')
        with self.assertRaises(PermissionError): self.write("designer", html)

    def test_token_override_and_fallback_are_rejected(self):
        for css in (':root{--color-text-primary:red}', 'body{color:var(--unknown)}',
                    'body{color:var(--color-text-primary,red)}', 'body{color:red!important}'):
            with self.subTest(css=css), self.assertRaises(PermissionError):
                self.write("product", self.html().replace('</head>', '<style>'+css+'</style></head>'))

    def test_disguised_ui_and_unsupported_stack_fail_closed(self):
        for path in ('report.md', 'ui.tsx'):
            with self.subTest(path=path), self.assertRaises(PermissionError): self.write("coder", self.html(), path)

    def test_inline_and_dynamic_style_override_rejected(self):
        for extra in ('<p style="color:red">Oops</p>', '<script>document.body.style.color="red"</script>',
                      '<link rel="stylesheet" href="other.css">', '<script src="other.js"></script>'):
            with self.subTest(extra=extra), self.assertRaises(PermissionError):
                self.write("coder", self.html().replace('</body>', extra+'</body>'))

    def test_source_change_invalidates_write_and_completion(self):
        html = self.html(); self.write("coder", html)
        (self.source / 'AGENTS.md').write_text('updated guidance')
        with self.assertRaises(PermissionError): self.write("coder", html)
        with self.assertRaises(PermissionError): guard.completion('design')

    def test_artifact_change_invalidates_completion(self):
        self.write("coder", self.html())
        (pilot.ROOT / 'artifacts/ui.html').write_text('changed outside gate')
        with self.assertRaises(PermissionError): guard.completion('design')

    def test_ux_requires_base_but_other_plain_work_is_unaffected(self):
        with self.assertRaises(PermissionError): self.write('ux', 'Usability plan', 'plan.md')
        self.html()
        self.write('ux', 'Sapira is the required foundation. Usability is unverified.', 'plan.md')
        capabilities.operate('analyst', 'metrics', 'write', {'path':'metrics.json','content':'{"count": 1}'})


if __name__ == '__main__': unittest.main()


class GateTeachesInsteadOfAttrition(unittest.TestCase):
    """The gate must report every violation at once, with what to use instead.

    Measured: the designer spent three whole assignments (16/16, 24/24, 16/16
    iterations) learning this gate's rules one rejected write at a time, and
    the budget died before an artifact existed. Its own report asked for "el
    spec exacto del gate". Reporting one violation per call is what turned a
    linter into a guessing game.
    """

    def gate(self, css, tokens):
        import subprocess
        result = subprocess.run(
            ["node", str(Path(__file__).parent / "design_css.cjs")],
            input=json.dumps({"css": [css], "tokens": tokens}),
            text=True, capture_output=True, timeout=20)
        return result.returncode, result.stderr

    def test_every_violation_is_reported_in_one_pass(self):
        code, message = self.gate(
            ".a{ margin: 0 0 4px; gap: 0.375rem; color: #333; }",
            ["--space-component-gap", "--color-text-heading"])
        self.assertEqual(code, 1)
        for prop in ("margin", "gap", "color"):
            self.assertIn(prop, message)
        self.assertIn("3 infracción(es)", message)

    def test_each_violation_names_a_usable_token(self):
        _, message = self.gate(".a{ gap: 0.375rem; }",
                               ["--space-component-gap", "--color-text-heading"])
        self.assertIn("--space-component-gap", message)
        self.assertNotIn("--color-text-heading", message,
                         "no sugieras un token de otra familia")

    def test_a_property_with_no_token_is_told_so_rather_than_misadvised(self):
        # A wrong suggestion costs an iteration to disprove, so it is worse
        # than staying silent. `font-variant-numeric` once drew
        # `--font-weight-bold`, which cannot satisfy it.
        _, message = self.gate(".a{ font-variant-numeric: tabular-nums; }",
                               ["--font-weight-bold"])
        self.assertIn("no hay token", message)
        self.assertNotIn("--font-weight-bold", message)

    def test_repeats_of_one_rule_collapse_to_one_lesson(self):
        _, message = self.gate(".a{ gap: 0.375rem; } .b{ gap: 0.375rem; }",
                               ["--space-component-gap"])
        self.assertIn("1 infracción(es)", message)

    def test_valid_token_usage_still_passes(self):
        code, _ = self.gate(
            ".a{ gap: var(--space-component-gap); color: var(--color-text-heading); }",
            ["--space-component-gap", "--color-text-heading"])
        self.assertEqual(code, 0)

    def test_a_prose_spec_quoting_code_is_prose_not_disguised_ui(self):
        # tower-diseno-c5ab328d (2026-09-16): the designer wrote its section
        # spec as markdown that quotes TSX, and `is_ui` matched the `<div` and
        # `{color:` inside the fences. The rejection — "UI source requires a
        # supported design adapter; self-contained HTML only" — cannot be
        # satisfied by a spec document, so the agent spent turns 9-14 writing
        # probe-a/probe-b/probe-c to reverse-engineer the rule. A design spec
        # that cites the component it specifies is the normal case.
        spec = (
            "# Especificación de la sección\n\nLa fila se compone así:\n\n"
            "```tsx\nconst Row = ({p}) => <div className=\"row\">{p.name}</div>;\n```\n\n"
            "Estados: cargando, vacío, error. El foco vuelve al disparador.\n"
            "Cada cifra viaja con su denominador, y el silencio no es progreso.\n"
        )
        self.assertFalse(guard.is_ui("tower/spec.md", spec))

    def test_executable_ui_hidden_in_a_text_file_is_still_caught(self):
        # The guard exists because POLICY forbids disguising executable UI as
        # prose. Stripping fences must not become that loophole: a file whose
        # body IS the document, with a sentence of alibi, stays UI.
        disguised = (
            "Notas.\n\n```\n<!doctype html><html><head><style>\n"
            "body { color: #333; background: #fff; font-family: Inter; }\n"
            "</style></head><body><div class=\"app\"><button>Ir</button></div>"
            "</body></html>\n```\n"
        )
        self.assertTrue(guard.is_ui("tower/notas.md", disguised))
        self.assertTrue(guard.is_ui("tower/screen.html", "<div>hola</div>"))

    def test_layout_properties_without_a_token_family_are_not_violations(self):
        # Observed in job diseno-tower-slice1-screen (2026-09-15): the gate
        # flagged `border-collapse: collapse` and `background-size: 100% 100%`
        # and told the agent "no hay token; no la uses". Neither property has
        # anything to do with the palette — they are table/layout mechanics.
        # Following that advice would break the table; refusing it cost the
        # designer three of its last six turns. A false positive that cannot
        # be satisfied is the most expensive rejection there is.
        code, message = self.gate(
            ".t{ border-collapse: collapse; border-spacing: 0; background-size: 100% 100%;"
            " background-repeat: no-repeat; background-position: center; background-clip: padding-box; }",
            ["--color-border-default", "--color-surface-default"])
        self.assertEqual(code, 0, message)

    def test_shadow_composed_of_geometry_and_a_color_token_passes(self):
        # Same run: `box-shadow: 0 -1px 0 0 var(--color-border-subtle), 0 1px 0
        # 0 var(--color-border-subtle)` was rejected although its only colour IS
        # a Sapira token. Offsets and blur are geometry, like border widths.
        code, message = self.gate(
            ".r{ box-shadow: 0 -1px 0 0 var(--color-border-subtle), inset 0 1px 2px var(--color-border-subtle); }",
            ["--color-border-subtle", "--shadow-subtle"])
        self.assertEqual(code, 0, message)

    def test_shadow_with_a_literal_colour_is_still_rejected(self):
        code, message = self.gate(
            ".r{ box-shadow: 0 1px 2px rgba(0,0,0,.2); }", ["--shadow-subtle"])
        self.assertEqual(code, 1)
        self.assertIn("--shadow-subtle", message)

    def test_the_whole_list_survives_the_error_budget(self):
        # Truncating the message at 600 chars would cut the spec in half and
        # send the agent back for another round — the attrition this ends.
        source = (Path(__file__).parent / "design_guard.py").read_text()
        self.assertIn("result.stderr[:4000]", source)
