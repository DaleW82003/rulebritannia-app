# Rule Britannia – Simulation Model

## 1. Purpose of the Simulation

Rule Britannia is a role-playing political simulation of British parliamentary democracy, set in the post-1997 general election period. Its design goal is to let human players inhabit the institutions and processes of Westminster government and experience how legislative, executive, and institutional decisions unfold over simulated time.

The simulation models:

- **Parliamentary government** — a party system with a government, official opposition, and minor parties competing across 650 seats.
- **Role-based political interaction** — every participant occupies a specific office (Prime Minister, Secretary of State, backbencher MP, etc.) that determines what they may do and say.
- **Legislative processes** — bills move through formal readings, report stages, and parliamentary divisions before becoming law.
- **Institutional decision-making** — cabinet papers, civil service briefings, budget-setting, and the management of devolved bodies all involve distinct actors and procedures.
- **Intra-party faction dynamics** — each playable party contains named ideological factions whose relative strength shapes a party climate that affects character political capital and pressure.
- **Political capital and political pressure** — every character carries a computed political standing reflecting their offices held, press coverage, scandals, rebellion history, and faction climate.
- **Personal and party finance** — characters earn salaries tied to their offices; parties maintain treasury balances supported by fundraising and membership fees.
- **Accelerated simulation time** — real calendar days map to simulated months, so a full parliamentary term can be experienced over weeks of real time.

