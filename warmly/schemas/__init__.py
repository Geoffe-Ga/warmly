"""Request and response models for the Warmly API.

These models are the wire contract. Every content-bearing field is an opaque,
client-encrypted string: the server validates its shape and size and never
decodes, inspects or logs it (PRD SEC-005).
"""
