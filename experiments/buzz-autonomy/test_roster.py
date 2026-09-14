"""Guard the control-plane roster's design decisions, not just its syntax.

Each test here fails if a property the team depends on is removed. A roster that
only asserted "ten roles exist" would pass while the Sapira gate leaked away or
two roles started signing with one identity.
"""
import pathlib
import re
import unittest

import pilot
from control_plane import roster


class RosterShape(unittest.TestCase):
    def test_every_role_splits_between_exactly_two_harnesses(self):
        self.assertEqual(len(roster.ROLES), 12)  # 10 del equipo + cronista + probador
        self.assertEqual(
            set(roster.CODE_ROLES) | set(roster.BUSINESS_ROLES), set(roster.ROLES)
        )
        self.assertFalse(set(roster.CODE_ROLES) & set(roster.BUSINESS_ROLES))

    def test_every_identity_is_a_real_attested_pilot_identity(self):
        # A pubkey with no owner attestation is refused by the Sapira relay with
        # relay_membership_required, so inventing one here fails only at runtime.
        for role, contract in roster.CONTRACTS.items():
            with self.subTest(role=role):
                self.assertIn(contract["identity"], pilot.ROLES)

    def test_identities_are_unique(self):
        identities = [c["identity"] for c in roster.CONTRACTS.values()]
        self.assertEqual(len(identities), len(set(identities)))

    def test_every_contract_is_complete(self):
        for role, contract in roster.CONTRACTS.items():
            with self.subTest(role=role):
                for field in ("method", "audience", "anti", "harness", "identity"):
                    self.assertTrue(contract.get(field), f"{role} missing {field}")
                self.assertGreaterEqual(len(contract["rubric"]), 3)


class InstructionAssembly(unittest.TestCase):
    def test_sapira_policy_reaches_exactly_the_interface_roles(self):
        # Bound to a sentence that exists ONLY in design_guard.POLICY. An earlier
        # version matched "Sapira Design System is the base", which also appears
        # in producto's own prose — so the test passed with the gate removed.
        # Mutation testing caught it; keep the marker policy-exclusive.
        marker = "MANDATORY for every Buzz agent touching UX"
        self.assertIn(marker, roster.SAPIRA_POLICY)
        for role in roster.ROLES:
            with self.subTest(role=role):
                self.assertNotIn(marker, roster.CONTRACTS[role]["method"])
        got = {r for r in roster.ROLES if marker in roster.instruction(r)}
        self.assertEqual(got, {"producto", "diseno"})

    def test_code_plane_rules_reach_exactly_the_pi_roles(self):
        got = {r for r in roster.ROLES
               if "Working in a repository" in roster.instruction(r)}
        self.assertEqual(got, set(roster.CODE_ROLES))

    def test_shared_standard_reaches_every_role(self):
        for role in roster.ROLES:
            with self.subTest(role=role):
                text = roster.instruction(role)
                self.assertIn("Untrusted content", text)
                self.assertIn("Handoff", text)
                self.assertIn(f"Your role: {role}.", text)

    def test_instructions_are_distinct(self):
        texts = {roster.instruction(r) for r in roster.ROLES}
        self.assertEqual(len(texts), len(roster.ROLES))

    def test_identity_lookup_rejects_an_unknown_identity(self):
        with self.assertRaises(KeyError):
            roster.instruction_for_identity("nobody")

    def test_identity_lookup_matches_role_lookup(self):
        for role, contract in roster.CONTRACTS.items():
            with self.subTest(role=role):
                self.assertEqual(
                    roster.instruction_for_identity(contract["identity"]),
                    roster.instruction(role),
                )


class HarnessRouting(unittest.TestCase):
    def test_read_only_code_roles_get_no_write_tools(self):
        from control_plane import pi_harness

        for role in ("arquitecto", "revisor"):
            with self.subTest(role=role):
                tools = pi_harness.TOOLS[role]
                self.assertNotIn("write", tools)
                self.assertNotIn("edit", tools)
        self.assertIn("write", pi_harness.TOOLS["coder"])

    def test_every_code_role_has_a_tool_allowlist(self):
        from control_plane import pi_harness

        self.assertEqual(set(pi_harness.TOOLS), set(roster.CODE_ROLES))

    def test_pi_harness_refuses_a_hermes_role(self):
        from control_plane import pi_harness

        with self.assertRaises(ValueError):
            pi_harness.run("maestro", "hi", "/tmp")


