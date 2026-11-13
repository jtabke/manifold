"""Versioned canonical scalar DAG optimizer. No authored code is executed.

Transport, units, graph lowering, provenance and durable evidence belong to callers.
See artifact_optimizer_contract.md for the wire schema and resource contract.
"""

from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
import json
import math
from pathlib import Path
import subprocess
import struct
import sys
import time

VERSION = "manifold-numeric-optimizer/1"
MAX_REQUEST_BYTES = 65536
MAX_OUTPUT_BYTES = 16384
MAX_NODES = 256
MAX_DEPTH = 32
CODES = frozenset(
    {
        "converged",
        "no_bracket",
        "residual_not_met",
        "iteration_limit",
        "evaluation_limit",
        "deadline",
        "cancelled",
        "domain_error",
        "program_mismatch",
        "backend_mismatch",
        "unavailable",
        "transport_error",
    }
)
PROFILE = {"python_minor": "3.12", "numpy": "2.2.6", "scipy": "1.15.3"}
THREAD_ENV = {
    "OPENBLAS_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "BLIS_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "PYTHONHASHSEED": "0",
}


class InvalidRequest(ValueError):
    """Malformed or unsupported request; do not start a worker."""


class BackendUnavailable(RuntimeError):
    """Dependency or identity probe unavailable; no runtime substitution."""


class _Stop(Exception):
    def __init__(self, code):
        self.code = code


