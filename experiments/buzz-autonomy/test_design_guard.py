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
