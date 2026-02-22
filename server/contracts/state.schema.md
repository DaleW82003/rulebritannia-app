# Rule Britannia — Application State Data Contract

> **This is a frozen v1.0 contract. Do not modify without a deliberate versioned update.**

---

## Quick Reference: Where Does Each Page's Data Live?

| Page / Feature          | Primary Data Source(s)                              |
|-------------------------|-----------------------------------------------------|
| `dashboard.html`        | `sim`, `users[me]`, `parties`, `polling.latest`     |
| `government.html`       | `government.offices`, `users`                       |
| `opposition.html`       | `opposition.offices`, `users`                       |
| `cabinet.html`          | `government.offices` (cabinet tier), `users`        |
| `shadowcabinet.html`    | `opposition.offices`, `users`                       |
| `parliament.html`       | `parliament.constituencies`, `parliament.seats`     |
| `constituencies.html`   | `parliament.constituencies`, `users`                |
| `bills.html`            | `bills[]`                                           |
| `bill.html`             | `bills[id]`                                         |
| `submit-bill.html`      | `bills[]` (write), `users[me]`                      |
| `motions.html`          | `motions[]`                                         |
| `motion.html`           | `motions[id]`                                       |
| `statements.html`       | `statements[]`                                      |
| `statement.html`        | `statements[id]`                                    |
| `regulations.html`      | `regulations[]`                                     |
| `regulation.html`       | `regulations[id]`                                   |
| `questiontime.html`     | `questionTime`                                      |
| `hansard.html`          | `bills[]`, `motions[]`, `statements[]`, `divisions[]`|
| `press.html`            | `press.releases[]`, `press.conferences[]`           |
| `polling.html`          | `polling.entries[]`, `polling.archive[]`            |
| `economy.html`          | `economy`                                           |
| `news.html`             | `press.releases[]` (public, marked)                 |
| `elections.html`        | `parliament.seats`, `polling.entries[]`             |
| `debates.html`          | `bills[].debate`, `motions[].debate`                |
| `redlion.html`          | `users` (online presence)                           |
| `online.html`           | `users` (online presence)                           |
| `party.html`            | `users`, `parties`                                  |
| `team.html`             | `users` (mod/admin roles)                           |
| `personal.html`         | `users[me]`                                         |
| `user.html`             | `users[id]`                                         |
| `fundraising.html`      | `parties` (funds), `users[me]`                      |
| `events.html`           | `events[]`                                          |
| `budget.html`           | `economy`, `bills[]` (Finance Bill)                 |
| `papers.html`           | `bills[]`, `regulations[]`, `statements[]`          |
| `bodies.html`           | `government.bodies[]`                               |
| `civilservice.html`     | `government.civilService`                           |
| `locals.html`           | `parliament.localCouncils[]`                        |
| `admin-panel.html`      | All domains (admin read/write)                      |
| `control-panel.html`    | `sim`, `users` (mod controls)                       |
| `login.html`            | `users` (auth)                                      |
| `rules.html`            | Static content                                      |
| `guides.html`           | Static content                                      |

---

## 1. Simulation Clock (`sim`)

The master clock that drives all time-dependent logic.

| Field         | Type                   | Description                                                                 |
|---------------|------------------------|-----------------------------------------------------------------------------|
| `now`         | `{ month, year }`      | Current simulation time. `month` is 1–12, `year` is a four-digit integer.  |
| `year`        | integer                | Convenience alias for `now.year`.                                           |
| `month`       | integer (1–12)         | Convenience alias for `now.month`.                                          |
| `freeze`      | boolean                | When `true`, the sim clock is frozen (Sunday maintenance window or paused). |
| `is_paused`   | boolean                | Explicit pause flag set by a moderator; distinct from the Sunday freeze.    |
| `last_tick_at`| string \| null         | UTC ISO-8601 timestamp of the most recent clock tick.                       |

---

## 2. Users & Roles (`users`)

Each registered player or staff member.

| Field               | Type                    | Description                                                                 |
|---------------------|-------------------------|-----------------------------------------------------------------------------|
| `id`                | string (UUID)           | Unique user identifier.                                                     |
| `name`              | string                  | Display name.                                                               |
| `email`             | string                  | Login email address.                                                        |
| `party`             | string \| null          | Party affiliation key (e.g. `"labour"`, `"conservative"`). Null for crossbenchers / staff. |
| `roles`             | string[]                | Array of role tokens: `"admin"`, `"mod"`, `"speaker"`, `"player"`.         |
| `is_active`         | boolean                 | Whether the account is enabled and able to participate.                     |
| `absence_status`    | `"present"` \| `"absent"` \| `"delegated"` | Current attendance status.                        |
| `delegation_target` | string (UUID) \| null   | If `absence_status` is `"delegated"`, the userId receiving this user's vote.|