def _fields(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        raise InvalidRequest("Incorrect object fields")


def _number(value, limit=1e12):
    if type(value) not in (int, float):
        raise InvalidRequest("Expected a finite numeric scalar, not a boolean")
    try:
        result = float(value)
    except (OverflowError, ValueError) as exc:
        raise InvalidRequest("Numeric magnitude exceeded") from exc
    if not math.isfinite(result) or abs(result) > limit:
        raise InvalidRequest("Numeric magnitude exceeded")
    return result


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise InvalidRequest("Integer limit outside supported range")


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _bounded_json(value):
    try:
        encoded = _json(value)
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise InvalidRequest("Expected bounded JSON data") from exc
    if len(encoded.encode("utf-8")) > MAX_REQUEST_BYTES:
        raise InvalidRequest("Request too large")
    return encoded


# Dispatch is private and fixed: no request-driven imports, attributes or callables.
UNARY = {
    "pos": lambda a: a,
    "neg": lambda a: -a,
    "sqrt": math.sqrt,
    "abs": abs,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "exp": math.exp,
    "ln": math.log,
    "log10": math.log10,
    "cbrt": math.cbrt,
}


def _nearly_equal(a, b):
    # Math.js 15.2.0 default configuration used by the worksheet owner.
    return a == b or abs(a - b) <= max(1e-12 * max(abs(a), abs(b)), 1e-15)


def _decimal_round(a, places):
    # Math.js rounds the shortest decimal representation, not binary ties or
    # Python's ties-to-even. Binary64's finite exponent range fits this context.
    with localcontext() as context:
        context.prec = 400
        return float(
            Decimal(str(a)).quantize(Decimal(10) ** -places, rounding=ROUND_HALF_UP)
        )


def _round_away(a):
    corrected = _decimal_round(a, 12)
    return _decimal_round(corrected if _nearly_equal(a, corrected) else a, 0)


def _directed_round(a, direction):
    directed, nearest = direction(a), _round_away(a)
    if _nearly_equal(a, nearest) and not _nearly_equal(a, directed):
        return nearest
    return directed


UNARY.update(
    {
        "round": _round_away,
        "floor": lambda a: _directed_round(a, math.floor),
        "ceil": lambda a: _directed_round(a, math.ceil),
    }
)


def _exponent_fraction(value):
    """Match the bounded Farey rational selection used by Math.js Fraction.

    Binary-search consecutive moves in the Stern–Brocot interval, preserving
    float comparisons and the 10^7 denominator cutoff without a linear scan.
    """
    value = abs(value)
    scale = 10 ** math.floor(1 + math.log10(value)) if value >= 1 else 1
    value /= scale
    a, b, c, d, limit = 0, 1, 1, 1, 10_000_000
    while b <= limit and d <= limit:
        midpoint = (a + c) / (b + d)
        if value == midpoint:
            n, denominator = (
                (a + c, b + d) if b + d <= limit else (c, d) if d > b else (a, b)
            )
            break
        lower = value > midpoint
        # At most one step past the denominator bound is needed to select
        # the other side, just as in the original bounded rational search.
        low, high = 1, ((limit - b) // d + 1 if lower else (limit - d) // b + 1)
        while low < high:
            steps = (low + high + 1) // 2
            same_direction = (
                value > (a + steps * c) / (b + steps * d)
                if lower
                else value < (c + steps * a) / (d + steps * b)
            )
            if same_direction:
                low = steps
            else:
                high = steps - 1
        if lower:
            a, b = a + low * c, b + low * d
        else:
            c, d = c + low * a, d + low * b
        n, denominator = (c, d) if b > limit else (a, b)
    n *= scale
    divisor = math.gcd(n, denominator)
    return n // divisor, denominator // divisor


def _power(a, b):
    if abs(b) > 12:
        raise ValueError("Power exponent outside [-12, 12]")
    if a < 0 and not float(b).is_integer():
        numerator, denominator = _exponent_fraction(b)
        approximation = math.copysign(numerator / denominator, b)
        if b == approximation or abs((b - approximation) / b) < 1e-14:
            if denominator % 2:
                return (-1 if numerator % 2 else 1) * math.pow(-a, b)
    return math.pow(a, b)


def _atan2(a, b):
    if a == 0 and b == 0:
        raise ValueError("Undefined atan2")
    return math.atan2(a, b)


BINARY = {
    "add": lambda a, b: a + b,
    "sub": lambda a, b: a - b,
    "mul": lambda a, b: a * b,
    "div": lambda a, b: a / b,
    "pow": _power,
    "atan2": _atan2,
}


def validate_program(program):
    """Validate a topologically ordered, fully reachable numeric DAG."""
    _bounded_json(program)
    _fields(program, {"nodes", "output"})
    nodes = program["nodes"]
    if type(nodes) is not list or not 1 <= len(nodes) <= MAX_NODES:
        raise InvalidRequest("Use 1–256 nodes")
    _integer(program["output"], 0, len(nodes) - 1)
    depths = []
    for i, node in enumerate(nodes):
        if type(node) is not dict or type(node.get("op")) is not str:
            raise InvalidRequest("Expected canonical node")
        op = node["op"]
        if op == "const":
            _fields(node, {"op", "value"})
            _number(node["value"])
            depth = 1
        elif op == "x":
            _fields(node, {"op"})
            depth = 1
        else:
            _fields(node, {"op", "args"})
            args = node["args"]
            arity = (
                (1, 1)
                if op in UNARY
                else (2, 2)
                if op in BINARY
                else (2, 16)
                if op in ("min", "max")
                else None
            )
            if (
                arity is None
                or type(args) is not list
                or not arity[0] <= len(args) <= arity[1]
            ):
                raise InvalidRequest("Unsupported operation or arity")
            for ref in args:
                _integer(ref, 0, i - 1)
            depth = 1 + max(depths[ref] for ref in args)
        if depth > MAX_DEPTH:
            raise InvalidRequest("DAG exceeds depth 32")
        depths.append(depth)
    reached = set()
    pending = [program["output"]]
    while pending:
        ref = pending.pop()
        if ref not in reached:
            reached.add(ref)
            pending.extend(nodes[ref].get("args", []))
    if len(reached) != len(nodes):
        raise InvalidRequest("Every node must contribute to the output")


def program_digest(program):
    """Versioned numeric digest; constants use big-endian IEEE-754 hex bytes."""
    validate_program(program)
    normalized = {
        "nodes": [
            {"op": "const", "value": struct.pack(">d", float(node["value"])).hex()}
            if node["op"] == "const"
            else node
            for node in program["nodes"]
        ],
        "output": program["output"],
    }
    capture = {"version": VERSION, "program": normalized}
    return hashlib.sha256(_json(capture).encode("utf-8")).hexdigest()


def _identity_shape(identity):
    _fields(identity, {"adapter", "source_sha256", "python", "numpy", "scipy"})
    for value in identity.values():
        if type(value) is not str or not 1 <= len(value) <= 128:
            raise InvalidRequest("Invalid backend identity")
    _digest_shape(identity["source_sha256"])


def _digest_shape(value):
    if (
        type(value) is not str
        or len(value) != 64
        or any(c not in "0123456789abcdef" for c in value)
    ):
        raise InvalidRequest("Expected lowercase SHA-256")


def validate(body):
    """Strict validation without importing NumPy or SciPy."""
    _bounded_json(body)
    _fields(
        body,
        {
            "version",
            "program",
            "program_sha256",
            "backend",
            "mode",
            "bounds",
            "target",
            "x_tolerance",
            "residual_tolerance",
            "limits",
        },
    )
    if (
        body["version"] != VERSION
        or type(body["mode"]) is not str
        or body["mode"] not in ("minimize", "maximize", "target")
    ):
        raise InvalidRequest("Unsupported version or mode")
    validate_program(body["program"])
    _digest_shape(body["program_sha256"])
    _identity_shape(body["backend"])
    bounds = body["bounds"]
    if type(bounds) is not list or len(bounds) != 2:
        raise InvalidRequest("Expected two closed bounds")
    low, high = map(_number, bounds)
    if low >= high:
        raise InvalidRequest("Bounds must increase")
    tolerance = _number(body["x_tolerance"])
    if not 1e-12 <= tolerance <= high - low:
        raise InvalidRequest("x_tolerance must be >= 1e-12 and <= interval width")
    if body["mode"] == "target":
        _number(body["target"])
        if not 0 <= _number(body["residual_tolerance"]) <= 1e12:
            raise InvalidRequest("Residual tolerance must be nonnegative")
    elif body["target"] is not None or body["residual_tolerance"] is not None:
        raise InvalidRequest("Only target mode accepts target/residual_tolerance")
    limits = body["limits"]
    _fields(limits, {"evaluations", "iterations", "wall_ms"})
    _integer(limits["evaluations"], 1, 10000)
    _integer(limits["iterations"], 1, 1000)
    _integer(limits["wall_ms"], 1, 30000)


def _load_backend():
    try:
        import numpy
        import scipy
        from scipy import optimize
    except (ImportError, OSError) as exc:
        raise BackendUnavailable("Pinned NumPy/SciPy dependency unavailable") from exc
    identity = {
        "adapter": VERSION,
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
    }
    return identity, optimize


def _supported(identity):
    return (
        ".".join(identity["python"].split(".")[:2]) == PROFILE["python_minor"]
        and identity["numpy"] == PROFILE["numpy"]
        and identity["scipy"] == PROFILE["scipy"]
    )


def _result(
    body, code, backend=None, candidate=None, evaluations=None, iterations=None
):
    return {
        "version": VERSION,
        "program_sha256": body["program_sha256"],
        "backend": backend,
        "expected_backend": body["backend"],
        "bounds": body["bounds"],
        "target": body["target"],
        "relative_x_tolerance": 4 * sys.float_info.epsilon
        if body["mode"] == "target"
        else None,
        "algorithm": "scipy.optimize.brentq"
        if body["mode"] == "target"
        else "scipy.optimize.minimize_scalar:bounded",
        "scope": "bracketed-root"
        if body["mode"] == "target"
        else "local-search-not-global-proof",
        "success": code == "converged",
        "code": code,
        "candidate": candidate,
        "evaluations": evaluations,
        "iterations": iterations,
        "limits": body["limits"],
        "x_tolerance": body["x_tolerance"],
        "residual_tolerance": body["residual_tolerance"],
    }


def _decode_result(stdout, body):
    result = json.loads(stdout)
    if (
        type(result) is not dict
        or type(result.get("code")) is not str
        or result["code"] not in CODES
    ):
        raise InvalidRequest("Invalid worker outcome")
    expected = _result(body, result["code"])
    _fields(result, expected)
    changing = {"backend", "candidate", "evaluations", "iterations"}
    if any(result[key] != expected[key] for key in expected if key not in changing):
        raise InvalidRequest("Worker result does not match capture")
    if type(result["success"]) is not bool:
        raise InvalidRequest("Invalid success flag")
    if result["backend"] is not None:
        _identity_shape(result["backend"])
    if result["code"] == "converged" and result["backend"] != body["backend"]:
        raise InvalidRequest("Worker identity changed")
    for name, maximum in (
        ("evaluations", body["limits"]["evaluations"]),
        ("iterations", body["limits"]["iterations"]),
    ):
        if result[name] is not None:
            _integer(result[name], 0, maximum)
    candidate = result["candidate"]
    if candidate is not None:
        _fields(candidate, {"x", "output", "residual"})
        x = _number(candidate["x"])
        y = _number(candidate["output"], sys.float_info.max)
        if not body["bounds"][0] <= x <= body["bounds"][1]:
            raise InvalidRequest("Candidate outside bounds")
        if body["mode"] == "target":
            residual = _number(candidate["residual"], sys.float_info.max)
            if residual != y - body["target"]:
                raise InvalidRequest("Invalid candidate residual")
            if result["success"] and abs(residual) > body["residual_tolerance"]:
                raise InvalidRequest("Unsatisfactory target result")
        elif candidate["residual"] is not None:
            raise InvalidRequest("Unexpected residual")
    elif result["success"]:
        raise InvalidRequest("Missing successful candidate")
    return result


def _evaluate(program, x):
    values = []
    for node in program["nodes"]:
        op = node["op"]
        if op == "const":
            value = float(node["value"])
        elif op == "x":
            value = x
        else:
            args = [values[ref] for ref in node["args"]]
            if op in UNARY:
                value = UNARY[op](*args)
            elif op in BINARY:
                value = BINARY[op](*args)
            else:
                value = min(args) if op == "min" else max(args)
        value = float(value)
        if not math.isfinite(value):
            raise ValueError("Nonfinite scalar")
        values.append(value)
    return values[program["output"]]


def _execute(body):
    validate(body)
    if program_digest(body["program"]) != body["program_sha256"]:
        return _result(body, "program_mismatch", evaluations=0, iterations=0)
    try:
        identity, optimize = _load_backend()
    except BackendUnavailable:
        return _result(body, "unavailable", evaluations=0, iterations=0)
    if identity != body["backend"] or not _supported(identity):
        return _result(
            body, "backend_mismatch", backend=identity, evaluations=0, iterations=0
        )
    deadline = time.monotonic() + body["limits"]["wall_ms"] / 1000
    evaluations = 0
    iterations = 0
    candidate = None
    target = body["target"]
    mode = body["mode"]

    def check():
        if time.monotonic() >= deadline:
            raise _Stop("deadline")

    def evaluate(x):
        nonlocal evaluations, candidate
        check()
        if evaluations >= body["limits"]["evaluations"]:
            raise _Stop("evaluation_limit")
        evaluations += 1
        try:
            y = _evaluate(body["program"], float(x))
            residual = y - target if mode == "target" else None
            if residual is not None and not math.isfinite(residual):
                raise ValueError("Nonfinite residual")
        except (ArithmeticError, ValueError) as exc:
            raise _Stop("domain_error") from exc
        point = {"x": float(x), "output": y, "residual": residual}
        score = abs(residual) if mode == "target" else y if mode == "minimize" else -y
        if candidate is None:
            candidate = point
        else:
            old = (
                abs(candidate["residual"])
                if mode == "target"
                else candidate["output"]
                if mode == "minimize"
                else -candidate["output"]
            )
            if score < old:
                candidate = point
        check()
        return y

    low, high = body["bounds"]
    try:
        left = evaluate(low)
        right = evaluate(high)
        if mode == "target":
            if (
                abs(left - target) <= body["residual_tolerance"]
                or abs(right - target) <= body["residual_tolerance"]
            ):
                code = "converged"
            elif (left - target > 0) == (right - target > 0):
                code = "no_bracket"
            else:
                iterations = None
                root, report = optimize.brentq(
                    lambda x: evaluate(x) - target,
                    low,
                    high,
                    xtol=body["x_tolerance"],
                    rtol=4 * sys.float_info.epsilon,
                    maxiter=body["limits"]["iterations"],
                    full_output=True,
                    disp=False,
                )
                iterations = int(report.iterations)
                actual = evaluate(root)
                code = (
                    "iteration_limit"
                    if not report.converged
                    else "converged"
                    if abs(actual - target) <= body["residual_tolerance"]
                    else "residual_not_met"
                )
                # Target success is certified at the returned root, not an earlier sample.
                if code == "converged":
                    candidate = {
                        "x": float(root),
                        "output": actual,
                        "residual": actual - target,
                    }
        else:
            sign = 1 if mode == "minimize" else -1
            iterations = 0

            def objective(x):
                nonlocal iterations
                # SciPy can perform two startup calls even with maxiter=1.
                # Enforce the caller's stricter bound without a replacement solver.
                if iterations >= body["limits"]["iterations"]:
                    raise _Stop("iteration_limit")
                iterations += 1
                return sign * evaluate(x)

            report = optimize.minimize_scalar(
                objective,
                bounds=(low, high),
                method="bounded",
                options={
                    "xatol": body["x_tolerance"],
                    "maxiter": body["limits"]["iterations"],
                },
            )
            # SciPy's bounded implementation limits function calls through maxiter.
            iterations = int(report.nit)
            evaluate(float(report.x))
            code = "converged" if report.success else "iteration_limit"
        check()
    except _Stop as exc:
        code = exc.code
    return _result(body, code, identity, candidate, evaluations, iterations)


def _spawn(kind):
    return subprocess.Popen(
        [sys.executable, "-I", str(Path(__file__).resolve()), kind],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=THREAD_ENV.copy(),
        cwd=Path(__file__).parent,
    )


def _reap(process):
    if process.poll() is None:
        process.kill()
    process.communicate()


def backend_identity(timeout=5):
    """Probe the fixed worker runtime. Raises BackendUnavailable on probe failure."""
    try:
        process = _spawn("--identity")
    except OSError as exc:
        raise BackendUnavailable("Worker unavailable") from exc
    try:
        stdout, _ = process.communicate(timeout=timeout)
        if process.returncode or len(stdout) > MAX_OUTPUT_BYTES:
            raise BackendUnavailable("Dependency or worker unavailable")
        identity = json.loads(stdout)
        _identity_shape(identity)
        return identity
    except (subprocess.TimeoutExpired, ValueError) as exc:
        raise BackendUnavailable("Identity probe unavailable") from exc
    finally:
        _reap(process)


def solve(body, *, cancelled=None):
    """Run a frozen request; cancelled is a trusted zero-argument predicate.

    Deadline includes worker startup/imports. Return only after the child is reaped.
    No interpreter, environment, path or callable is accepted from request data.
    """
    validate(body)
    payload = _bounded_json(body).encode("utf-8")
    # Decode our bounded capture so later caller mutations cannot affect admission.
    body = json.loads(payload)
    if program_digest(body["program"]) != body["program_sha256"]:
        return _result(body, "program_mismatch", evaluations=0, iterations=0)
    if cancelled is not None and cancelled():
        return _result(body, "cancelled", evaluations=0, iterations=0)
    deadline = time.monotonic() + body["limits"]["wall_ms"] / 1000
    try:
        process = _spawn("--worker")
    except OSError:
        return _result(body, "transport_error", evaluations=0, iterations=0)
    try:
        first = True
        while True:
            if cancelled is not None and cancelled():
                return _result(body, "cancelled")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _result(body, "deadline")
            try:
                stdout, _ = process.communicate(
                    input=payload if first else None, timeout=min(0.02, remaining)
                )
                if cancelled is not None and cancelled():
                    return _result(body, "cancelled")
                if time.monotonic() >= deadline:
                    return _result(body, "deadline")
                break
            except subprocess.TimeoutExpired:
                first = False
        if process.returncode or len(stdout) > MAX_OUTPUT_BYTES:
            return _result(body, "transport_error")
        try:
            # Never relay exceptions or arbitrary OptimizeResult/worker objects.
            return _decode_result(stdout, body)
        except (ValueError, TypeError):
            return _result(body, "transport_error")
    finally:
        _reap(process)


def _main():
    if sys.argv[1:] == ["--identity"]:
        try:
            identity, _ = _load_backend()
            print(_json(identity))
        except BackendUnavailable:
            sys.exit(2)
    elif sys.argv[1:] == ["--worker"]:
        try:
            raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if len(raw) > MAX_REQUEST_BYTES:
                sys.exit(3)
            result = _execute(json.loads(raw))
            encoded = _json(result)
            if len(encoded.encode("utf-8")) > MAX_OUTPUT_BYTES:
                sys.exit(4)
            print(encoded)
        except (InvalidRequest, ValueError, TypeError, RecursionError):
            sys.exit(3)
    else:
        sys.exit(3)


if __name__ == "__main__":
    _main()
