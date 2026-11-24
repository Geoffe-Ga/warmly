"""Fixed synthetic values returned by the stub routes.

Nothing here is real data. The values exist so stub responses have the right
shape; each is replaced when its route gains real behaviour.
"""

from datetime import UTC, datetime
from uuid import UUID

STUB_DEVICE_ID = UUID("00000000-0000-4000-8000-000000000001")
STUB_ENROLLMENT_ID = UUID("00000000-0000-4000-8000-000000000002")
STUB_TIME = datetime(2026, 1, 1, tzinfo=UTC)
# "stub" in base64: an obviously synthetic opaque value.
STUB_CIPHERTEXT = "c3R1Yg=="
# "stub-public-key" in base64.
STUB_PUBLIC_KEY = "c3R1Yi1wdWJsaWMta2V5"
