"""Version-scoped sampler admission and scalar semantics, independent references."""
import sys
import math
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from artifact_sampler import execute, validate


class ScientificV3Tests(unittest.TestCase):
    def body(self, expression, version=3):
        return {"code": f"x = linspace(0, 1, 2)\ny = [{expression} for a in x]", "inputs": {}, "mathVersion": version}

    def test_versioned_admission(self):
        for name in ("asin", "acos", "atan", "sinh", "cosh", "tanh", "floor", "ceil", "round", "cbrt"):
            for version in (1, 2):
                body = self.body(f"{name}(0.5)", version)
                if version == 1:
                    body.pop("mathVersion")
                with self.assertRaises(ValueError):
                    validate(body)
            result = execute(self.body(f"{name}(0.5)"))
            self.assertEqual(result["runtime"]["adapter"], "bounded-python-sampler/3")
        self.assertEqual(execute(self.body("sqrt(4)", 2))["runtime"]["adapter"], "bounded-python-sampler/2")
        for version in (True, 3.0, 4, "3"):
            with self.assertRaises(ValueError):
                validate(self.body("a", version))

    def test_round_and_root(self):
        for source, expected in (("-2.5", -3), ("2.5", 3), ("-0.5", -1), ("0.49999999999999994", 1), ("1.4999999999999998", 2)):
            self.assertEqual(execute(self.body(f"round({source})"))["points"][0][1], expected)
        self.assertAlmostEqual(execute(self.body("cbrt(-8)"))["points"][0][1], -2)
        self.assertAlmostEqual(execute(self.body("asin(0.5)"))["points"][0][1], math.pi / 6)

    def test_mathjs_tolerant_floor_ceil(self):
        for source, expected in (("floor(0.9999999999999999)", 1), ("ceil(1.0000000000000002)", 1), ("floor(-1.0000000000000002)", -1), ("ceil(-0.9999999999999999)", -1)):
            self.assertEqual(execute(self.body(source))["points"][0][1], expected)

    def test_domains_and_finiteness(self):
        for expression in ("asin(1.01)", "acos(-1.01)", "sinh(1000)", "cosh(1000)", "tanh(exp(1000))", "round(1,2)", "cbrt()"):
            with self.assertRaises(ValueError):
                execute(self.body(expression))


if __name__ == "__main__":
    unittest.main()
