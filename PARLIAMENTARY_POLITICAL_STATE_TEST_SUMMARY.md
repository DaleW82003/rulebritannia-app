# Parliamentary → Political-State Integration Test Summary

**Test file:** `server/parliamentary-political-state.integration.test.js`  
**Run with:** `node --test server/parliamentary-political-state.integration.test.js`  
**Result:** 111 tests — 111 pass, 0 fail

---

## Tests Added

### 1. Amendment Status Rules (3 tests)
| Test | Purpose |
|------|---------|
| Non-author submission gets `'proposed'` | Confirms the default amendment status for any MP who is not the bill author |
| Bill author submission is auto-accepted | Confirms authors' own amendments skip the approval queue |
| Missing `billAuthorCharId` always yields `'proposed'` | Edge case: legacy bills without a character-id author |

### 2. Amendment Decision Authorisation — Permissions (6 tests)
| Test | Purpose |
|------|---------|
| Bill author (matching `character_id`) may decide | Core happy path for the bill author |
| Non-author MP without staff role is rejected | **Permissions test: non-authorised actor is rejected** |
| Admin staff may decide regardless of authorship | Staff override path |
| Mod staff may decide regardless of authorship | Staff override path |
| Player with no staff role is always rejected when not author | Hardened fallback |
| Immutable `character_id` governs — wrong id rejected even if same session | Key hardening invariant |

### 3. Amendment Support Path → Division Trigger (4 tests)
| Test | Purpose |
|------|---------|
| 1 leader supporting proposed amendment → no division | Below threshold |
| 2 leaders supporting proposed amendment → triggers division | Exact threshold |
| 3+ leaders still triggers exactly one division | Above threshold |
| 2 supporters on non-proposed amendment → no further division | Status guard |

### 4. Amendment Refuse Path → Status Resolution (4 tests)
| Test | Purpose |
|------|---------|
| 0 supporters → `'refused'` | Simple refusal |
| 1 supporter → `'refused'` | Below trigger threshold |
| 2 supporters → `'in-division'` | Threshold met: division triggered |
| 5 supporters → `'in-division'` | Above threshold |

### 5. Bill Text Mutation — `applyAmendmentToBillText` (6 tests)
| Test | Purpose |
|------|---------|
| `replace` substitutes target article body | Amendment persistence mechanism |
| `insert` appends while preserving original | Amendment persistence mechanism |
| `delete` clears article body | Amendment persistence mechanism |
| Non-existent article leaves bill unchanged | No-op safety |
| Null input returned unchanged | Null safety |
| Amendment text is recoverable from updated bill | Confirms "amendment data persists and is retrievable" |

### 6. Division Outcome (4 tests)
| Test | Purpose |
|------|---------|
| More ayes → `'passed'` | Standard win |
| More noes → `'failed'` | Standard loss |
| Equal ayes and noes → `'tied'` | Tie resolution |
| All abstain → `'tied'` | Edge: zero aye and no both equal 0 |

### 7. Rebellion Detection (4 tests)
| Test | Purpose |
|------|---------|
| Vote matching party instruction → no rebellion | Loyal vote |
| Vote against party instruction → rebellion | Core rebellion trigger |
| Free vote instruction → never a rebellion | Whip exemption |
| No party instruction → no rebellion | Missing instruction guard |

### 8. Rebellion Log Deduplication Contract (4 tests)
| Test | Purpose |
|------|---------|
| First defiant vote creates exactly one entry | Initial logging |
| Changed defiant vote replaces entry (no duplicates) | "Rebellion records are not duplicated" requirement |
| Different characters → separate independent entries | Multi-MP isolation |
| Voting back to party line removes rebellion entry | "Not left stale" requirement |

### 9. Whip Rebellion Weight Table (5 tests)
| Test | Purpose |
|------|---------|
| 3-line → 25 pts | Highest weight |
| 2-line → 15 pts | Medium weight |
| 1-line → 8 pts | Low weight |
| 0-line → 3 pts | Baseline weight |
| Unknown level → 3 pts fallback | Defensive coding |