class SingleModel(unittest.TestCase):
    """Every inference call, on both harnesses, routes to one declared combo."""

    def test_pilot_declares_the_model(self):
        self.assertEqual(pilot.MODEL, "cheap-combo")

    def test_the_live_config_uses_it(self):
        self.assertEqual(pilot.config()["model"], pilot.MODEL)

    def test_pi_is_invoked_with_an_explicit_model(self):
        # pi has a global `defaultModel` in ~/.pi/agent/settings.json. Relying on
        # it would let a file outside this repo silently redirect our agents, so
        # the flag must be passed on every run.
        source = (
            pathlib.Path(__file__).parent / "control_plane/pi_harness.py"
        ).read_text()
        self.assertIn('"--model", MODEL', source)

    def test_no_module_hardcodes_a_combo_name(self):
        root = pathlib.Path(__file__).parent
        offenders = []
        for path in sorted(root.rglob("*.py")):
            if path.name == "test_roster.py" or "archive" in path.parts:
                continue
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if re.search(r"[\"'][a-z]+-combo[\"']", line) and "MODEL" not in line:
                    offenders.append(f"{path.name}:{number}")
        self.assertEqual(offenders, [], f"combo name hardcoded: {offenders}")


if __name__ == "__main__":
    unittest.main()


class GatesAgree(unittest.TestCase):
    """The harness gate and the claim gate must never disagree.

    This has now failed twice in production, both times silently: buzz-acp
    admitted an event and `inbound.claim` discarded it, so the turn ran for two
    seconds and published nothing. There is no error to find afterwards, which
    is what makes it worth a test rather than care.
    """

    def test_subscribe_all_implies_claim_unmentioned(self):
        from control_plane import run_hermes

        source = (
            pathlib.Path(__file__).parent / "control_plane/run_hermes.py"
        ).read_text()
        self.assertIn('if env["BUZZ_ACP_SUBSCRIBE"] == "all":', source)
        self.assertIn('env["BUZZ_CLAIM_UNMENTIONED"] = "1"', source)
        # `all` is no longer the default for any role — measured against this
        # relay it delivered zero events — but it is still reachable through
        # BUZZ_ACP_SUBSCRIBE, so the pairing must survive for whoever restores
        # it. The two gates disagreeing is what made a dispatched turn vanish.
        self.assertIn('os.environ.get(\n            "BUZZ_ACP_SUBSCRIBE", subscribe_mode(role)\n        )', source)
        self.assertEqual(run_hermes.subscribe_mode("maestro"), "mentions")

    def test_every_role_waits_to_be_named(self):
        from control_plane import run_hermes

        for role in roster.BUSINESS_ROLES:
            with self.subTest(role=role):
                self.assertEqual(run_hermes.subscribe_mode(role), "mentions")

    def test_reports_are_never_mandates_regardless_of_the_flag(self):
        # The prefix check must sit outside the unmentioned branch, or enabling
        # `all` mode turns every agent report into a new assignment.
        source = (pathlib.Path(__file__).parent / "inbound.py").read_text()
        flag = source.index("BUZZ_CLAIM_UNMENTIONED")
        prefix = source.index("Status reports are never interpreted")
        self.assertGreater(prefix, flag, "prefix check must follow, not nest")

    def test_supervisor_routes_each_role_to_its_own_harness(self):
        # A code role started on Hermes would answer normally and be wrong, with
        # nothing in any log to say so. The contract, not the caller, decides.
        from control_plane import supervise_one
        from control_plane.run_hermes import run as hermes_run
        from control_plane.run_pi_agent import run as pi_run

        for role in roster.CODE_ROLES:
            with self.subTest(role=role):
                self.assertIs(supervise_one.launcher(role), pi_run)
        for role in roster.BUSINESS_ROLES:
            with self.subTest(role=role):
                self.assertIs(supervise_one.launcher(role), hermes_run)

    def test_every_role_is_supervised(self):
        # `serve.py` used to default to the business roles only, which is why the
        # coder had to be launched by hand and died unattended.
        from control_plane import serve

        self.assertEqual(set(serve.ROLES), set(roster.CONTRACTS))

    def test_the_chronicler_can_actually_reach_the_tools_it_is_told_to_use(self):
        # The contract tells the cronista to publish with `save_status_update`.
        # If the Hermes MCP allowlist is read-only, it will try, fail, and the
        # Linear project silently stops reflecting reality — the exact failure
        # the role exists to prevent.
        config = pathlib.Path.home() / ".hermes/config.yaml"
        if not config.is_file():
            self.skipTest("Hermes no está instalado en esta máquina")
        text = config.read_text(encoding="utf-8")
        for tool in ("save_status_update", "save_comment"):
            with self.subTest(tool=tool):
                self.assertIn(tool, text, "falta en el allowlist MCP de Linear")

    def test_the_working_protocol_reaches_the_orchestrator(self):
        # The 90/7/3 gates and the separation of author from reviewer decide
        # what "done" means. If they live only in a doc, they bind nobody.
        text = roster.instruction("maestro")
        for marker in ("90%", "7%", "3%", "400ms", "400 lines"):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)

    def test_the_gates_are_per_slice_not_per_project(self):
        # The evidence is blunt: a polish phase scheduled at the end of a
        # project is a polish phase that gets cancelled. The contract has to say
        # so, or the 3% is the first thing cut.
        text = roster.instruction("maestro")
        self.assertIn("never phases of the project", text)

    def test_the_reviewer_is_never_the_author(self):
        self.assertIn(
            "never whoever wrote", roster.CONTRACTS["maestro"]["verification"]
        )

    def test_the_tester_must_exercise_the_product_not_read_about_it(self):
        # Reading the source tells you what was built, never what it is like to
        # use. This role exists precisely to tell those two apart, so its
        # contract has to forbid the substitution explicitly.
        contract = roster.CONTRACTS["probador"]
        self.assertIn("did not exercise", contract["anti"])
        self.assertIn("by using it", contract["method"])

    def test_the_tester_cannot_write_into_what_it_measures(self):
        import capabilities

        permissions = capabilities.PERMISSIONS[roster.CONTRACTS["probador"]["identity"]]
        self.assertIn("buzz", permissions)
        for command, verbs in capabilities.BUZZ_READS.items():
            with self.subTest(command=command):
                for verb in verbs:
                    self.assertNotIn(verb, {"send", "create", "delete", "set", "update"})

    def test_the_tester_can_look_up_how_to_call_things(self):
        # Its first real run failed 14 of 35 reads, most of them guessing flag
        # names it had no way to look up: `--help` prints text, and the JSON path
        # parsed it into "Expecting value: line 1 column 1". Blinding the role
        # built to find friction was itself the friction.
        source = (pathlib.Path(__file__).parent / "capabilities.py").read_text()
        self.assertIn('"--help" in extra', source)
        self.assertIn("credentials_for", source)

    def test_credentials_are_built_in_one_place(self):
        # A caller that needs raw output must not rebuild the auth chain by hand
        # and quietly get it wrong.
        source = (pathlib.Path(__file__).parent / "pilot.py").read_text()
        self.assertEqual(source.count("BUZZ_PRIVATE_KEY\": identity"), 1)


