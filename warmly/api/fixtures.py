"""Fixed synthetic values returned by the stub routes.

Nothing here is real data. The values exist so stub responses have the right
shape; each is replaced when its route gains real behaviour.
"""

from datetime import UTC, datetime

STUB_TIME = datetime(2026, 1, 1, tzinfo=UTC)
# "stub" in base64: an obviously synthetic opaque value.
STUB_CIPHERTEXT = "c3R1Yg=="
# "stub-public-key" in base64.
STUB_PUBLIC_KEY = "c3R1Yi1wdWJsaWMta2V5"
