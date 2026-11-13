"""Transient bounded admission/cancellation; no workspace or result storage."""
import re
import threading
import time

from artifact_optimizer import BackendUnavailable, backend_identity, solve, validate, _supported


class OptimizerBusy(Exception):
    pass


class OptimizerHost:
    def __init__(self):
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)
        self.jobs = {}
        self.closed = False

    def capability(self):
        # Probes are subprocess work too: never an unbounded probe queue.
        if not self.slots.acquire(blocking=False):
            raise OptimizerBusy("Numerical workers are busy; try Run again later")
        try:
            with self.lock:
                if self.closed:
                    raise OptimizerBusy("Numerical host is closing")
            identity = backend_identity()
            if not _supported(identity):
                raise BackendUnavailable("Incompatible numerical environment; use CPython 3.12, NumPy 2.2.6 and SciPy 1.15.3")
            return identity
        finally:
            self.slots.release()

    def prune(self):
        now = time.monotonic()
        for key, (event, expires, running) in list(self.jobs.items()):
            if not running and expires < now:
                del self.jobs[key]

    @staticmethod
    def token(token):
        if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9-]{36}", token):
            raise ValueError("Invalid transient job token")

    def cancel(self, token):
        self.token(token)
        with self.lock:
            self.prune()
            if token in self.jobs:
                self.jobs[token][0].set()
            elif len(self.jobs) < 128:
                event = threading.Event()
                event.set()
                self.jobs[token] = (event, time.monotonic() + 35, False)
            else:
                raise OptimizerBusy("Cancellation registry busy")

    def optimize(self, token, body):
        self.token(token)
        validate(body)
        if not self.slots.acquire(blocking=False):
            raise OptimizerBusy("Numerical workers are busy; try Run again later")
        try:
            with self.lock:
                self.prune()
                if self.closed or len(self.jobs) >= 128:
                    raise OptimizerBusy("Numerical host unavailable")
                previous = self.jobs.get(token)
                if previous and previous[2]:
                    raise ValueError("Job token already running")
                event = previous[0] if previous else threading.Event()
                self.jobs[token] = (event, time.monotonic() + 35, True)
            try:
                return solve(body, cancelled=event.is_set)
            finally:
                with self.lock:
                    # Retain a short tombstone to reject token reuse/races.
                    event.set()
                    self.jobs[token] = (event, time.monotonic() + 35, False)
        finally:
            self.slots.release()

    def close(self):
        with self.lock:
            self.closed = True
            for event, _, _ in self.jobs.values():
                event.set()
        # solve owns kill/reap; wait until all admitted work releases its slot.
        for _ in range(2):
            self.slots.acquire()
        for _ in range(2):
            self.slots.release()
        with self.lock:
            self.jobs.clear()
