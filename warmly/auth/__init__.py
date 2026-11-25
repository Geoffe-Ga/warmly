"""Who is calling: verifies the auth provider's tokens (PRD §8, SEC-006).

The API never handles passwords. It receives an access token issued by the
auth provider, checks the signature against the provider's published public
keys, and takes the owner from the token's subject. Nothing a request says
about its owner anywhere else is ever used.
"""