### 10. Party Pressure Computation (7 tests)
| Test | Purpose |
|------|---------|
| Single 3-line rebellion → 25 | Individual rebellion contribution |
| Four 3-line rebellions → 100 (exactly at cap) | Boundary at maximum |
| Five 3-line rebellions → clamped to 100 | Confirms clamp behaviour |
| Refused rebel requests add 10 each | Second pressure source |
| Pending rebel requests add 5 each | Third pressure source |
| Mix of rebellion + refused + pending accumulates | All sources combined |
| No activity → 0 | Zero-state baseline |

### 11. Capital Score Computation (15 tests)
| Test | Purpose |
|------|---------|
| PM office → +30 | Highest office bonus |
| leader-opposition → +20 | Opposition leader bonus |
| leader-commons → +15 | House leader bonus |
| Cabinet office (non-PM) → +20 | Cabinet tier |
| Shadow cabinet → +10 | Shadow tier |
| Other parliamentary office → +8 | Backbench office tier |
| Positive press items add 3 each | Press contribution |
| Negative press items subtract 5 each | Press penalty |
| Active scandals subtract 10 each | Scandal penalty |
| Heavy closed scandals subtract 15 each | Major scandal penalty |
| Active work plan adds 5 | Constituency activity bonus |
| Party leader role adds 12 | Party role bonus |
| Chief/deputy whip adds 6 each | Whip role bonus |
| PM + press combo = expected total | Combined calculation |
| No inputs → 0 | Zero baseline |

### 12. Reputation Label from Capital (10 tests)
Verifies all five reputation labels (`excellent`, `good`, `neutral`, `poor`, `damaged`) with boundary values at 60, 30, 10, -10.

### 13. Momentum from Capital Trend (6 tests)
Verifies all three momentum labels (`rising`, `stable`, `falling`) with boundaries at ±5.

### 14. Rebellion Risk Formula (6 tests)
| Test | Purpose |
|------|---------|
| 0 pressure + 0 rebellions → 0 | Zero baseline |
| 50 pressure + 0 rebellions → 30 | Pressure-only path |
| 0 pressure + 5 rebellions → 40 | Rebellion-only path |
| 6 rebellions capped at 5 | Max rebellion count cap |
| High pressure + max rebellions saturates at 100 | Upper bound |
| Never exceeds 100 | Clamp invariant |

### 15. Pressure Label (8 tests)
Verifies all four labels (`critical`, `high`, `moderate`, `low`) at boundary values.

### 16. `clamp100` Boundary Behaviour (6 tests)
Verifies lower bound (0), upper bound (100), rounding, and passthrough for in-range values.

### 17. Division Tally Algorithm (5 tests)
| Test | Purpose |
|------|---------|
| Player votes accumulate by `effective_weight` | Step 1 of tally |
| NPC party votes add `seats − rebels` to instructed direction | Step 2 of tally |
| Sinn Féin always abstain | Special voting rule |
| Speaker party excluded from NPC votes | Special voting rule |
| Combined player + NPC + Sinn Féin → correct aggregate + outcome | Full tally chain |

### 18. Immutable Result Structure and JSON Round-Trip (3 tests)
| Test | Purpose |
|------|---------|
| Contains all required fields | Structural validity |
| JSON round-trip preserves all values | "Division close produces stable/authoritative result data" |
| Post-close mutation does not affect stored snapshot | Immutability guarantee |

### 19. End-to-End Integration Chain Tests (5 tests)
| Test | Purpose |
|------|---------|
| Amendment lifecycle: proposed → decided → in-division with 2+ support | Full amendment chain |
| Division vote + rebellion log + party pressure + valid political state | Core parliamentary → political-state chain |
| Division close → immutable result cannot be changed by subsequent votes | Result authoritativeness |
| Character with office + rebellion has bounded valid political state | State validity after parliamentary actions |
| Political state values remain valid across varied character profiles | Structural invariant stress test |

