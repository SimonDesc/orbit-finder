import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    """In-memory sliding window per client IP. Enough for a single-instance public demo."""

    def __init__(self, max_calls: int, per_seconds: float):
        self.max_calls = max_calls
        self.per_seconds = per_seconds
        self._calls: dict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        calls = self._calls[ip]
        while calls and now - calls[0] > self.per_seconds:
            calls.popleft()
        if len(calls) >= self.max_calls:
            raise HTTPException(429, "Too many requests, please wait a minute.")
        calls.append(now)
