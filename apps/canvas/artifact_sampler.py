"""Experiment-only, bounded Python sampling grammar; not an arbitrary Python sandbox.

Only two assignments are admitted: x = linspace(literal, literal, literal), then
y = [scalar arithmetic for a in x]. No imports, attributes, subscripting, nested
comprehensions, arbitrary calls or statements. A fresh isolated Python process
executes the validated program with scalar inputs and a single trusted helper.
"""

import ast
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

VERSION = "bounded-python-sampler/1"


class SamplingUnavailable(RuntimeError):
    """The bounded worker could not start; the same request may be retried."""


def number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Use finite scalar numbers")
    if abs(value) > 1e12 or not math.isfinite(value):
        raise ValueError("Scalar magnitude exceeds this experiment's bounds")
    return float(value)


def scientific_round(value: float) -> float:
    """Math.js 15.2.0: decimal half-away rounding after relTol precision selection."""
    # Math.js roundNumber rounds the shortest decimal spelling, not binary x*10^n.
    # 340 digits cover any finite IEEE double plus the 12 fractional places.
    with localcontext() as context:
        context.prec = 340
        decimal = Decimal(str(value))
        epsilon = float(decimal.quantize(Decimal("1e-12"), rounding=ROUND_HALF_UP))
        selected = epsilon if scientific_nearly_equal(value, epsilon) else value
        return float(Decimal(str(selected)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def scientific_nearly_equal(a: float, b: float) -> bool:
    return abs(a - b) <= max(1e-12 * max(abs(a), abs(b)), 1e-15)


def scientific_integer(value: float, upward: bool) -> float:
    """Math.js floor/ceil select round only when indistinguishable from it alone."""
    integer = math.ceil(value) if upward else math.floor(value)
    rounded = scientific_round(value)
    if integer == rounded:
        return integer
    if scientific_nearly_equal(value, rounded) and not scientific_nearly_equal(value, integer):
        return rounded
    return integer


def validate(body: object) -> tuple[str, dict[str, float], tuple[float, float, int]]:
    if not isinstance(body, dict) or set(body) not in ({"code", "inputs"}, {"code", "inputs", "mathVersion"}):
        raise ValueError("Provide code and scalar inputs only")
    if "mathVersion" in body and (type(body["mathVersion"]) is not int or body["mathVersion"] not in (2, 3)):
        raise ValueError("Unsupported mathematics version")
    scientific = body.get("mathVersion") in (2, 3)
    code, inputs = body["code"], body["inputs"]
    if not isinstance(code, str) or len(code) > 4000:
        raise ValueError("Keep sampling code under 4000 characters")
    if not isinstance(inputs, dict) or len(inputs) > 64:
        raise ValueError("Provide at most 64 scalar inputs")
    if any(not isinstance(k, str) or not re.fullmatch(r"v\d{1,2}", k) for k in inputs):
        raise ValueError("Inputs use declared v0…v99 bindings")
    values = {k: number(v) for k, v in inputs.items()}
    try:
        tree = ast.parse(code)
    except (SyntaxError, RecursionError) as exc:
        raise ValueError("Invalid Python sampling syntax") from exc
    if len(list(ast.walk(tree))) > 256 or len(tree.body) != 2:
        raise ValueError("Use only the x and y sampling assignments")
    first, second = tree.body
    for statement, name in ((first, "x"), (second, "y")):
        if (
            not isinstance(statement, ast.Assign)
            or len(statement.targets) != 1
            or not isinstance(statement.targets[0], ast.Name)
            or statement.targets[0].id != name
        ):
            raise ValueError("Use only the x and y sampling assignments")
    assert isinstance(first, ast.Assign) and isinstance(second, ast.Assign)
    call = first.value
    if (
        not isinstance(call, ast.Call)
        or not isinstance(call.func, ast.Name)
        or call.func.id != "linspace"
        or len(call.args) != 3
        or call.keywords
    ):
        raise ValueError("x must be linspace(start, stop, count) with numeric literals")
    try:
        args = [number(ast.literal_eval(arg)) for arg in call.args]
    except (ValueError, TypeError) as exc:
        raise ValueError("linspace requires numeric literals") from exc
    low, high, count = args
    if low >= high or not count.is_integer() or not 2 <= count <= 501:
        raise ValueError("Use an increasing range and 2–501 samples")
    expression = second.value
    if not isinstance(expression, ast.ListComp) or len(expression.generators) != 1:
        raise ValueError("y must be scalar arithmetic for a in x")
    generator = expression.generators[0]
    if (
        not isinstance(generator.target, ast.Name)
        or generator.target.id != "a"
        or not isinstance(generator.iter, ast.Name)
        or generator.iter.id != "x"
        or generator.ifs
        or generator.is_async
    ):
        raise ValueError("Use a single bounded comprehension: for a in x")

    def arithmetic(node: ast.AST) -> None:
        if scientific and isinstance(node, ast.Call):
            arities = {"sqrt": (1, 1), "abs": (1, 1), "sin": (1, 1), "cos": (1, 1), "tan": (1, 1), "exp": (1, 1), "log": (1, 1), "log10": (1, 1), "min": (2, 16), "max": (2, 16), "atan2": (2, 2)}
            if body.get("mathVersion") == 3:
                arities.update({name: (1, 1) for name in ("asin", "acos", "atan", "sinh", "cosh", "tanh", "floor", "ceil", "round", "cbrt")})
            name = node.func.id if isinstance(node.func, ast.Name) else ""
            if name not in arities or node.keywords or not arities[name][0] <= len(node.args) <= arities[name][1]:
                raise ValueError("Use only supported scalar functions and argument counts")
            for arg in node.args:
                arithmetic(arg)
        elif isinstance(node, ast.Constant):
            number(node.value)
        elif isinstance(node, ast.Name) and node.id in {*values, "a"}:
            return
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            arithmetic(node.operand)
        elif isinstance(node, ast.BinOp) and isinstance(
            node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
        ):
            if isinstance(node.op, ast.Pow):
                try:
                    exponent = number(ast.literal_eval(node.right))
                except (ValueError, TypeError) as exc:
                    raise ValueError("Powers require a literal exponent") from exc
                if abs(exponent) > 6:
                    raise ValueError("Power magnitude must be at most 6")
            arithmetic(node.left)
            arithmetic(node.right)
        else:
            raise ValueError("Only bound scalar arithmetic is available in this adapter")

    arithmetic(expression.elt)
    return code, values, (low, high, int(count))


def execute(body: object) -> dict:
    code, inputs, _ = validate(body)

    def linspace(low: float, high: float, count: int) -> list[float]:
        count = int(count)
        return [float(low + (high - low) * i / (count - 1)) for i in range(count)]

    functions = {"sqrt": math.sqrt, "abs": abs, "sin": math.sin, "cos": math.cos, "tan": math.tan, "exp": math.exp, "log": math.log, "log10": math.log10, "min": min, "max": max, "atan2": math.atan2} if body.get("mathVersion") in (2, 3) else {}
    if body.get("mathVersion") == 3:
        functions.update({name: getattr(math, name) for name in ("asin", "acos", "atan", "sinh", "cosh", "tanh", "floor", "ceil", "cbrt")})
        functions.update({"round": scientific_round, "floor": lambda value: scientific_integer(value, False), "ceil": lambda value: scientific_integer(value, True)})
        # Reject nonfinite intermediate function inputs/outputs, even if later arithmetic masks them.
        def checked(fn):
            def call(*args):
                if not all(math.isfinite(arg) for arg in args):
                    raise ValueError("Function arguments must be finite")
                result = fn(*args)
                if not math.isfinite(result):
                    raise ValueError("Function result must be finite")
                return result
            return call
        functions = {name: checked(fn) for name, fn in functions.items()}
    namespace: dict = {"__builtins__": {}, "linspace": linspace, **functions, **inputs}
    try:
        tree = ast.parse(code)

        class FloatingConstants(ast.NodeTransformer):
            def visit_Constant(self, node: ast.Constant) -> ast.Constant:
                return ast.copy_location(ast.Constant(float(node.value)), node)

        # Scalar arithmetic never constructs unbounded Python integers.
        tree.body[1] = FloatingConstants().visit(tree.body[1])
        exec(compile(tree, "<artifact-sampler>", "exec"), namespace)
        points = [
            [number(x), number(y)] for x, y in zip(namespace["x"], namespace["y"], strict=True)
        ]
    except (ArithmeticError, TypeError, ValueError) as exc:
        raise ValueError("Sampling produced an undefined or out-of-bounds result") from exc
    return {
        "points": points,
        "code_sha256": hashlib.sha256(code.encode()).hexdigest(),
        "runtime": {
            "adapter": f"bounded-python-sampler/{body.get('mathVersion', 1)}",
            "python": sys.version.split()[0],
            "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
    }


def sample(body: object) -> dict:
    validate(body)
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).resolve()), "--child"],
            input=json.dumps(body),
            capture_output=True,
            text=True,
            timeout=3,
            env={},
            cwd=Path(__file__).parent,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Python sampling timed out") from exc
    except OSError as exc:
        raise SamplingUnavailable("Python sampling is unavailable. Retry when ready.") from exc
    if result.returncode or len(result.stdout) > 100_000:
        raise ValueError("Python sampling failed")
    data = json.loads(result.stdout)
    if "error" in data:
        raise ValueError(data["error"])
    return data


if __name__ == "__main__" and sys.argv[1:] == ["--child"]:
    try:
        print(json.dumps(execute(json.loads(sys.stdin.read(131072))), allow_nan=False))
    except (ValueError, TypeError) as error:
        print(json.dumps({"error": str(error)}))