---

## 3. Parliament (`parliament`)

Structural data about the House of Commons.

### 3.1 Constituencies (`parliament.constituencies`)

An array of 650 constituency objects.

| Field          | Type          | Description                                      |
|----------------|---------------|--------------------------------------------------|
| `id`           | string        | Unique constituency identifier / slug.           |
| `name`         | string        | Full constituency name.                          |
| `region`       | string        | Geographic region (e.g. `"South East"`).         |
| `held_by`      | string        | Party key of the current MP.                     |
| `mp_userId`    | string \| null| UserId of the player MP, or null if uncontested. |
| `majority`     | integer       | Vote majority at last election.                  |
| `marginality`  | `"safe"` \| `"marginal"` \| `"ultra-marginal"` | Seat classification. |

### 3.2 Seat Totals (`parliament.seats`)

| Field     | Type                        | Description                             |
|-----------|-----------------------------|-----------------------------------------|
| `totals`  | `Record<partyKey, integer>` | Number of seats held by each party.     |
| `majority`| integer                     | Seats required for an overall majority. |

### 3.3 Party Standings (`parliament.parties`)

| Field        | Type    | Description                                   |
|--------------|---------|-----------------------------------------------|
| `key`        | string  | Party identifier (e.g. `"labour"`).            |
| `name`       | string  | Full party name.                              |
| `short_name` | string  | Abbreviation (e.g. `"Lab"`).                  |
| `colour`     | string  | Hex colour code for UI rendering.             |
| `funds`      | number  | Current party funds in simulated GBP.         |
| `leader_id`  | string \| null | UserId of the elected party leader.    |

---

## 4. Government Offices (`government.offices`)

Maps each office to the user currently holding it. Covers both Cabinet and Parliamentary Under-Secretary tiers.

| Field           | Type             | Description                                                        |
|-----------------|------------------|--------------------------------------------------------------------|
| `officeId`      | string           | Unique office key (e.g. `"prime_minister"`, `"home_secretary"`).   |
| `title`         | string           | Official title of the office.                                      |
| `tier`          | `"cabinet"` \| `"parliamentary"` | Government tier.                                 |
| `holder_userId` | string \| null   | UserId of the current holder, or null if vacant.                   |
| `department`    | string           | Parent department key.                                             |

---

## 5. Opposition Offices (`opposition.offices`)

Same structure as Government Offices but for the official opposition shadow team.

| Field           | Type             | Description                                                        |
|-----------------|------------------|--------------------------------------------------------------------|
| `officeId`      | string           | Shadow office key (e.g. `"shadow_home_secretary"`).                |
| `title`         | string           | Shadow title.                                                      |
| `holder_userId` | string \| null   | UserId of the shadow minister, or null if vacant.                  |
| `department`    | string           | Corresponding government department key.                           |

---

## 6. Bills (`bills`)

Legislative items progressing through Parliament.

### 6.1 Core Fields

| Field        | Type                          | Description                                                                              |
|--------------|-------------------------------|------------------------------------------------------------------------------------------|
| `id`         | string (UUID)                 | Unique bill identifier.                                                                  |
| `title`      | string                        | Short title of the bill.                                                                 |
| `summary`    | string                        | Plain English description of the bill's purpose.                                         |
| `sponsor`    | string (UUID)                 | UserId of the sponsoring MP.                                                             |
| `party`      | string                        | Sponsoring party key.                                                                    |
| `stage`      | enum (see below)              | Current parliamentary stage.                                                             |
| `amendments` | Amendment[]                   | Array of tabled amendments (see 6.2).                                                    |
| `divisions`  | Division[]                    | Array of recorded votes (see 6.3).                                                       |
| `house`      | `"commons"` \| `"lords"`      | House in which the bill is currently being considered.                                   |
| `type`       | `"public"` \| `"private"` \| `"private_member"` | Bill classification.                                         |

### 6.1.1 Stage Enum

`first_reading` → `second_reading` → `committee` → `report` → `third_reading` → `royal_assent` | `defeated`

### 6.2 Amendments

| Field        | Type          | Description                              |
|--------------|---------------|------------------------------------------|
| `id`         | string        | Amendment identifier.                    |
| `text`       | string        | Amendment text.                          |
| `tabled_by`  | string (UUID) | UserId of the MP who tabled it.          |
| `status`     | `"tabled"` \| `"accepted"` \| `"rejected"` | Outcome of the amendment. |

### 6.3 Divisions (Votes)