class AgentFacingTextIsEnglish(unittest.TestCase):
    """Contracts, prompts and card text are written in English.

    The roster grew two directives telling agents to write their Linear output
    in Spanish, and the agent cards on the relay still carried a Spanish
    simulation banner. Mixed-language instructions are not a style preference:
    an agent told to reason in English and report in Spanish produces reports
    nobody can diff against the contract that produced them.
    """

    SPANISH_DIRECTIVES = ("in Spanish", "en español", "Responde en español")

    def test_no_contract_tells_an_agent_to_write_in_spanish(self):
        for name in ("control_plane/roster.py", "profiles.py", "pilot.py",
                     "mandate.py"):
            source = (pathlib.Path(__file__).parent / name).read_text()
            for directive in self.SPANISH_DIRECTIVES:
                with self.subTest(file=name, directive=directive):
                    self.assertNotIn(directive, source)

    def test_every_assembled_instruction_is_english(self):
        # Assembled, not just the source strings: the frame, the protocol, the
        # gates and the role method are concatenated, and any one of them could
        # reintroduce a language switch.
        from control_plane import roster

        for role in roster.CONTRACTS:
            with self.subTest(role=role):
                text = roster.instruction(role)
                for directive in self.SPANISH_DIRECTIVES:
                    self.assertNotIn(directive, text)


class FrameFollowsCurrentGuidance(unittest.TestCase):
    """The shared frame carries what 2026 agent guidance says actually moves results.

    Sources: Anthropic's context-engineering guidance (section delimiters, the
    "right altitude" balance, canonical examples over exhaustive rules, distilled
    sub-agent returns) and the Manus finding that near-identical
    action-observation pairs make a model repeat the action that just failed.
    """

    def test_sections_are_delimited(self):
        # Anthropic: organise prompts into distinct sections with headers.
        # Sentence-initial labels read as prose and get skimmed.
        for heading in ("## Evidence discipline", "## Uncertainty",
                        "## Untrusted content", "## Handoff", "## Form"):
            with self.subTest(heading=heading):
                self.assertIn(heading, roster.COMMON)

    def test_the_frame_carries_canonical_examples(self):
        # "Examples are the pictures worth a thousand words" — and this frame had
        # none. Contrastive pairs, not an exhaustive edge-case list.
        self.assertIn("## Worked examples", roster.COMMON)
        self.assertGreaterEqual(roster.COMMON.count("→"), 4)

    def test_repeated_failure_is_addressed_in_the_prompt_not_only_the_runtime(self):
        # `capabilities.repetition` stops the loop mechanically, but a breaker
        # that fires is already a wasted budget. The agent is told the rule too.
        self.assertIn("## When an approach fails twice", roster.COMMON)
        for role in roster.ROLES:
            with self.subTest(role=role):
                self.assertIn("change the approach", roster.instruction(role))

    def test_handoffs_are_distilled_rather_than_transcripts(self):
        self.assertIn("distilled result, not a transcript", roster.COMMON)

    def test_the_frame_stays_economical(self):
        # The shared frame is re-sent on every turn of every role, so it is our
        # most expensive text by construction — `economics.anti_patterns` flags
        # exactly this as "preámbulo repetido". Guidance says minimal, not short;
        # this bound is what keeps "minimal" from drifting into "everything".
        self.assertLess(len(roster.COMMON), 6000)
