# SmartStore — Customer Domain

**Phase 1 — Product & Domain Specification.**

Owner of: `Customer`, `CustomerAddress`, `CustomerAccount`, `CustomerLedgerEntry`, `LoyaltyAccount`,
`LoyaltyTransaction`. Money settlement is in [payment-domain.md](payment-domain.md); the AR consequence of a
credit sale is in [sales-pos-domain.md](sales-pos-domain.md) §8.

---

## 1. The walk-in customer

> **A walk-in is a customer record, not a null.**

**Rule CU-01.** Every `Sale` carries a non-null `CustomerId` (SP-01). A walk-in resolves to a single shared
`WalkIn` customer record per organization, flagged as such. This is a real decision with a real cost, and the cost
is worth paying:

- It removes the "what does a null customer mean?" question from every report, every return, every loyalty
  calculation, and every receipt.
- It means a customer who later wants a receipt, or a return, has a real transaction to point at.
- It means a sale can never be "orphaned" by a customer record being deleted.

**The cost, stated:** walk-in transactions inflate the customer table, and any report that counts customers needs
`IsWalkIn = false`. That is one filter, on one field. The alternative — a nullable customer — puts a null check in
every query and every document render, forever, and each one is a chance to forget.

**Rule CU-02 — a walk-in record may be promoted.** When staff identify the person, the walk-in's history is
retained and the transactions are **re-attributed** to the identified customer by a reason-bearing, audited
`CustomerMerge`. History is never moved silently: the merge records the walk-in id, the target id, and the
transaction count.

**Rule CU-03.** Merging two real customers is a separate, approvaled operation, because it moves credit balances
and loyalty points. It requires `Customer.Credit.Approve` and a reason (BI-25, BI-26).

---

## 2. Customer identity and matching

**Rule CU-04 — identity keys.** A customer may be identified by any of: phone, email, membership number,
tax/identity number (jurisdiction permitting), or a customer-defined external reference. Each key is **unique
within the organization** when present.

**Rule CU-05 — a duplicate is detected on save, not silently created.** A save that would duplicate a phone or
email is rejected with the existing customer's name, so the cashier can attach to them. Two customers with the
same phone is a legitimate thing (a shared household phone), so this is a **warning with an explicit
"create anyway"**, not a hard block. The choice is recorded either way.

**Rule CU-06 — search is a name/phone/email/member-number prefix search, store-agnostic.** A customer belongs to
the organization, not to a store (organization-model §8.1), and shopped at any of them.

**Rule CU-07 — what a cashier may see is deliberately narrow** (actors-and-roles §3.10): name, masked contact,
loyalty balance, credit standing, and the current transaction. Purchase history, other balances, and full contact
details are not needed to serve the counter and are withheld. This is a **response-shaping** rule, not a column
hiding rule — the API does not return the field at all.

**Rule CU-08 — customer data visibility is store-scoped in reports**, and a cross-store report requires
`Report.OrganizationWide` (BI-14, MS-02). A store manager does not get the chain's customer list by default.

---

## 3. Customer status

| Status | Meaning | Can be sold to | Can transact |
|---|---|---|---|
| `Active` | Normal | Yes | Yes |
| `OnHold` | A flag someone must review — suspected fraud, a dispute, a debt dispute | **Yes, with a note** | Yes, with a note |
| `CreditBlocked` | May buy, may not take goods on account | Yes, paid only | No credit |
| `Closed` | No longer a customer; history retained | No | No |

**Rule CU-09 — `OnHold` warns; it does not refuse.** Blocking service to a customer over an internal flag is a
customer-service failure and is also exactly what a customer disputes should not provoke. The warning appears, the
manager is notified, and staff are told what to do. A hard block is reserved for `CreditBlocked`, which is a
financial control.

**Rule CU-10 — no customer is ever deleted** (BI-40). `Closed` is a status. Their statements, their receipts, and
their tax history remain renderable, because a receipt printed in 2029 must still resolve the customer's name.

