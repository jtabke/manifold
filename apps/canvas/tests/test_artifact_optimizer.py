"""Independent numeric oracles and process-lifetime contracts for the adapter."""

import copy
import importlib.util
import json
import math
from pathlib import Path
import random
import shutil
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import artifact_optimizer as optimizer


# Canonical DAG fixtures are independent of any TS lowering/graph owner.
def quadratic():
    return {
        "nodes": [
            {"op": "x"},
            {"op": "const", "value": 2},
            {"op": "sub", "args": [0, 1]},
            {"op": "mul", "args": [2, 2]},
        ],
        "output": 3,
    }


def variable():
    return {"nodes": [{"op": "x"}], "output": 0}


def constant(value):
    return {"nodes": [{"op": "const", "value": value}], "output": 0}


def unary(op):
    return {"nodes": [{"op": "x"}, {"op": op, "args": [0]}], "output": 1}


def request(program=None, mode="minimize", backend=None, **changes):
    program = program if program is not None else quadratic()
    body = {
        "version": optimizer.VERSION,
        "program": program,
        "program_sha256": optimizer.program_digest(program),
        "backend": backend
        or {
            "adapter": optimizer.VERSION,
            "source_sha256": "0" * 64,
            "python": "3.12.16",
            "numpy": "2.2.6",
            "scipy": "1.15.3",
        },
        "mode": mode,
        "bounds": [-3, 5],
        "target": 0 if mode == "target" else None,
        "x_tolerance": 1e-9,
        "residual_tolerance": 1e-8 if mode == "target" else None,
        "limits": {"evaluations": 500, "iterations": 200, "wall_ms": 5000},
    }
    body.update(changes)
    return body