| Field      | Type                        | Description                            |
|------------|-----------------------------|----------------------------------------|
| `id`       | string                      | Division identifier.                   |
| `question` | string                      | Question put to the House.             |
| `ayes`     | string[] (UserIds)          | Members who voted Aye.                 |
| `noes`     | string[] (UserIds)          | Members who voted No.                  |
| `abstains` | string[] (UserIds)          | Members who abstained.                 |
| `result`   | `"passed"` \| `"failed"`    | Division outcome.                      |
| `held_at`  | `{ month, year }`           | Sim time at which the division was held.|

### 6.4 Lifecycle Fields (Bills)

See the **Shared Lifecycle Fields** section (§12).

---

## 7. Motions (`motions`)

House motions (including Early Day Motions).

| Field        | Type                        | Description                                              |
|--------------|-----------------------------|----------------------------------------------------------|
| `id`         | string (UUID)               | Unique motion identifier.                                |
| `title`      | string                      | Motion title.                                            |
| `text`       | string                      | Full motion text.                                        |
| `type`       | `"motion"` \| `"edm"`       | Whether this is a substantive motion or an EDM.          |
| `tabled_by`  | string (UUID)               | UserId of the MP who tabled the motion.                  |
| `party`      | string                      | Tabling MP's party key.                                  |
| `signatories`| string[] (UserIds)          | MPs who have signed the motion (EDMs primarily).         |
| `divisions`  | Division[]                  | Recorded votes on this motion (same structure as §6.3).  |

### 7.1 Lifecycle Fields (Motions)

See §12.

---

## 8. Statements (`statements`)

Ministerial statements delivered to the House.

| Field        | Type          | Description                                         |
|--------------|---------------|-----------------------------------------------------|
| `id`         | string (UUID) | Unique statement identifier.                        |
| `title`      | string        | Statement heading.                                  |
| `body`       | string        | Full statement text.                                |
| `minister_id`| string (UUID) | UserId of the minister making the statement.        |
| `department` | string        | Government department key.                          |
| `house`      | `"commons"` \| `"lords"` | House in which the statement is delivered. |

### 8.1 Lifecycle Fields (Statements)

See §12.

---

## 9. Regulations (`regulations`)

Statutory Instruments (secondary legislation).

| Field        | Type          | Description                                              |
|--------------|---------------|----------------------------------------------------------|
| `id`         | string (UUID) | Unique regulation identifier.                            |
| `title`      | string        | Regulation title.                                        |
| `summary`    | string        | Plain English summary.                                   |
| `laid_by`    | string (UUID) | UserId of the minister who laid the instrument.          |
| `department` | string        | Department key responsible.                              |
| `si_number`  | string \| null| Statutory Instrument reference number once assigned.     |
| `procedure`  | `"negative"` \| `"affirmative"` \| `"super_affirmative"` | Parliamentary procedure type. |
| `divisions`  | Division[]    | Any approval/annulment votes (same structure as §6.3).   |

### 9.1 Lifecycle Fields (Regulations)

See §12.

---

## 10. Question Time (`questionTime`)

Structured per-department oral question sessions.

### 10.1 Department Block

| Field        | Type            | Description                                         |
|--------------|-----------------|-----------------------------------------------------|
| `department` | string          | Department key.                                     |
| `rota_month` | `{ month, year }`| Sim month this department is next on the rota.     |
| `questions`  | QtQuestion[]    | Active questions for the upcoming session.          |
| `archive`    | QtQuestion[]    | Closed/answered questions from past sessions.       |

### 10.2 QtQuestion

| Field        | Type          | Description                                              |
|--------------|---------------|----------------------------------------------------------|
| `id`         | string (UUID) | Question identifier.                                     |
| `text`       | string        | The question text.                                       |
| `asker_id`   | string (UUID) | UserId of the MP asking.                                 |
| `deadline`   | `{ month, year }` | Sim deadline by which an answer is expected.         |
| `answer`     | string \| null| Minister's answer text, or null if unanswered.           |
| `answer_by`  | string \| null| UserId of minister who answered, or null.                |
| `followups`  | QtFollowup[]  | Array of supplementary question/answer pairs.            |

### 10.3 QtFollowup

| Field        | Type          | Description                            |
|--------------|---------------|----------------------------------------|
| `text`       | string        | Supplementary question text.           |
| `asker_id`   | string (UUID) | UserId of the MP asking.               |
| `response`   | string \| null| Minister's response, or null.          |

### 10.4 Lifecycle Fields (QtQuestion)

See §12.

---

## 11. Press (`press`)

### 11.1 Press Releases (`press.releases`)