---

## 4. Customer account and credit

### 4.1 The structure

`CustomerAccount` is **optional**. Most retail customers have none, and a customer's credit facility is a
separate business fact from their existence as a customer.

`CustomerAccount` holds: customer, account number, credit limit, current balance (**a projection**, not a stored
mutable total), payment terms in days, status, opened date, and the store that owns the account.

**Rule CU-11 — the balance is a projection of `CustomerLedgerEntry`,** exactly as stock is a projection of
movements (BI-02 shape). A stored mutable balance on an AR account is a field that will disagree with its own
ledger, and a customer statement built from it is a statement that is sometimes wrong.

**Rule CU-12.** The account carries a **`CreditLimit` and a `Balance`**, and the available credit is
`CreditLimit − Balance`, derived. `Balance` is a projection cache and must rebuild exactly (the IV-09 rule
applied to receivables).

**Rule CU-13 — an account belongs to a store in v1** (organization-model §8.2 semantics: a customer is global, a
*facility* is local). Cross-store credit consolidation is a Phase 3+ feature with a real risk question — which
store bears the bad debt — and it is not modelled as a v1 workflow.

### 4.2 The credit check

**Rule CU-14 — the check is at the boundary, inside the completion transaction, against the resulting balance**
(BI-36 shape). It is not "check then sell".

**Rule CU-15 — what the check does:**

| Situation | Behaviour |
|---|---|
| Within limit | Sale completes on account |
| Exceeds limit, within an over-limit tolerance | Sale completes, flagged, and a notification fires |
| Exceeds limit beyond tolerance | Refused, naming the balance, the limit, and the amount of the sale |
| Customer `CreditBlocked` | Refused for account transactions; paid transactions unaffected |

**Rule CU-16 — an over-limit sale is approvalable.** `Customer.Credit.Approve` by a different employee (BI-26)
permits one transaction above the limit, with a reason. The limit itself is unchanged; this is a decision about a
transaction, not a policy change.

**Rule CU-17 — the limit may never be changed to below the current balance** without `Customer.Credit.Approve`
and a reason (BI-25). Lowering a limit to hide an overdue balance is a real abuse, and this is the specific check
that catches it.

**Rule CU-18 — a credit limit change is prospective and effective-dated.** It does not retroactively re-evaluate
sales already made.

**Rule CU-19 — the limit is per store, per customer, and per currency.** Because the field exists on the account
(overview §3.1), a multi-currency customer's limit is denominated in the account's currency. Conversion is out of
scope (§31).

### 4.3 The ledger

`CustomerLedgerEntry` types:

| Type | Effect on balance | Created by |
|---|---|---|
| `Charge` | **Increases** the balance owed | A credit sale at the till |
| `Payment` | **Decreases** the balance | `Customer.Payment.Record` |
| `CreditNote` | **Decreases** the balance | A return, a price correction |
| `Reversal` | Opposite of the referenced entry | A correction (BI-15 shape) |
| `WriteOff` | Decreases to zero, as bad debt | `Customer.Credit.Approve` + reason |
| `LimitChange` | **No balance effect** | Records the policy change on the account's own history |
| `Adjustment` | Either | `Customer.Credit.Approve` + reason, always flagged |

**Rule CU-20 — a credit sale creates a `Charge`, and a zero-value payment record** (overview §3.5, SP-41). The
AR document carries the sale's `TotalDue`.

**Rule CU-21 — a customer's payment is bounded by the outstanding balance**, checked atomically like BI-06, and
an overpayment is either refused or held as an unapplied credit — reported, because an unapplied-credit balance on
a customer account is where a mis-keyed amount hides.

**Rule CU-22 — a write-off reduces the balance to zero and is a separate, reasoned, approvaled event.** It does
not delete entries, and it is reported by actor, value, and reason with concentration analysis (IV-36 shape). Bad
debt is a real cost that must be visible.