class ValidationTests(unittest.TestCase):
    def test_import_is_lazy(self):
        script = f"import sys; sys.path.insert(0, {str(Path(optimizer.__file__).parent)!r}); import artifact_optimizer; assert 'scipy' not in sys.modules; assert 'numpy' not in sys.modules"
        subprocess.run([sys.executable, "-I", "-c", script], check=True)

    def test_exact_fields_and_numbers(self):
        base = request()
        cases = []
        for field, value in [
            ("version", 1),
            ("mode", "eval"),
            ("bounds", [0, 0]),
            ("bounds", [True, 1]),
            ("bounds", [0, float("inf")]),
            ("target", 4),
            ("x_tolerance", 0),
            ("x_tolerance", True),
            ("residual_tolerance", 0),
            ("program_sha256", "X" * 64),
            ("limits", {"evaluations": 0, "iterations": 1, "wall_ms": 1}),
            ("limits", {"evaluations": 1, "iterations": True, "wall_ms": 1}),
            ("limits", {"evaluations": 1, "iterations": 1001, "wall_ms": 1}),
            ("limits", {"evaluations": 1, "iterations": 1, "wall_ms": 30001}),
        ]:
            body = copy.deepcopy(base)
            body[field] = value
            cases.append(body)
        cases += [
            {**base, "code": "import os"},
            {k: v for k, v in base.items() if k != "target"},
        ]
        for body in cases:
            with (
                self.subTest(body=repr(body)[:100]),
                self.assertRaises(optimizer.InvalidRequest),
            ):
                optimizer.solve(body)
        for changes in (
            {"target": True},
            {"target": float("nan")},
            {"residual_tolerance": -1},
            {"residual_tolerance": None},
        ):
            with self.assertRaises(optimizer.InvalidRequest):
                optimizer.validate(request(mode="target", **changes))

    def test_malicious_and_oversized_programs(self):
        programs = [
            {"nodes": [{"op": "__import__", "args": []}], "output": 0},
            {"nodes": [{"op": "os.system", "args": []}], "output": 0},
            {"nodes": [{"op": "x", "path": "/tmp/anything"}], "output": 0},
            {"nodes": [{"op": "const", "value": True}], "output": 0},
            constant(float("nan")),
            constant(1e13),
            constant("1"),
            {"nodes": [{"op": "add", "args": [0, 0]}], "output": 0},
            {"nodes": [{"op": "x"}, {"op": "neg", "args": [-1]}], "output": 1},
            {"nodes": [{"op": "x"}, {"op": "neg", "args": [True]}], "output": 1},
            {"nodes": [{"op": "x"}, {"op": "sin", "args": [0, 0]}], "output": 1},
            {"nodes": [{"op": "x"}] * 257, "output": 0},
            {"nodes": [{"op": "x"}, {"op": "x"}], "output": 0},
            {"nodes": [{"op": "x"}], "output": True},
        ]
        nodes = [{"op": "x"}] + [{"op": "neg", "args": [i]} for i in range(32)]
        programs.append({"nodes": nodes, "output": 32})
        for program in programs:
            with (
                self.subTest(program=repr(program)[:100]),
                self.assertRaises(optimizer.InvalidRequest),
            ):
                optimizer.validate_program(program)
        with self.assertRaises(optimizer.InvalidRequest):
            optimizer.validate({"huge": "x" * 65536})
        cycle = []
        cycle.append(cycle)
        with self.assertRaises(optimizer.InvalidRequest):
            optimizer.validate(cycle)

    def test_digest_and_source_contract(self):
        program = quadratic()
        self.assertEqual(
            optimizer.program_digest(program),
            optimizer.program_digest(dict(reversed(list(program.items())))),
        )
        self.assertEqual(
            optimizer.program_digest(constant(1)),
            optimizer.program_digest(constant(1.0)),
        )
        self.assertNotEqual(
            optimizer.program_digest(constant(0.0)),
            optimizer.program_digest(constant(-0.0)),
        )
        self.assertEqual(
            optimizer.program_digest(constant(2)),
            "fccf28040726cd9a9be993e6de5e1f5bfb4880c34928df553e2caa695f10dc2b",
        )
        body = request()
        body["program_sha256"] = "0" * 64
        with patch.object(
            optimizer, "_spawn", side_effect=AssertionError("Must not spawn")
        ):
            self.assertEqual(optimizer.solve(body)["code"], "program_mismatch")

    def test_missing_dependency_controlled(self):
        original_import = __import__

        def missing(name, *args, **kwargs):
            if name == "scipy":
                raise ModuleNotFoundError("scipy")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=missing):
            self.assertEqual(optimizer._execute(request())["code"], "unavailable")
        # Real isolated worker with stdlib only, regardless of host site packages.
        script = f"import sys; sys.path.insert(0, {str(Path(optimizer.__file__).parent)!r}); import artifact_optimizer as o; print(o._execute({request()!r})['code'])"
        completed = subprocess.run(
            [sys.executable, "-I", "-S", "-c", script],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(completed.stdout.strip(), "unavailable")

    def test_malformed_worker_output_is_not_relayed(self):
        body = request()
        for result in (
            {"version": optimizer.VERSION},
            {**optimizer._result(body, "converged"), "success": "yes"},
        ):
            with self.assertRaises(optimizer.InvalidRequest):
                optimizer._decode_result(json.dumps(result), body)

    def test_transport_failure_and_precancel(self):
        with patch.object(optimizer, "_spawn", side_effect=OSError("no worker")):
            self.assertEqual(optimizer.solve(request())["code"], "transport_error")
        with patch.object(optimizer, "_spawn", side_effect=AssertionError("spawn")):
            result = optimizer.solve(request(), cancelled=lambda: True)
            self.assertEqual(result["code"], "cancelled")
            self.assertEqual(result["evaluations"], 0)


class OperationTests(unittest.TestCase):
    def test_rounding_and_negative_cube_root(self):
        for x, expected in [
            (-2.5, -3),
            (-1.5, -2),
            (-0.5, -1),
            (0.5, 1),
            (2.5, 3),
            (0.49999999999999994, 1),
            (-0.49999999999999994, -1),
        ]:
            self.assertEqual(optimizer._evaluate(unary("round"), x), expected)
        self.assertAlmostEqual(optimizer._evaluate(unary("cbrt"), -27), -3)

    def test_independent_function_oracles(self):
        oracles = {
            "asin": (0.5, math.pi / 6),
            "acos": (0.5, math.pi / 3),
            "atan": (1, math.pi / 4),
            "sinh": (0, 0),
            "cosh": (0, 1),
            "tanh": (0, 0),
            "ln": (math.e, 1),
            "log10": (100, 2),
            "sin": (math.pi / 6, 0.5),
            "cos": (math.pi / 3, 0.5),
            "tan": (math.pi / 4, 1),
            "sqrt": (9, 3),
            "abs": (-3, 3),
            "floor": (-1.2, -2),
            "ceil": (-1.2, -1),
            "exp": (0, 1),
        }
        for op, (x, y) in oracles.items():
            self.assertAlmostEqual(optimizer._evaluate(unary(op), x), y, places=12)

    def test_negative_fractional_powers(self):
        for base, exponent, expected in [
            (-8, 1 / 3, -2),
            (-8, 2 / 3, 4),
            (-32, 0.2, -2),
            (-8, -1 / 3, -0.5),
            (-32, -0.2, -0.5),
        ]:
            self.assertAlmostEqual(optimizer._power(base, exponent), expected)
        with self.assertRaises(ValueError):
            optimizer._power(-1, 0.5)
        with self.assertRaises(ValueError):
            optimizer._power(-2, 13)

    @unittest.skipUnless(
        shutil.which("node")
        and (Path(__file__).resolve().parents[3] / "node_modules/mathjs").is_dir(),
        "differential fixtures require repository Node/Math.js installation",
    )
    def test_mathjs_power_and_rounding_parity(self):
        root = Path(__file__).resolve().parents[3]
        cases = []
        for value in [
            -2.5,
            -1.5,
            -1,
            -0.5,
            0,
            0.5,
            1,
            1.5,
            2.5,
            1e-16,
            -1e-16,
            1e12,
            -1e12,
            0.49999999999999994,
            -0.49999999999999994,
        ]:
            for boundary in [
                value,
                math.nextafter(value, -math.inf),
                math.nextafter(value, math.inf),
            ]:
                for op in ["round", "floor", "ceil"]:
                    cases.append([op, [boundary]])
        for numerator in [-7, -2, -1, 1, 2, 7]:
            for denominator in [1, 2, 3, 5, 7, 11, 16, 31]:
                cases.append(["pow", [-8, numerator / denominator]])
        rng = random.Random(73)
        for _ in range(100):
            cases.append(["pow", [-rng.uniform(0.01, 100), rng.uniform(-12, 12)]])
            cases.append(["round", [rng.uniform(-1000, 1000)]])
        oracle = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                """
import {create, all} from 'mathjs';
import {readFileSync} from 'node:fs';
const math = create(all, {number:'number', predictable:true});
const cases = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map(([op,args]) => {
  try { const result=math[op](...args); return Number.isFinite(result)?result:null; }
  catch { return null; }
})));""",
            ],
            input=json.dumps(cases),
            text=True,
            capture_output=True,
            cwd=root,
            timeout=30,
            check=True,
        )
        for (op, args), expected in zip(cases, json.loads(oracle.stdout), strict=True):
            with self.subTest(op=op, args=args):
                try:
                    actual = (
                        optimizer._power(*args)
                        if op == "pow"
                        else optimizer.UNARY[op](*args)
                    )
                except (ValueError, OverflowError):
                    actual = None
                if expected is None or op != "pow":
                    self.assertEqual(actual, expected)
                else:
                    self.assertIsNotNone(actual)
                    self.assertTrue(
                        math.isclose(actual, expected, rel_tol=1e-13, abs_tol=1e-15),
                        (actual, expected),
                    )

    def test_existing_sampler_admitted_operations(self):
        from artifact_sampler import execute

        sampled = execute(
            {
                "mathVersion": 2,
                "inputs": {},
                "code": "x = linspace(1, 2, 3)\ny = [sin(a) + log(a) for a in x]",
            }
        )
        program = {
            "nodes": [
                {"op": "x"},
                {"op": "sin", "args": [0]},
                {"op": "ln", "args": [0]},
                {"op": "add", "args": [1, 2]},
            ],
            "output": 3,
        }
        for x, y in sampled["points"]:
            self.assertAlmostEqual(optimizer._evaluate(program, x), y, places=14)


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12) and importlib.util.find_spec("scipy"),
    "requires pinned Python 3.12 optimizer venv",
)
class SolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = optimizer.backend_identity()
        if not optimizer._supported(cls.backend):
            raise AssertionError("Run solver tests in the documented pinned profile")

    def solve(self, program=None, mode="minimize", **changes):
        body = request(program, mode, backend=self.backend, **changes)
        result = optimizer.solve(body)
        self.assertEqual(result["program_sha256"], body["program_sha256"])
        self.assertLess(len(json.dumps(result)), optimizer.MAX_OUTPUT_BYTES)
        return result

    def test_analytic_minimum_and_maximum(self):
        result = self.solve()
        self.assertEqual(result["code"], "converged")
        self.assertAlmostEqual(result["candidate"]["x"], 2, places=7)
        self.assertAlmostEqual(result["candidate"]["output"], 0, places=12)
        program = quadratic()
        program["nodes"].append({"op": "neg", "args": [3]})
        program["output"] = 4
        result = self.solve(program, "maximize")
        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["candidate"]["x"], 2, places=7)

    def test_negative_fractional_power_solver(self):
        program = {
            "nodes": [
                {"op": "x"},
                {"op": "const", "value": 1 / 3},
                {"op": "pow", "args": [0, 1]},
            ],
            "output": 2,
        }
        result = self.solve(program, bounds=[-8, -1])
        self.assertTrue(result["success"])
        self.assertEqual(result["candidate"]["x"], -8)
        self.assertAlmostEqual(result["candidate"]["output"], -2)
        result = self.solve(program, "target", bounds=[-8, -1], target=-1.5)
        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["candidate"]["x"], -3.375, places=6)

    def test_endpoints_and_constant(self):
        for mode, expected in [("minimize", -3), ("maximize", 5)]:
            result = self.solve(variable(), mode)
            self.assertEqual(result["candidate"]["x"], expected)
            self.assertGreaterEqual(result["evaluations"], 4)
        result = self.solve(constant(7))
        self.assertTrue(result["success"])
        self.assertEqual(result["candidate"]["output"], 7)

    def test_bracketed_target_and_endpoint(self):
        result = self.solve(variable(), "target", target=1.25)
        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["candidate"]["x"], 1.25, places=8)
        self.assertLessEqual(abs(result["candidate"]["residual"]), 1e-8)
        for target in (-3, 5, -3 + 1e-10):
            result = self.solve(variable(), "target", target=target)
            self.assertTrue(result["success"])
            self.assertEqual(result["evaluations"], 2)

    def test_no_bracket_tangent_and_constant(self):
        for program, target in [(quadratic(), 0), (variable(), 8), (constant(1), 0)]:
            result = self.solve(program, "target", target=target)
            self.assertEqual(result["code"], "no_bracket")
            self.assertFalse(result["success"])
        self.assertTrue(self.solve(constant(1), "target", target=1)["success"])

    def test_discontinuity_not_a_root(self):
        result = self.solve(unary("floor"), "target", bounds=[0, 2], target=0.5)
        self.assertEqual(result["code"], "residual_not_met")
        self.assertFalse(result["success"])
        self.assertGreater(abs(result["candidate"]["residual"]), 1e-8)

    def test_domain_pole_and_overflow(self):
        pole = {
            "nodes": [
                {"op": "x"},
                {"op": "const", "value": 1},
                {"op": "div", "args": [1, 0]},
            ],
            "output": 2,
        }
        for program, bounds in [
            (unary("sqrt"), [-1, 2]),
            (unary("exp"), [0, 1000]),
            (pole, [0, 2]),
        ]:
            result = self.solve(program, bounds=bounds)
            self.assertEqual(result["code"], "domain_error")
            self.assertFalse(result["success"])
        result = self.solve(pole, "target", bounds=[-1, 1], target=0)
        self.assertEqual(result["code"], "domain_error")

    def test_evaluation_and_iteration_limits(self):
        for budget in (1, 2, 3, 4):
            result = self.solve(
                limits={"evaluations": budget, "iterations": 200, "wall_ms": 5000}
            )
            self.assertEqual(result["code"], "evaluation_limit")
            self.assertEqual(result["evaluations"], budget)
        result = self.solve(
            limits={"evaluations": 500, "iterations": 1, "wall_ms": 5000}
        )
        self.assertEqual(result["code"], "iteration_limit")
        result = self.solve(
            unary("cos"),
            "target",
            bounds=[0, 2],
            limits={"evaluations": 500, "iterations": 1, "wall_ms": 5000},
        )
        self.assertEqual(result["code"], "iteration_limit")

    def test_backend_identity_mismatch(self):
        for field in ("adapter", "source_sha256", "python", "numpy", "scipy"):
            backend = dict(self.backend)
            backend[field] = "0" * 64 if field == "source_sha256" else "wrong"
            result = optimizer.solve(request(backend=backend))
            self.assertEqual(result["code"], "backend_mismatch")
            self.assertEqual(result["backend"], self.backend)
            self.assertEqual(result["evaluations"], 0)

    def test_unsupported_actual_profile_is_not_silently_accepted(self):
        actual = {**self.backend, "scipy": "0.0.0"}
        with patch.object(optimizer, "_load_backend", return_value=(actual, None)):
            result = optimizer._execute(request(backend=actual))
        self.assertEqual(result["code"], "backend_mismatch")
        self.assertEqual(result["evaluations"], 0)

    def test_final_evaluation_is_budgeted(self):
        complete = self.solve()
        budget = complete["evaluations"] - 1
        result = self.solve(
            limits={"evaluations": budget, "iterations": 200, "wall_ms": 5000}
        )
        self.assertEqual(result["code"], "evaluation_limit")
        self.assertEqual(result["evaluations"], budget)
        self.assertIsNotNone(result["candidate"])

    def test_fixed_thread_environment(self):
        with patch.object(
            optimizer.subprocess, "Popen", wraps=subprocess.Popen
        ) as spawn:
            self.assertTrue(self.solve()["success"])
        args, kwargs = spawn.call_args
        self.assertEqual(args[0][0], sys.executable)
        self.assertEqual(args[0][1], "-I")
        self.assertNotIn("shell", kwargs)
        self.assertEqual(kwargs["env"]["OPENBLAS_NUM_THREADS"], "1")

    def test_deadline_and_callable_cancellation_reap(self):
        processes = []
        original = optimizer._spawn

        def record(kind):
            process = original(kind)
            processes.append(process)
            return process

        with patch.object(optimizer, "_spawn", side_effect=record):
            result = self.solve(
                limits={"evaluations": 500, "iterations": 200, "wall_ms": 1}
            )
            self.assertEqual(result["code"], "deadline")
            event = threading.Event()
            timer = threading.Timer(0.03, event.set)
            timer.start()
            try:
                result = optimizer.solve(
                    request(backend=self.backend), cancelled=event.is_set
                )
            finally:
                timer.join()
            self.assertEqual(result["code"], "cancelled")
        for process in processes:
            self.assertIsNotNone(process.poll())
            self.assertTrue(process.stdin.closed)
            self.assertTrue(process.stdout.closed)

    def test_cooperative_deadline_no_penalty(self):
        # Deterministic in-worker deadline after imports, independent of scheduler speed.
        identity, scipy_optimize = optimizer._load_backend()
        with (
            patch.object(
                optimizer, "_load_backend", return_value=(identity, scipy_optimize)
            ),
            patch.object(optimizer.time, "monotonic", side_effect=[0, 10]),
        ):
            result = optimizer._execute(request(backend=identity))
        self.assertEqual(result["code"], "deadline")
        self.assertEqual(result["evaluations"], 0)


if __name__ == "__main__":
    unittest.main()
