# user/ Index

User-level memory directory. Stores user personal preferences and context across projects and sessions.

## File List

| File | Type | Purpose |
|------|------|---------|
| `USER.md` | Agent maintained | User profile: identity, communication preferences, output style, technical background, work habits. Hard limit 3KB |

## Rules

- `USER.md` is maintained by the agent (`/user-learn` skill), user corrects via `/feedback`
- Only injected into threads where the user is directly conversing (direct / direct-web / direct-review), not injected into dispatch threads
- Injection is controlled by environment variable `CORTEX_INJECT_USER_CONTEXT=1`
- File hard limit 3KB, compress rather than grow when approaching the limit

## Lookup Rules

- **Find user preferences** -> `USER.md`
- **Modify user preferences** -> `/user-learn` or `/feedback`
