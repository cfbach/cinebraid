# CineBraid v6.6.3.2 — Manual-first parity audit

## Scope

Every primary route and every shot task was rendered twice with all assistant capabilities and FAL disabled: once with `meta.workflowEmphasis = "manual"`, once with `"assisted"`. The sweep used the sanitized sample and repeated the same routes after adding prior frame, blocking, motion and continuity-state prompt history.

The explicit assisted-only control list included Build/Rebuild prompt, Improve, generation, automation, batch AI review and optional-AI mapping actions. None were default-visible in the manual column. They remained present and reachable in assisted emphasis.

## Default-visible button counts

| Route/workspace | Manual | Assisted | Assisted-only visible in manual |
|---|---:|---:|---|
| Production | 2 | 2 | None |
| Create | 8 | 8 | None |
| Shot board | 9 | 9 | None |
| Scene list | 2 | 2 | None |
| Scene | 14 | 14 | None |
| Shot — default task | 9 | 11 | None |
| Shot — Inputs | 12 | 12 | None |
| Shot — Look & blocking | 9 | 9 | None |
| Shot — Frames | 9 | 11 | None |
| Shot — Motion & sound | 7 | 7 | None |
| Shot — Deliver | 9 | 9 | None |
| Reference Library | 1 | 1 | None |
| Approved Reference Library | 1 | 1 | None |
| Character — Reference | 9 | 18 | None |
| Character — Review | 11 | 11 | None |
| Character — Coverage | 16 | 18 | None |
| Location — Coverage | 17 | 19 | None |
| Prop — Continuity states | 13 | 13 | None |
| Reports | 1 | 1 | None |
| Settings | 6 | 6 | None |

The history-bearing sample produced the same manual counts. Existing prompt history no longer springs open assisted creation after a project switches to manual emphasis.

## Vocabulary sweep

Manual default surfaces now use **Ready for media**, **Add existing image**, **N to choose from**, and manual intake language. Generation vocabulary remains intentionally present in:

- closed Optional assisted creation disclosures;
- assisted-emphasis workspaces;
- historical reports and prompt records;
- optional provider configuration.

No stored data, action key, prompt, automation result, or export changes when Workspace emphasis changes.
