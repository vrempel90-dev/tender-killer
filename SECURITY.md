# Security review boundaries

All company-owned reads and writes must be bound to the live session company,
including child IDs, report exports and documents. Company administrators may
change only company-owned settings. Global policy requires operator authority.
Negative HTTP tests must prove the foreign row remains unchanged.

Uploaded bytes and extracted text are untrusted. Reject oversized bodies while
streaming, inspect Office expansion before parsing, require antivirus in
production, and keep parsers from secrets. Never execute document macros/code.
V8 worker limits are not an operating-system security sandbox.

External AI is disabled until the operator supplies a legal transfer basis and
explicit configuration. Reserve company/platform usage before every paid call.
AI outputs are data, never privileged tool instructions or financial arithmetic.
Unverified, unreadable or truncated content must not establish absence or a
confirmed fact. Unknown money is missing, not zero.

No production deployment or compliance certification is authorized by passing
local tests. Password reauthentication for destructive actions, voluntary MFA,
DB least privilege/RLS, encrypted backup/restore,
independent security review and Kazakhstan legal/infrastructure validation remain
release gates. CI dependency/container failures must not be silenced simply to
merge. Test fixtures and ephemeral CI credentials are never production seeds.