The historical starting point (August 1997, immediately after Labour's landslide election victory) provides a realistic, data-backed world that players inhabit rather than an abstract one they must build from scratch.

---

## 2. Core Simulation Concepts

### Simulation time

Time is the central coordinating mechanism. Every deadline, every debate window, and every division closing date is expressed in *simulation months*. Two simulation months advance per real-world week (Monday marks one month, Thursday marks another). Sundays are frozen. The server and client share identical clock logic to ensure every participant sees the same current simulation date.

### Characters

A character is any human player registered in the system. Each character holds exactly one parliamentary role and, for MPs, one constituency. Characters cast votes in divisions, draft legislation, hold cabinet office, and interact with civil service machinery. Non-player characters (NPCs) fill the remaining seats not occupied by human players and vote according to party instructions.

### Constituencies

The electoral map is derived from the real 1997 general election result: 659 constituencies spread across England, Scotland, Wales, and Northern Ireland. Each constituency belongs to a party and may be held by a player or NPC. Constituency data grounds the simulation in historical reality and gives the seat counts that underpin all division weight calculations.

### Parliamentary bodies

Beyond the House of Commons the simulation tracks a set of additional democratic institutions: the House of Lords, the European Parliament, and the three devolved legislatures (Scottish Parliament, Welsh Assembly, and Northern Ireland Assembly), plus directly elected mayors. Each body has a seat count, controlling party, and visibility state.

### Legislation

A bill is a formal legislative proposal. It passes through a structured sequence of stages (readings, debate, report, division) before it either receives Royal Assent and becomes an Act, or is defeated or withdrawn. Amendments may be proposed and voted upon during the Second Reading and Report Debate stages.

### Divisions

A division is the formal parliamentary vote attached to a bill, motion, amendment, statement, or regulation. Players cast votes (Aye, No, or Abstain); NPC seats vote according to whip instructions; absent players delegate their weight to their party leader. The result is determined by weighted totals.

### Cabinet and shadow cabinet

The government is led by fifteen cabinet offices mirroring real departmental responsibilities. An opposition shadow cabinet mirrors this structure. Cabinet members can prepare and share draft legislation, set a headline policy agenda, and direct their departments through the civil service system.

### Civil service

Each cabinet office maps to a named government department (e.g., the Home Secretary's department is the Home Office). Departments issue briefings — structured memos that may present branching scenarios with choices and consequences — and track ongoing civil service cases such as scandals or investigations.

### Budget

The simulation maintains a budget comprising seven revenue lines (Income Tax, Corporation Tax, VAT, National Insurance, Fuel Duty, Stamp Duty, and Business Rate Appropriations) and fifteen expenditure lines covering all major departmental spending areas. Fiscal aggregates (deficit, debt, GDP ratios) derive from these figures. The Chancellor drafts the budget; admins and moderators approve or reject it.

---

## 3. Entities in the Simulation

### Characters

Players register and, once approved, are assigned a parliamentary role. Each character has:

- **Role** — their parliamentary position (e.g., `prime-minister`, `backbencher`, `secretary-state-health`).
- **Party** — the party they represent.
- **Constituency** — the seat they hold (for MPs).
- **Active / absent status** — used by the division engine when distributing vote weight.
- **Delegation** — the party leader to whom their vote weight flows when they are absent.
- **Profile attributes** — education level, career background, and family situation drawn from fixed enumerations.

### Constituencies

659 constituencies represent the UK electoral map as it stood after the 1997 general election. Each record carries:

- Name, region, and nation.
- The party that won the seat in 1997.
- Whether the seat is currently held by a player or NPC.

Constituency data is pre-loaded from a structured CSV of 1997 results and stored as JSON. It is not dynamically updated by election events within the current simulation; the 1997 results provide a stable starting distribution of seats.

### Parliamentary bodies

The simulation maintains a registry of democratic institutions beyond the Commons:

| Body | Seats |
|---|---|
| House of Lords | Variable |
| European Parliament | 87 |
| Scottish Parliament | 129 |
| Welsh Assembly | 60 |
| Northern Ireland Assembly | 108 |
| Directly Elected Mayors | Per mayoralty |

Each body has a control type (Majority, Coalition, or Minority), a controlling party, and a party-by-party breakdown. Bodies may be hidden or visible in the public interface.

### Cabinet

Fifteen full cabinet offices exist:

1. Prime Minister, First Lord of the Treasury, and Minister for the Civil Service
2. Chancellor of the Exchequer, and Second Lord of the Treasury
3. Secretary of State for the Home Department
4. Secretary of State for Foreign and Commonwealth Affairs
5. Secretary of State for Business and Trade, and President of the Board of Trade
6. Secretary of State for Defence
7. Secretary of State for Work and Pensions
8. Secretary of State for Education
9. Secretary of State for the Environment and Agriculture
10. Secretary of State for Health and Social Care
11. Secretary of State for Transport and Infrastructure
12. Secretary of State for Culture, Media and Sport
13. Secretary of State for the Home Nations
14. Leader of the House of Commons
15. (Whips Office)

A parallel set of fourteen shadow cabinet positions mirrors the government positions for the official opposition.

### Civil service

Thirteen departments correspond to the cabinet offices listed above (10 Downing Street, 11 Downing Street, Home Office, Foreign Office, Board of Trade, MoD, DWP, Department for Education, DEA, Department of Health, DoT, DCMS, and Department for the Home Nations). Departments are the actors in the civil service briefing and case systems.

### Legislation

A bill entity holds:

- **Metadata**: title, purpose, sponsoring department, Discourse forum URL.
- **Articles**: numbered clauses each with a heading and body text.
- **Extent and commencement clauses**: final article specifying geographic scope and when the Act takes effect.
- **Stage**: the current legislative position.
- **Amendments**: a list of proposed changes with supporting signatories and their own division records.
- **Stage reports**: content submitted during the Report Stage.

### Divisions

A division entity is linked to a parent entity (bill, motion, amendment, statement, or regulation) and records:

- Open/closed status and closing deadline (in both real and simulation time).
- Individual player votes (choice and weight).
- NPC votes per party.
- Party whip instructions.
- Rebellion log (players who voted against party instruction).
- Weighted tally of Ayes, Noes, and Abstentions.

---

## 4. Legislative Process

Bills move through a fixed sequence of stages. Stage advancement is controlled by the bill's sponsor or by admin/moderator oversight.

### Drafting

In the cabinet drafts system, ministers prepare draft legislation as cabinet papers before a bill is formally submitted. These drafts are visible only to cabinet members (and admins/moderators). A draft carries a title, purpose, and free-form content.

### First Reading

A bill is formally introduced to parliament at First Reading. This is a procedural stage: the bill is named and tabled without debate. It may be refused at this stage (status: `First Reading Refused`).

### Second Reading

The main debate stage. The bill is linked to a Discourse forum topic where players discuss it. Amendments may be proposed and supported during this window. The Second Reading window is two simulation months.

### Report Stage

The bill sponsor submits a Report Stage document that addresses the amendments received. This is followed by the Report Debate stage (also two simulation months), during which the amended text is discussed further.

### Final Division

A formal parliamentary vote is opened. The division remains open for one simulation month. All MPs (players and NPCs) cast votes; absent players delegate to their party leader. The weighted tally determines the outcome.

### Passage or defeat

- If Ayes exceed Noes: the bill passes and moves to `Passed – Awaiting Assent`. An admin or moderator then grants Royal Assent, moving the bill to `Act (Royal Assent Granted)`.
- If Noes exceed or equal Ayes: the bill is `Defeated in Division`.
- The sponsor may withdraw the bill at any stage, setting it to `Withdrawn`.

### Amendments

Amendments may be proposed and voted upon during the Second Reading and Report Debate stages. Each amendment has its own division. Amendments may be accepted, refused, or left pending according to their division result.

---

## 5. Voting and Divisions

### How votes are triggered

A division is created by an authorised actor (the bill sponsor, a government minister, or an admin) and attached to a parent entity. The division has a closing deadline expressed in simulation months. Once opened, all MPs may cast votes until the deadline.

### Weight calculation

The division engine assigns a numeric weight to each vote rather than counting one vote per player. The calculation works as follows:

1. The Speaker holds zero voting weight (they vote only in a tied division, casting by convention for the status quo).
2. Sinn Féin MPs do not take their seats and are automatically assigned an abstain vote with zero effective weight.
3. New backbenchers (those who joined within the last two simulation weeks) are each assigned weight 1.
4. The total remaining seats for each party are distributed among that party's settled players proportionally to their number.
5. Absent players' weight flows to their party leader. If the leader is also absent, weight flows to another available party member. If the leader has explicitly delegated to a named player of the same party, weight follows that delegation.

### Result calculation

After the division closes the tally function sums the weighted votes by choice. The outcome is:

- **Passed**: total Aye weight > total No weight.
- **Failed**: total No weight > total Aye weight.
- **Tied**: equal weights (exceedingly rare given weighted seat arithmetic).

### What is recorded

The division record stores every individual vote (actor name, party, choice, weight, timestamp), the NPC votes aggregated by party, the party whip instructions that were issued, any rebel requests made in advance, and the final rebellion log identifying players who voted against their party's instruction.

---

## 6. Simulation Time

### Mechanism

Simulation time is computed dynamically from three parameters stored in the game state:

- `startRealDate` — the real-world timestamp at which the simulation was started.
- `startSimMonth` / `startSimYear` — the simulation calendar date at that moment (default: August 1997).
- `isPaused` / `pausedAtRealDate` — if paused, time stops advancing from the stored real date.

The algorithm counts the number of Mondays and Thursdays that have elapsed between the start date and the current moment. Each Monday crossed advances the simulation by one month; each Thursday crossed advances it by another. This yields two simulation months per real week.

Sundays do not contain a Monday or Thursday boundary and therefore contribute no simulation time.

### Server and client parity

The clock module is implemented identically on both the server (`server/clock.js`) and client (`js/clock.js`). Every deadline check, countdown display, and "what month is it?" query uses the same algorithm, preventing any drift between what the server enforces and what the client shows.

### Helpers

The clock module exposes:

- `getSimDate(gameState, now)` — current simulation month and year.
- `plusSimMonths(month, year, n)` — a date *n* months in the future.
- `compareSimDates(a, b)` — chronological ordering of simulation dates.
- `isDeadlinePassed(deadline, gameState)` — whether a deadline has expired.
- `simMonthsRemaining(deadline, gameState)` — months remaining until a deadline.
- `countdownToSimMonth(target, gameState)` — human-readable countdown string (e.g., "2d 14h 30m").
- `realDateOfSimMonth(target, gameState)` — the real-world calendar date on which a simulation month will be reached.

### Pause and resume

An admin may pause the simulation at any point. While paused, the effective current time is fixed at `pausedAtRealDate`, so no deadlines advance and no new months tick over. Resuming the simulation shifts `startRealDate` forward by the paused interval so elapsed time is preserved correctly.

---

## 7. Geographic and Electoral Model

### The 1997 constituency dataset

The simulation's electoral map is derived from the real results of the United Kingdom general election of 1 May 1997. This election is the natural starting point for the simulation because:

- It produced a decisive result (Labour won 418 of 659 seats) that gives the government a workable majority without requiring complex coalition negotiation.
- It corresponds to the moment when several major constitutional changes (devolution, Bank of England independence) were about to be enacted, giving players meaningful legislative territory.
- The full 659-constituency result is publicly available and can be encoded reliably.

### Data structure

Each of the 659 constituency records holds:

```
id          — URL-safe slug identifier
name        — official constituency name
nation      — England | Scotland | Wales | Northern Ireland
region      — sub-national region (e.g., London, South East, Scotland)
party       — the party that won the seat in 1997
mpType      — "" (vacant) | "npc" | "character" (player)
mpName      — the name of the current occupant, if any
```

### Conversion from CSV

The raw data lives in `data/1997_structured.csv`. The conversion script `scripts/convert-1997-csv.js` reads four row types from that CSV (`constituency_result`, `vote_summary`, `seat_breakdown`, `overall_total`) and produces the structured JSON file `data/constituencies_1997.json`. The script normalises party name encodings (including handling Sinn Féin character encoding variants), maps devolved regions to their correct nations, and validates that exactly 659 constituencies are present before writing output.

### Use in gameplay

Constituency data feeds three primary gameplay systems:

1. **Character assignment** — when a player is approved as an MP they must claim a constituency that is not already taken by another player.
2. **Division weight** — the total number of seats held by each party determines how much collective vote weight that party's players share.
3. **Bodies** — devolved legislature seat counts and the national breakdown of the Commons are both derived from constituency-level party totals.

---

## 8. Role System

### Parliamentary roles

Every character in the simulation holds one of the following top-level parliamentary roles:

| Role identifier | Description |
|---|---|
| `prime-minister` | Government leader; access to full executive machinery |
| `leader-opposition` | Official opposition chief; commands shadow cabinet |
| `party-leader-3rd-4th` | Leader of a third or fourth party |
| `speaker` | Speaker of the House; does not vote; tie-break only |
| `backbencher` | Standard MP with no additional office |

In addition, characters may hold an **office** within their role:

- **Cabinet offices** — the fifteen government positions (Secretary of State, Chancellor, etc.).
- **Shadow cabinet offices** — the fourteen opposition mirror positions.
- **Parliamentary offices** — procedural roles such as Leader of the House of Commons.
- **Other offices** — roles that do not fit the above categories.

### Effect on permissions

A character's role and office determine what actions they may take:

- Only the Prime Minister (or admin/moderator) may open and manage cabinet papers.
- Only the Chancellor may draft the budget.
- Only cabinet members may access the civil service briefing and case systems for their department.
- Only a bill's sponsor or an authorised office holder may advance a bill through its stages or open a final division.
- Admins and moderators have universal management access across all systems.
- The Speaker moderates divisions but does not participate in the vote tally.

### Special handling for certain roles

- **Sinn Féin** MPs hold seats but do not take them. They are excluded from division tallies automatically.
- **The Speaker** participates in debates but has zero voting weight in divisions.
- **New backbenchers** (joined within two simulation weeks) have reduced weight (1 each) in divisions until they are considered settled.
- **Privy Council membership** (the post-nominal "PC") is awarded for life on appointment to Prime Minister, Leader of the Opposition, or leader of a third or fourth party. The post-nominal "MP" is universal for all players with a parliamentary seat.

---

## 9. Institutional Structure

The simulation models a hierarchy of UK government institutions. Decision-making flows between them as follows.

```
Crown (formal assent)
│
└── Parliament
    ├── House of Commons  ←─── primary legislative chamber
    │   ├── Government benches
    │   │   └── Cabinet (15 offices)
    │   │       └── Civil Service (13 departments)
    │   │           ├── Briefings (policy memos)
    │   │           └── Cases (scandals / investigations)
    │   └── Opposition benches
    │       └── Shadow Cabinet (14 positions)
    │
    └── House of Lords  (body in the system; non-voting in current model)
│
└── Devolved institutions
    ├── Scottish Parliament  (129 seats)
    ├── Welsh Assembly       (60 seats)
    ├── Northern Ireland Assembly (108 seats)
    └── Directly Elected Mayors
│
└── European Parliament  (87 seats, 1997-era)
```

### Decision flow for legislation

1. A government minister (or any MP) drafts a bill, often starting with a cabinet paper.
2. The bill is formally introduced in the House of Commons at First Reading.
3. It proceeds through Second Reading debate, Report Stage, and Report Debate.
4. A Final Division is called; the House votes by weighted division.
5. If passed, the bill waits for an admin or moderator to grant Royal Assent on behalf of the Crown.
6. The resulting Act is recorded with its extent and commencement date.

### Decision flow for the executive

1. The Prime Minister sets a cabinet headline agenda.
2. Cabinet ministers prepare papers through the cabinet drafts system.
3. Departments issue civil service briefings that may present branching policy scenarios to the relevant Secretary of State.
4. Civil service cases track ongoing departmental issues that may require ministerial decisions.
5. The Chancellor sets the budget through the budget system; it is reviewed and approved by admins/moderators.

---

## 10. Example Simulation Flow

The following illustrates how a government bill passes through the system from inception to Royal Assent.

**Step 1 – Cabinet preparation**  
The Secretary of State for Health drafts a cabinet paper titled "NHS Reform Bill" with a stated purpose and outline content. This is visible only to cabinet members.

**Step 2 – First Reading**  
The Secretary of State submits the bill formally. It receives its title, purpose, sponsoring department, and initial article text. The simulation records it as `First Reading`.

**Step 3 – Second Reading (debate opens)**  
An admin or the bill sponsor advances it to Second Reading. The simulation automatically creates a Discourse forum topic for debate. The Second Reading window lasts two simulation months (approximately one real week). During this time other players may propose amendments.

**Step 4 – Report Stage**  
The sponsor submits a Report Stage document responding to amendments. The Report Debate window opens (another two simulation months). Players debate the amendments and further amendments may be proposed.

**Step 5 – Final Division**  
The sponsor or an admin opens the Final Division. The division closes after one simulation month. All MPs — players and NPCs — cast votes. Absent players' weight flows to the party leader.

**Step 6 – Tally and outcome**  
When the division closes, the system totals weighted Ayes and Noes. If Ayes > Noes the bill is marked `Passed – Awaiting Assent`.

**Step 7 – Royal Assent**  
An admin or moderator grants Royal Assent. The bill becomes `Act (Royal Assent Granted)` and is recorded with its extent (e.g., "England and Wales") and commencement date (e.g., "in six months").

---

## 11. Data Sources

### Constituency data (`data/constituencies_1997.json`)

Derived from the 1997 UK general election results. Contains 659 records covering every Westminster constituency with party affiliation, region, and nation. This file is generated once by `scripts/convert-1997-csv.js` and treated as a static reference; it seeds the initial seat distribution used throughout the simulation.

### Raw CSV (`data/1997_structured.csv`)

The source data for constituency conversion. Structured with multiple row types (`constituency_result`, `vote_summary`, `seat_breakdown`, `overall_total`) allowing the conversion script to produce both individual constituency records and aggregate party totals.

### Demo dataset (`data/demo.json`)

A read-only snapshot of a running simulation used for public demonstration. It contains:

- A full `gameState` object (start date, sim start month/year, pause state).
- `parliament` object (seat totals per party, government party, setup type).
- A `players` array with sample characters across roles and parties.
- Default economic indicators (GDP growth 1.8%, inflation 2.6%, unemployment 4.3%).
- Placeholder data for newspapers, surveys, and order paper items.

The demo dataset establishes the shape of the live game state for frontend developers working without a database connection and for new users exploring the simulation before registering.

### How datasets shape the simulation world

- **Seat counts** from constituency data determine division vote weights; a party with 418 seats has proportionally more influence in a division than one with 46.
- **Regional distribution** from the CSV is used to filter constituencies by nation when assigning MPs to devolved institution contexts.
- **Economic defaults** in the demo dataset initialise the macroeconomic indicators that provide context for budget debates and policy decisions.

---

## 12. Factions and Faction Political State

### What factions are

Factions are intra-party ideological groupings that exist within playable parties (Labour, Conservative, Liberal Democrat). Each faction has:

- **Slug and name** — a machine-readable identifier and display name (e.g., `faction_1922` / "Conservative 1922 Committee").
- **Alignment** — `aligned` (supportive of current party leadership), `hostile` (in opposition to leadership), or `neutral`.
- **Rebellion bias** — a numeric indicator of how prone the faction's members are to vote against the whip.
- **MP count** — the number of MPs associated with the faction (editable by admins/mods without code changes).
- **Influence bonus** — an additional weighting factor applied to the faction's power calculation.

### Computed faction state

For each faction the system computes and persists a `faction_political_state` record:

| Field | Description |
|---|---|
| `internal_power` | Derived from `(mp_count × 0.8) + (influence_bonus × 10)`. Indicates how much weight the faction carries within the party. |
| `momentum` | `rising`, `stable`, or `falling` — derived by comparing current `internal_power` to the previously stored value. |
| `leadership_pressure` | Pressure the faction exerts on the party leadership. Hostile factions with high `internal_power` produce high pressure; aligned factions produce negative pressure (damping effect); neutral factions produce a modest baseline. |
| `cohesion` | `max(5, 70 - (rebellion_bias × 40))`. Reflects how unified the faction's members tend to be. Minimum value is 5. |
| `breakdown` | JSONB object with a note explaining the formula weights. |

### Party climate

`getPartyFactionClimate(partySlug)` aggregates across all factions in a party to produce a climate object:

- **Hostile pressure** — sum of `leadership_pressure` from hostile factions.
- **Aligned damping** — sum of `leadership_pressure` from aligned factions (subtracted from hostile pressure).
- **Net climate score** — `hostile_pressure - aligned_strength`. Determines the climate label:
  - `> 15`: `"hostile"` — significant faction opposition to leadership
  - `10–15`: `"tense"` — notable internal pressure
  - `5–10`: `"unsettled"` — mild internal friction
  - `< 5`: `"stable"` — faction landscape is supportive or neutral
- **`partyPressureModifier`** — added to `party_pressure` for every character in the party when political state is recomputed.
- **`capitalResilienceBonus`** — added to `capital_current` for every character in the party (from aligned faction support).

### Seeded factions

`seed1997Factions()` creates an initial set of factions reflecting the post-1997 landscape:
- **Labour**: Blairite mainstream, Campaign Group (left), Labour First (centrist), Blue Labour (traditionalist)
- **Conservative**: 1922 Committee, Tory Reform Group (modernisers), ERG (Eurosceptic)
- **Liberal Democrats**: Federalist Group

Faction data is editable via the Control Panel without code changes.

---

## 13. Political Capital and Political Pressure

### Political capital

Political capital is a per-character score measuring accumulated political influence. It is computed by `recomputeCharacterPoliticalState()` and stored in `character_political_state.capital_current`.

**Capital sources (additive):**

| Source | Delta |
|---|---|
| Prime Minister office | +30 |
| Cabinet office | +20 |
| Leader of the Opposition | +20 |
| Leader of the House of Commons | +15 |
| Shadow cabinet office | +10 |
| Other parliamentary office | +8 |
| Party leader role | +12 |
| Chief/Deputy Whip role | +6 |
| Party Whip role | +4 |
| Party Chairman role | +4 |
| Each positive marked press item | +3 |
| Each negative marked press item | −5 |
| Each active scandal | −10 |
| Each major resolved scandal (severity > 3) | −15 |
| Active work plan (submitted within 3 sim months) | +5 |
| Aligned faction climate bonus | variable |

**Capital indicators:**

| Field | Description |
|---|---|
| `capital_current` | Current computed total |
| `capital_trend` | Difference from previous computation (positive = rising) |
| `momentum` | `rising` (trend ≥ +5), `stable`, or `falling` (trend ≤ −5) |
| `reputation` | `excellent` (≥ 60), `good` (≥ 30), `neutral` (≥ 10), `poor` (≥ −10), `damaged` (< −10) |
| `breakdown` | JSONB array of contributing factors with category, label, and delta |

### Political pressure

Political pressure measures the external forces weighing on a character. It is computed alongside capital and stored as multiple channels:

| Channel | Sources |
|---|---|
| `party_pressure` | Rebellion log history (weighted by whip level), refused rebel requests, pending rebel requests, hostile faction climate |
| `constituency_pressure` | Stale or missing work plan |
| `media_pressure` | *Computed but not yet fully populated — reserved for future press system integration* |
| `group_pressure` | *Reserved for future use* |
| `institutional_pressure` | *Reserved for future use* |
| `rebellion_risk` | *Reserved for future use* |

All pressure channels are clamped to 0–100.

**Party pressure whip weights:**
- 3-line whip rebellion: +25 per incident
- 2-line whip rebellion: +15 per incident
- 1-line whip rebellion: +8 per incident
- Free vote rebellion: +3 per incident
- Refused rebel request: +10
- Pending rebel request: +5

### Recompute triggers

`recomputeCharacterPoliticalState()` is called non-blocking (fire-and-forget) from these events:
- Division vote cast or updated
- Office assigned or removed
- Scandal opened, decided, or closed
- Press item marked
- Work plan submitted or updated
- Rebel request submitted or decided
- Constituency work plan saved

**Timing caution:** Because calls are non-blocking, political state values may be briefly stale immediately after a triggering action. Do not rely on freshly-computed political state in the same response as the triggering mutation.

---

## 14. Personal and Party Finance

### Personal finance

Each character has a `character_finance` record maintained by the server. Finance includes:

- **Salary** — determined by the character's office assignment and the salary band for that office, drawn from `character_positions` and `finance_config`. Salary is expressed in pounds per simulation month.
- **Bank balance** — running total adjusted by salary inflows, property costs, and shop purchases.
- **Additional revenue** — supplemental income sources recorded in `character_additional_revenue`.
- **Property costs** — computed from the character's constituency location and property holdings.
- **Shop purchases** — one-off items purchased via the in-game shop system (`character_shop_purchases`).

Finance is visible to the character themselves and to admins/mods via separate API routes:
- `GET /api/me/finance` — player's own finance summary
- `GET /api/me/finance/summary` — simplified summary view
- Admin routes under `/api/admin/finance/*` — full management access

Salary bands and starting balances are configured globally via `finance_config` and are uprated for inflation by admins using the salary-scales endpoints.

### Party finance

Parties maintain a treasury balance and multiple finance streams:

- **Membership fees** — configurable per-party fee schedule
- **Donations** — logged via donation API routes
- **Fundraising** — events managed through `fundraising_items`; proceeds credited to the party treasury

Party finance is visible to party members and managed by party leaders, admins, and mods.

---

## 15. Role of Staff Scenarios (Civil Service Briefings)

Civil service departments issue briefings to the relevant cabinet minister. Each briefing may present a branching scenario with multiple policy choices. Staff (admins/mods acting as the civil service) create briefings; cabinet ministers respond with their policy decision.

**Briefing lifecycle:**
1. Admin/mod creates a briefing for a department (e.g., Home Office) with a scenario description and options.
2. The relevant Secretary of State reads the briefing and selects a response option.
3. The response is recorded and may trigger consequences (e.g., additional briefings, scandal exposure, political capital effects).

**Civil service cases** track ongoing departmental issues (scandals, investigations, policy reviews) with a status lifecycle managed by admins/mods.

This system gives the civil service (staff) a mechanism to inject structured policy dilemmas into the simulation without requiring code changes.

---

## 16. Simulation Constraints

The following limitations apply to the current implementation.

**Simplified legislative process**
Bills move through a linear sequence of stages; there is no committee stage, no Lords stage, and no ping-pong between chambers. The House of Lords exists as a tracked body but does not participate in the bill passage mechanism.

**Static constituency boundaries**
The 1997 constituency data is fixed at start-up. There are no by-elections, no redistribution of seats, and no mechanism for seats to change hands during play.

**NPC voting by instruction only**
NPCs vote according to party whip instructions entered by a whip or admin. They do not have independent policy preferences or rebellion probability.

**No AI-driven actors**
All political agency comes from human players. There is no AI generating political behaviour.

**Limited economic simulation** *(partially implemented)*
The budget system records revenues and expenditures and calculates aggregate fiscal metrics (deficit, debt, GDP ratios). Economic indicators (GDP, inflation, unemployment) are admin-editable fields. A dynamic model linking policy choices to economic outcomes is not yet implemented.

**Polling** *(partially implemented)*
Polling entries can be created and archived by staff. A live polling engine driven by gameplay events is not yet implemented.

**No election mechanism**
The simulation begins post-election. A general election mechanism for redistributing seats is planned but not implemented.

**Single chamber voting**
Only the House of Commons participates in divisions.

---

## 17. Planned Simulation Extensions

The following extensions are planned or natural candidates for the next development phase:

**Dynamic economic model**
Budget revenues and expenditures already feed into deficit and debt calculations. Connecting spending decisions to economic indicator values would allow policy choices to have in-simulation consequences.

**Live polling engine**
The polling entry system exists. A polling engine that adjusts party approval ratings based on legislation, scandal exposure, and economic conditions would add depth.

**House of Lords legislative stage**
The Lords already exist as a tracked body. A Lords reading stage between `Passed – Awaiting Assent` and Royal Assent would add a second chamber dynamic.

**Elections and seat redistribution**
The constituency data structure already supports tracking party affiliation per seat. An election engine could compute swing percentages and redistribute seats.

**NPC behavioural modelling**
NPCs could be given ideological profiles and rebellion probabilities, making division outcomes less predictable.

**By-elections**
Individual constituency seats could change hands mid-simulation, updating party seat totals and division weights.

**Devolved legislative processes**
The Scottish Parliament, Welsh Assembly, and Northern Ireland Assembly already have seat counts. Giving them their own bill stage pipelines would allow devolved legislation to be modelled separately.

**Committee stage for legislation**
A committee of MPs could scrutinise a bill after Second Reading, proposing amendments with a quorum-based mini-division.
