# Recompute stale-read transparency pass (alpha-safe)

## Recompute/read paths addressed

- Character mutation -> non-blocking recompute -> follow-up read:
  - `POST /api/me/work-plan` -> `character-political-state`
  - `POST /api/divisions/:id/vote` -> `character-political-state`
  - `POST /api/divisions/:divisionId/rebel-request` -> `character-political-state`
  - `POST /api/divisions/:divisionId/rebel-request/:requestId/decide` -> `character-political-state`
  - `POST /api/me/faction/switch` -> `character-political-state`
- Faction admin mutation -> freeze-deferred recompute -> party/faction reads:
  - `PATCH /api/admin/factions/:id`
  - `PATCH /api/admin/factions/:id/allocation`
  - Follow-up reads: `GET /api/parties/:slug/factions`, `GET /api/parties/:slug/faction-climate`

## Transparency mechanisms added

- Standardised recompute context helpers in `server/recompute-helpers.js`:
  - `createRecomputeContext(...)`
  - `buildRecomputeResponseMetadata(...)`
- Extended recompute logs to include stable target scope/id fields:
  - `target_scope=<scope>`
  - `target_id=<id>`
  - Existing `entity=<id>` retained for backward grep compatibility.
- Mutation response metadata:
  - `recompute` object for non-blocking character-state triggers (`status: queued`, `staleReadWindow: brief`)
  - `recompute` object for freeze-deferred faction changes (`status: deferred`, `staleReadWindow: until-next-freeze`)
- Read response metadata:
  - `recomputeRead` object on faction reads exposing whether values may still reflect last completed freeze.

## Routes now returning recompute metadata

- Mutation responses:
  - `POST /api/me/work-plan`
  - `POST /api/divisions/:id/vote`
  - `POST /api/divisions/:divisionId/rebel-request`
  - `POST /api/divisions/:divisionId/rebel-request/:requestId/decide`
  - `POST /api/me/faction/switch`
  - `PATCH /api/admin/factions/:id`
  - `PATCH /api/admin/factions/:id/allocation`
- Read responses:
  - `GET /api/parties/:slug/factions` (`recomputeRead`)
  - `GET /api/parties/:slug/faction-climate` (`recomputeRead`)

## Docs updated

- `docs/dev-guide.md`: stale-read window explanation + standard recompute metadata/log interpretation.
- `docs/trial-runbook.md`: staff guidance that faction derived stats can lag until freeze; updated log monitoring notes for `[recompute]` lines.

## Remaining intentional stale-read behaviour

- Character political-state recomputes on mutation routes remain fire-and-forget (alpha model unchanged).
- Faction derived political-state remains freeze-published (`Sunday` scheduler or manual trigger), so reads can intentionally reflect last completed freeze until next publish.