| Field        | Type          | Description                                                  |
|--------------|---------------|--------------------------------------------------------------|
| `id`         | string (UUID) | Unique release identifier.                                   |
| `headline`   | string        | Press release headline.                                      |
| `body`       | string        | Full release text.                                           |
| `issued_by`  | string (UUID) | UserId of the issuing player.                                |
| `party`      | string        | Issuing party key.                                           |
| `is_marked`  | boolean       | Whether a moderator has marked/approved it for the news page.|
| `comments`   | PressComment[]| Moderator or player comments.                                |

### 11.2 Press Conferences (`press.conferences`)

| Field        | Type            | Description                                              |
|--------------|-----------------|----------------------------------------------------------|
| `id`         | string (UUID)   | Unique conference identifier.                            |
| `title`      | string          | Conference title / topic.                                |
| `host_id`    | string (UUID)   | UserId of the hosting player.                            |
| `party`      | string          | Hosting party key.                                       |
| `questions`  | PressQ[]        | Submitted questions from journalists/players.            |
| `is_marked`  | boolean         | Moderator approval flag.                                 |

### 11.3 PressComment / PressQ

| Field     | Type          | Description                      |
|-----------|---------------|----------------------------------|
| `id`      | string        | Comment/question identifier.     |
| `text`    | string        | Content text.                    |
| `author_id`| string (UUID)| UserId of the author.            |
| `posted_at`| string       | UTC ISO-8601 timestamp.          |

### 11.4 Lifecycle Fields (Press)

See §12.

---

## 12. Polling (`polling`)

Weekly opinion poll data published each Sunday.

| Field     | Type            | Description                                              |
|-----------|-----------------|----------------------------------------------------------|
| `id`      | string (UUID)   | Poll entry identifier.                                   |
| `week`    | `{ month, year }`| Sim month/year this poll covers.                        |
| `results` | `Record<partyKey, number>` | Vote share percentage per party (must sum to 100). |
| `trend`   | `Record<partyKey, number>` | Change in vote share since previous poll (+/-). |
| `archive` | PollingEntry[]  | Historical polls, ordered newest-first.                  |

### 12.1 Lifecycle Fields (PollingEntry)

See §12.

---

## 13. Economy (`economy`)

Macroeconomic state of the simulation.

### 13.1 Topline Indicators

| Field          | Type   | Description                                               |
|----------------|--------|-----------------------------------------------------------|
| `gdpGrowth`    | number | Annual GDP growth rate as a percentage (e.g. `2.1`).     |
| `inflation`    | number | CPI inflation rate as a percentage.                       |
| `unemployment` | number | Unemployment rate as a percentage.                        |

### 13.2 Expandable Data Blocks

Six collapsible data blocks provide deeper economic context. Each block is an array of tile/entry objects.

| Block key      | Description                                              |
|----------------|----------------------------------------------------------|
| `ukInfoTiles`  | Summary info tiles (e.g. trade balance, deficit, debt).  |
| `surveys`      | Business and consumer confidence survey results.         |
| `sectorOutput` | Output indices by economic sector.                       |
| `tradeData`    | Import/export figures by trading partner.                |
| `publicFinances`| Revenue, expenditure, and borrowing figures.            |
| `labourMarket` | Detailed employment and wage statistics.                 |

---

## 12. Shared Lifecycle Fields

All content types (Bills, Motions, Statements, Regulations, QtQuestions, Press items, PollingEntries) carry the following lifecycle fields:

| Field                      | Type                                              | Description                                                                     |
|----------------------------|---------------------------------------------------|---------------------------------------------------------------------------------|
| `createdAtSim`             | `{ month: integer, year: integer }`               | Simulation month and year when the item was created.                            |
| `createdAtReal`            | string (UTC ISO-8601)                             | Wall-clock timestamp when the item was created.                                 |
| `status`                   | `"draft"` \| `"open"` \| `"closed"` \| `"archived"` | Current lifecycle state.                                                     |
| `visibility`               | `"public"` \| `"party"` \| `"cabinet"` \| `"mod"` | Who can see the item.                                                          |
| `autoArchiveAfterSimMonths`| integer \| null                                   | Number of sim months after creation before automatic archival; null = never.   |
| `debate`                   | DebateRef \| null                                 | Link to an associated forum debate topic (see below).                           |

### DebateRef

| Field         | Type                              | Description                                                     |
|---------------|-----------------------------------|-----------------------------------------------------------------|
| `topicId`     | string \| null                    | Forum topic ID.                                                 |
| `topicUrl`    | string \| null                    | Full URL to the forum topic.                                    |
| `opensAtSim`  | `{ month, year }` \| null         | Sim time at which the debate opens.                             |
| `closesAtSim` | `{ month, year }` \| null         | Sim time at which the debate closes.                            |