**Rule CU-23 — the customer statement is reproducible from the ledger** (BI-11), shows a running balance that
reconciles, shows the limit and the available credit, and is renderable for a past period as it stood then.

---

## 5. Loyalty

### 5.1 Structure

`LoyaltyAccount` holds customer, points balance (**a projection** of `LoyaltyTransaction`), enrolment date, tier
field (reserved), and status. `LoyaltyTransaction` holds type (`Earn`, `Redeem`, `Adjust`, `Expire`, `Reverse`),
points (positive or negative, per the type's semantics), the causing document or sale line, the actor, the
timestamp, and a reason where required.

**Rule CU-24 — a point is never a currency amount in storage.** Points and their monetary redemption value are
separate concerns, and a configuration error must not corrupt a balance. `RedemptionValuePerPoint` is a
configuration value with an effective date, so a change is prospective and reported (BI-11, BI-18 shape).

**Rule CU-25 — an accrual basis is configured** (RR-41): gross line total, net of discount, or net of tax. The
**decided v1 basis (D-11) is net item subtotal after discount, excluding tax**, because accruing on tax means
earning points for a tax the retailer does not keep. All three bases remain configurable values, and changing the
configured value needs no schema change.

**Rule CU-26 — points are awarded on the line, in the completion transaction** (BI-04). A sale and its points are
one event, or they are two events that can disagree.

**Rule CU-27 — points are reversed on a returned line**, bounded by what was earned and not already spent
(RR-38).

**Rule CU-28 — a manual points adjustment requires `Customer.Loyalty.Adjust` and a reason** (BI-25), is
reported, and is held in the segregation-of-duties watch list (SEP-05) because points mint value.

**Rule CU-29 — points may not go negative** through a reversal (BI-19). A reversal larger than the balance produces
a negative points balance only with `Customer.Loyalty.Adjust` and a reason, and it is reported — hiding it would
make a customer's balance disagree with their statement.

**Rule CU-30 — loyalty is not authorisation, and a loyalty identifier is not an identity proof.** Looking up
points on a phone number is a service convenience; it is not authentication, and a points balance must never be
disclosed to whoever presents a number. The cashier sees the balance; the person holding the phone is assumed to
be the customer, which is a service assumption, not a security control, and the design does not pretend otherwise.

### 5.2 Boundaries

**Rule CU-31 — no tiers, campaigns, referrals, or expiry campaigns in v1** (overview §6). A `Tier` field exists
and is unused; the reporting dimensions that would need it do not exist. **[P0 note: the surveyed systems that
lost their permission and identity data were the ones that had grown this layer without an access model.]**

**Rule CU-32 — no customer portal in v1** (overview §6). What a customer is told, and what is printed for them,
is a defined document set (CU-14, actors-and-roles §3.15).

---

## 6. Privacy and data handling

**Rule CU-33 — PII is a named, minimal field set**: name, contact points, address, tax identifier where the
jurisdiction requires it, and the marketing-consent flag. Everything else about a customer is business data, not
personal data.

**Rule CU-34 — marketing consent is a stored, timestamped, sourced flag**, defaulting to `NotAsked`. Absence of
consent never blocks a sale: a customer who declines marketing still shops.

**Rule CU-35 — no PII in logs** ([P0: A-21]). Log lines carry ids. A cart's contents are not logged as
text. This is the single most-copied Phase 0 finding and it is a one-line design rule that is expensive to retrofit.

**Rule CU-36 — export of customer data requires `Customer.DataExport`**, is itself audited with a row count
(PR-55, actors-and-roles §2.6), and is a privacy action, not a reporting action.

**Rule CU-37 — masking is applied by role at the response, not by the client.** A masked phone is masked in the
API response. A client that receives the full value and hides it with CSS has not protected anything.

**Rule CU-38 — retention is configurable per organization, and retention action is a documented, audited,
privileged operation** — the same control as audit-entry retention (BI-24, AU-14). Deleting a customer for
retention reasons is `Closed`, not a delete (CU-10).

---

## 7. Customer-facing documents

**Rule CU-39 — the customer document set is defined, not incidental** (CU-32):

| Document | Produced by | Contains |
|---|---|---|
| Receipt | Till | SP-59, SP-60 |
| Tax invoice | Till, where required | The same content plus tax-identity detail per jurisdiction |
| Credit statement | Accountant, on request or on a period | The ledger, running balance, limit, available credit (CU-23) |
| Loyalty notice | Till, on request | Current balance and the redemption value in force |
| Return receipt | Till | The return lines, dispositions, and the refund method |

**Rule CU-40.** No customer-facing document contains internal cost, margin, another customer's data, or any
employee's personal data (SP-60, actors-and-roles §3.15).

---

## 8. Customer rules index

| ID | Rule |
|---|---|
| CU-01 | A walk-in is a customer record; `Sale.CustomerId` is never null |
| CU-02 | Walk-in history is re-attributed by an audited, reason-bearing merge |
| CU-03 | Merging two real customers needs `Customer.Credit.Approve` and a reason |
| CU-04 | Phone, email, member number, tax id, external ref — each unique when present |
| CU-05 | A duplicate key warns and records the choice; it does not silently duplicate |
| CU-06 | Search is organization-wide, prefix-based |
| CU-07 | Cashier-visible fields are narrow, and the API does not return the rest |
| CU-08 | Customer reporting is store-scoped; organization-wide needs `Report.OrganizationWide` |
| CU-09 | `OnHold` warns and notifies; it does not refuse service |
| CU-10 | `Closed`, never deleted |
| CU-11 | The AR balance is a projection of `CustomerLedgerEntry`, never a stored mutable total |
| CU-12 | Available credit is `CreditLimit − Balance`, derived |
| CU-13 | The account is store-owned in v1; cross-store credit is not a v1 workflow |
| CU-14 | The credit check is in-transaction against the resulting balance |
| CU-15 | Within limit, over tolerance, over tolerance, or `CreditBlocked` — each has defined behaviour |
| CU-16 | An over-limit sale is approvalable per transaction, with a reason |
| CU-17 | A limit may not be lowered below the current balance without approval and a reason |
| CU-18 | A limit change is prospective and effective-dated |
| CU-19 | The limit is per store, per customer, in the account's currency |
| CU-20 | A credit sale is a `Charge` plus a zero-value payment record |
| CU-21 | A payment is bounded by the balance; an overpayment is a reported unapplied credit |
| CU-22 | A write-off is a reasoned, approvaled event that leaves the entries intact |
| CU-23 | The statement is reproducible from the ledger and shows the limit |
| CU-24 | Points are not stored as money; the redemption value is effective-dated |
| CU-25 | The accrual basis is configured; decided v1 basis is net of discount, excluding tax (D-11) |
| CU-26 | Points are awarded in the completion transaction |
| CU-27 | Points reverse on a returned line, bounded |
| CU-28 | A manual points adjustment needs permission, a reason, and is reported |
| CU-29 | Points may not go negative without approval and are reported |
| CU-30 | Loyalty lookup is a service assumption, not authentication |
| CU-31 | No tiers, campaigns, or referrals in v1 |
| CU-32 | No customer portal in v1; the document set is defined |
| CU-33 | PII is a named, minimal field set |
| CU-34 | Marketing consent is a stored, timestamped, sourced flag and never blocks a sale |
| CU-35 | No PII in logs |
| CU-36 | Customer data export needs `Customer.DataExport` and is audited |
| CU-37 | Masking is applied server-side at the response |
| CU-38 | Retention is configurable; enforcement is privileged and audited |
| CU-39 | The customer document set is defined: receipt, invoice, statement, loyalty notice, return receipt |
| CU-40 | No customer document carries cost, margin, or third-party data |
