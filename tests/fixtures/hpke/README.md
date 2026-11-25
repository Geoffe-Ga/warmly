# HPKE test vectors

`rfc9180-p256-sha256-aes256gcm.json` is the published RFC 9180 test vector
for the one suite Warmly uses to hand the root key to a new device
(ADR-0005): base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM.
It was taken unchanged from `test-vectors.json` in
<https://github.com/cfrg/draft-irtf-cfrg-hpke>, keeping only the fields the
tests use and the first encryption (sequence number 0, the only one a
single-shot seal produces).

The keys in it are published test keys and protect nothing.
`tests/frontend/crypto/hpke.test.ts` checks `src/crypto/hpke.ts` against it
in both directions: sealing with the vector's one-time key must give the
vector's ciphertext, and opening that ciphertext must give its plaintext.

Do not edit the file. It is the standard's answer, not ours.