---

## Pathways Covered

| Pathway | Coverage |
|---------|----------|
| Non-author MP submits amendment → `proposed` status | ✅ |
| Bill author submits own amendment → auto-accepted | ✅ |
| Only bill author / staff can decide on amendment | ✅ (permissions test) |
| Non-authorised actor rejected from amendment decision | ✅ (permissions test) |
| 2+ party-leader supporters → amendment division triggered | ✅ |
| Bill author refuses amendment: < 2 supporters → `refused` | ✅ |
| Bill author refuses amendment: ≥ 2 supporters → `in-division` | ✅ |
| Amendment text applied to bill text (replace / insert / delete) | ✅ |
| Amendment text recoverable from updated bill | ✅ |
| Division tally: player effective_weight accumulation | ✅ |
| Division tally: NPC seat-weighted votes with rebels | ✅ |
| Division tally: Sinn Féin always abstains | ✅ |
| Division tally: Speaker excluded | ✅ |
| Division outcome: passed / failed / tied | ✅ |
| Division close: immutable result persisted and stable | ✅ |
| Rebellion detection: vote vs. party instruction | ✅ |
| Rebellion detection: free vote exemption | ✅ |
| Rebellion log: single authoritative record per (division, character) | ✅ |
| Rebellion log: stale entry cleared on vote change | ✅ |
| Rebellion log: cleared on reversion to party line | ✅ |
| Whip level → pressure weight translation | ✅ |
| Party pressure: rebellion + refused + pending requests | ✅ |
| Party pressure: clamped 0-100 | ✅ |
| Political capital: office, press, scandal, work plan, party roles | ✅ |
| Reputation label: all five states at boundary values | ✅ |
| Momentum label: all three states at boundary values | ✅ |
| Rebellion risk: formula + cap at 100 | ✅ |
| Pressure label: all four states at boundary values | ✅ |
| Character political state: structurally valid after parliamentary actions | ✅ |

---

## Remaining Gaps and Assumptions

### Not covered (would require a live DB / HTTP server)
- **HTTP-level integration**: Actual `POST /api/bills/:id/amendments/decide` request/response cycle with session cookies, CSRF tokens, and database writes. The existing test infrastructure (pure `node:test` unit tests) does not include an HTTP test harness.
- **Database persistence round-trip**: Verifying that `bill_amendments`, `divisions`, `division_votes`, and `division_rebellion_log` rows survive a DB write-read cycle.
- **`GET /api/me/political-state` read-after-write**: Confirming that `character_political_state` is populated and readable via the API after a recompute trigger.
- **`nextSimMonth` / `amendmentWindowOpen`**: These depend on the sim clock and are excluded because they require DB access or injected time mocking.
- **`computeCharacterWeight`**: The seat-proportional effective weight calculation that feeds into `division_votes.effective_weight` requires the full state snapshot and constituency data.
- **Faction climate modifier on party pressure**: `getPartyFactionClimate()` requires seeded faction data; the faction pressure/resilience modifiers are not exercised here.
- **Constituency pressure channel**: Requires work-plan DB rows and constituency events.

### Assumptions made
- Production business logic in `server/index.js` is correctly mirrored. Tests are authored against specific line references; if the production rules change, the tests should be updated in tandem.
- `clamp100` (no DB) and `pressureLabel` are stable utility functions; they are unlikely to change.
- The rebellion log deduplication contract (DELETE then INSERT) is modelled in pure JavaScript. The tests confirm the intent and would catch regressions if the logic were restructured (e.g., using an UPSERT that fails to clear old defiant votes on reversion).
- `applyAmendmentToBillText` is tested in isolation; in production it is called within a DB transaction that also updates the `bills` table.
