from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")
_CACHE: dict[str, tuple[float, object]] = {}


def ttl_cache(key: str, ttl_seconds: int, loader: Callable[[], T]) -> T:
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < ttl_seconds:
        return cached[1]  # type: ignore[return-value]
    value = loader()
    _CACHE[key] = (now, value)
    return value
