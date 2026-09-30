# License Matrix

> **This is a technical reading of license texts, not legal advice.** Every classification marked
> **LEGAL REVIEW REQUIRED** must be confirmed by counsel before any code is reused, copied, or derived from.
> No conclusion here should be treated as a legal opinion.

> **Verification note — OSPOS's licence was re-checked, and the first draft of this analysis was wrong about
> it.** Other documents in this set claimed that OSPOS has no `LICENSE` file, that the clause hides in
> `app/Config/Constants.php` "where scanners cannot see it", and that it narrows the copyright grant. **All
> three were false, and the correction runs against our own prior direction of travel.** Direct inspection of
> `research/ospos/LICENSE` confirms: the file **exists**, the copyright terms are **verbatim, unmodified MIT**
> (Commercial use and Modification are granted in the normal MIT text), and the only non-standard element is a
> **5-line appended clause requiring the footer branding to stay visible and unmodified**. The
> `package.json` / `composer.json` declaration of `"MIT"` is therefore *accurate as to the copyright grant* and
> incomplete only as to the branding condition.
>
> **The practical effect is that L-01 is a much smaller problem than recorded.** The reuse question is
> effectively settled — the copyright terms are standard MIT and compatible with MIT/Apache/proprietary use.
> What remains open is a single branding question: may a derivative remove or relocate the visible footer
> line? That is a trademark/branding question, not a copyright one, and it should be put to upstream as one
> narrow question rather than as "is this license compatible?".

## Summary

| Repository | License | Commercial use | Modification | Source disclosure | Copyleft | Classification |
|---|---|---|---|---|---|---|
| **OSPOS** | **Standard MIT** + appended nonstandard clause | **Permitted** | **Permitted** | None | None (project code) | **LEGAL REVIEW REQUIRED** — narrow: branding line only |
| **NodeDR** | AGPL-3.0-only | Permitted | Permitted | **Yes — on network use** | **Strong, incl. network** | **LEGAL REVIEW REQUIRED** |
| **YourGbDev** | **NONE** | **No** | **No** | n/a | n/a | **DO NOT USE** |
| **RetailPOS** | **NONE** (README claims MIT) | **No** | **No** | n/a | n/a | **DO NOT USE** |
| **RFID Ref** | **NONE** ("all rights reserved") | **No** | **No** | n/a | n/a | **REFERENCE ONLY** |

**No repository is classified SAFE TO CONSIDER.** Three have no license at all. The two that are licensed
carry obligations that require counsel sign-off before reuse.

---

## 1. OSPOS — MIT with an appended clause

### Exact license

`LICENSE` is 55 lines: the **verbatim MIT License (lines 1–46)** plus a **5-line custom clause (lines 48–55)**.

```
Additionally, you cannot claim copyright or ownership of the Software.

The footer signatures with version, hash and URL link to the official website
of the project MUST BE RETAINED, MUST BE VISIBLE IN EVERY PAGE and CANNOT BE
MODIFIED.
Footer signatures are in the format
"© 2010 - current year · opensourcepos.org · version - commit"
or "Open Source Point of Sale".
```

### Obligations

| Question | Answer |
|---|---|
| Commercial use permitted | **Yes** by the text of the grant (`LICENSE:33` includes "sell") |
| Modification rights | **Yes** (`LICENSE:33` includes "modify, merge") |
| Redistribution requirements | Retain copyright + permission notice; **keep the OSPOS footer visible and unmodified on every page**; ship the LICENSE file (the app refuses to run without it) |
| Attribution requirements | MIT notice in copies, **plus** a runtime footer on every page |
| Source disclosure | **None** |
| Copyleft obligations | **None** in the project's own code |
| Network copyleft | **None** |
| Trademark | **LEGAL REVIEW REQUIRED** — no trademark policy exists. MIT grants no trademark rights; the footer clause *requires* using the "Open Source Point of Sale" name and linking opensourcepos.org, but the license is silent on whether a derivative or commercial product may do so. `branding/STYLE_GUIDE.md` defines brand assets and grants no usage rights. |

### The defect that matters most

`composer.json:4` declares `"license": "MIT"`. It does **not** mention the appended clause. Consequence:
**any automated scanner — including GitHub's own repo classifier, SBOM tools, and most dependency
management tools — will report plain "MIT" and miss the footer condition entirely.** Anyone consuming this
as a dependency via `composer require` never sees the addition.

**LEGAL REVIEW REQUIRED** on one specific point: whether "MUST BE VISIBLE IN EVERY PAGE AND CANNOT BE
MODIFIED" operates as a *condition* on the permission grant (so unmet = no license) or as a *covenant*
(remediable breach). This determines whether a SmartStore deployment that removes the OSPOS footer has
licensed OSPOS code at all. `README.md:136` signals the maintainers intend enforcement.

### Transitive obligations the "MIT" label hides

The installed `composer.lock` pulls in **LGPL** packages that the MIT declaration does not mention:

| Package | License |
|---|---|
| `dompdf/dompdf` | LGPL-2.1 |
| `dompdf/php-font-lib` | LGPL-2.1-or-later |
| `dompdf/php-svg-lib` | LGPL-3.0-or-later |
| `ezyang/htmlpurifier` | LGPL-2.1-or-later |
| `picqer/php-barcode-generator` | LGPL-3.0-or-later |

LGPL §6 obligations (provide library source or an offer, allow relinking, do not modify the library) are
largely satisfiable by dynamic linking without relicensing the application — but there is **no compliance
statement, no `NOTICE`, and no source-offer mechanism anywhere in the repository**.

Separately, `public/fonts/` ships **proprietary and unattributed binaries** — `Arial.ttf`/`Arial.woff`
(Monotype/Microsoft, proprietary), `b-de-bonita-shadow.ttf` (origin unverifiable), `SansationLight.ttf` and
Font Awesome webfonts — with **no license text bundled and no entry in the in-app license screen**
(`app/Controllers/Config.php:77-206` enumerates only the root LICENSE, `*.version`/`*.license` pairs,
`composer.LICENSES`, and npm reports). **LEGAL REVIEW REQUIRED.**

### Classification

**LEGAL REVIEW REQUIRED.** The cleanest license of the five, but the clause is nonstandard, the machine-
readable declaration contradicts the file, LGPL transitives are unaddressed, proprietary font binaries ship
unattributed, and the trademark position is unstated.

---

## 2. NodeDR — AGPL-3.0-only

### Exact license

`LICENSE` is the **GNU Affero General Public License v3**. `backend/package.json` and
`frontend/package.json` both declare `"license": "AGPL-3.0-only"`. `packaging/debian/copyright:8` declares
`License: AGPL-3.0-only`. Four independent declarations agree — this is the most internally consistent
licensing of the five, and the maintainer clearly intends it.

`README.md:1081-1085` states the rationale explicitly: improvements to a self-hosted system must stay open.
`CONTRIBUTING.md:37-38` requires contributors to license contributions under AGPL-3.0.

### Obligations

| Question | Answer |
|---|---|
| Commercial use permitted | **Yes** — AGPL imposes no commercial-use restriction |
| Modification rights | **Yes** |
| Redistribution requirements | Complete corresponding source; preserve notices; state changes |
| Attribution requirements | Preserve copyright + license notices; add notices for modifications |
| **Source disclosure** | **YES — this is the AGPL's distinguishing feature (§13)** |
| **Network copyleft** | **YES (§13)** — users interacting with the software **over a network** are entitled to the corresponding source of the running version |
| Copyleft obligations | **Strong.** Any derivative work must be AGPL-3.0. Permissive code linked into it is infected. |
| Trademark | No separate trademark policy. "NodeDR" is not licensed as a mark. |

### Consequences for SmartStore — this is the decisive legal finding

If SmartStore is a **hosted, network-accessible service** (SaaS, cloud-hosted multi-store platform), and
any AGPL-3.0 code from NodeDR is used — even unmodified, even merely linked — then:

- SmartStore's **entire corresponding source must be published under AGPL-3.0** to every user who interacts
  with it over the network (§13), and
- SmartStore as a whole becomes AGPL-3.0, which forecloses proprietary/closed licensing of SmartStore.

This is not a "contribution" obligation; it attaches to *use over a network*. A permissive-licensed component
combined with AGPL code **is** AGPL for the combined work — this is the one compatibility conclusion that
*is* unambiguous, and it is unambiguous in the direction of restriction.

**LEGAL REVIEW REQUIRED** on:
- Whether SmartStore is intended to be network-hosted (this single fact decides the question).
- Whether any node-level separation (separate process communicating over a documented API) would avoid
  derivative-work status. This is contested in the courts and **must not be assumed**.
- Whether SmartStore's intended license is compatible with AGPL-3.0 at all. If SmartStore is to be
  proprietary or MIT/Apache-2.0, **NodeDR code cannot be used.**

### Classification

**LEGAL REVIEW REQUIRED.** Usable only if SmartStore is itself AGPL-3.0 and open source, and only after
counsel confirms §13 scope. Given the project is described as a commercial retail platform, the practical
answer is almost certainly **no**.

---

## 3. YourGbDev POS — NO LICENSE

### Finding

**No license exists, and never has.** Verified four ways:

1. Filesystem scan for `LICENSE*`, `LICENCE*`, `COPYING*`, `NOTICE*` → **zero matches**.
2. `git log --all --diff-filter=A --name-only` filtered for license files → **no license file in any commit**.
3. `git grep -i "SPDX|Permission is hereby granted"` across tracked files → **zero matches**.
4. `frontend/package.json` → `"private": true`, **no `license` field**. There is no `composer.json` at all.

### Legal status

Under default copyright law, **absence of a license means all rights reserved.** Copyright vests in the
author automatically on creation; only an explicit grant licenses anyone else. Nobody may lawfully copy,
modify, merge, sublicense, or redistribute this code — including a client the author built it for. Viewing
on GitHub under the GitHub ToS is permitted; reuse is not.

`"private": true` **suppresses** npm's "UNLICENSED" warning. That masks the problem; it does not solve it.

### Classification

**DO NOT USE.** Not usable as a foundation, not usable as a reference, not usable as a donor of patterns. The
code is technically the second-most competent of the five (see [repository-yourgbdev-pos.md](repository-yourgbdev-pos.md)),
which makes this a live trap: it is the project a reviewer is most likely to reach for and least able to use.

---

## 4. RetailPOS — NO LICENSE (README claims MIT)

### Finding

**No LICENSE file exists.** The only filename match in 644 tracked files is
`inventory-management-system-app/public/assets/images/browsers/license/license.html` — a **Flaticon redirect
stub**, not a license.

`README.md:67-68` claims:
> "This project is open-source and available under the [MIT License](LICENSE)."

**That link is dead.** `inventory-management-system-api/composer.json:6` does contain `"license": "MIT"`,
but that file is the **verbatim stock `laravel/laravel` skeleton** — still named `laravel/laravel`, still
described as "The Laravel Framework." It licenses the framework, not the authored controllers. A boilerplate
manifest field is not a license grant for the work added on top of it.

The API's own `README.md` is likewise the untouched stock Laravel README.

### Aggravating: an unlicensed vendored commercial template

`inventory-management-system-app/public/assets/` is **39.4 MB / 301 files** and is a vendored copy of the
**Matx React admin template by ui-lib**, sold commercially. Identification is unambiguous: 40+ `Matx*`
components (`MatxLayout`, `MatxTheme`, `MatxSidenav`, …), and `src/app/navigations.js:212-217` still ships
the vendor's own demo link `http://demos.ui-lib.com/matx-react-doc/`.

There is **no license file, no attribution file, and no third-party notices file** for that tree. 280 of
the 301 files (38.6 MB) are referenced by nothing in the application — pure redistributable surface area
carrying zero value. The author had no recorded right to sublicense them and cannot have granted MIT over
assets they do not own.

The login screen additionally ships the vendor's demo credentials as hardcoded default state
(`src/app/sessions/login/JwtLogin.jsx:35-38`: `jason@ui-lib.com` / `dummyPass`).

### Classification

**DO NOT USE.** No license for the project; unlicensed vendored commercial assets inside it; and the code
itself has fatal defects in nearly every write path (see [repository-retail-inventory-pos.md](repository-retail-inventory-pos.md)).
The README's MIT claim is unenforceable without the file and contradicted by the vendored tree.

---

## 5. RFID Reference — NO LICENSE ("all rights reserved")

### Finding

**No LICENSE file.** Four independent searches, all negative: filename scan (case-insensitive, recursive,
including `.git`); `git grep` for `licen[cs]e|SPDX|copyright|all rights reserved|MIT|Apache|GPL` across all
tracked text; `backend.csproj` and `package.json` for any `PackageLicenseExpression` or `license` field.
The only hits are the two notices below.

`README.md:255` states: **"Private project — all rights reserved."**
`frontend/src/pages/Login.jsx:94` renders `© {year} Wayin Fotech Solutions. All rights reserved.`

Top-level tree is exactly `.git/`, `.gitignore`, `README.md`, `backend/`, `bucket_rfid_1.sln`, `frontend/`.

### Legal status

A copyright notice is a **statement of reserved rights, not a grant of any**. It authorizes nothing. Under
default copyright law this code is not open source by any definition — it is **source-available at most**,
and even that is generous given no explicit permission to use is granted anywhere.

The git remote is public (`https://github.com/Pushpendera5/bucket-rfid-store`). Under the GitHub ToS,
public viewing and forking are permitted; **reuse is not**. A 39 MB proprietary RFID/retail ERP is publicly
readable with no license file — an unusual posture that a licence scanner will correctly flag as
non-redistributable.

**LEGAL REVIEW REQUIRED** if any part of this is to be used, which requires obtaining an explicit written
license from Wayin Fotech Solutions / the author. There is also a third-party element: `backend.csproj`
references `Public.SDK.RFID.LLRP.Std` v1.0.2018.24070, a Zebra/vendor SDK whose own license was not audited
and which may itself restrict use.

### Classification

**REFERENCE ONLY.** The LLRP protocol implementation is the single most valuable piece of prior art found in
this phase (835 lines of genuine EPCglobal LLRP v1.0.1: TLV framing, ROSpec building, tag-report parsing).
It can be **read** as a reference to inform a clean-room reimplementation. **No code may be copied, adapted,
or derived from it.**

---

## Compatibility with the intended SmartStore license

**The intended SmartStore license was not specified in the brief.** This section states the outcome for each
plausible choice, because the answer changes materially.

| SmartStore license | OSPOS | NodeDR | YourGbDev | RetailPOS | RFID Ref |
|---|---|---|---|---|---|
| **Proprietary / closed** | Reference only — cannot ship OSPOS code (footer clause + LGPL transitives) | **Unusable** (AGPL §13) | Unusable | Unusable | Unusable |
| **MIT / Apache-2.0** | **LEGAL REVIEW REQUIRED** — permissive-compatible in principle, but the footer clause is a condition attached to a permissive license and must be cleared | **Unusable** (copyleft in, copyleft out — cannot relicense a derivative to MIT) | Unusable | Unusable | Unusable |
| **AGPL-3.0** | Compatible (permissive ⊂ copyleft) | Compatible | Unusable | Unusable | Unusable |
| **GPL-3.0** | Compatible | **LEGAL REVIEW REQUIRED** — AGPL-3.0 and GPL-3.0 are one-way compatible: AGPL code can be *combined into* a GPL-3.0 work, but GPL-3.0 code cannot flow into an AGPL work. Direction matters. | Unusable | Unusable | Unusable |

**The compatibility direction is not symmetric, and assuming it is is the single most common error in this
kind of analysis.** Permissive code can be incorporated into a copyleft work. Copyleft code cannot be
incorporated into a permissive work without relicensing the whole result.

**Practical consequence:** if SmartStore is to be a proprietary or MIT/Apache-licensed commercial platform —
which is the natural reading of "production-grade integrated retail management platform" — then **no
candidate repository may contribute code at all.** All five become reference material. That is the
conclusion this analysis reaches, and it should be confirmed with counsel before Phase 1.

## Open licensing questions for counsel

1. Is SmartStore intended to be proprietary, permissively licensed, or AGPL-3.0? This single answer
   determines whether *any* code reuse is possible.
2. Is the OSPOS footer clause enforceable as a license condition, or as a covenant? Does a derivative
   product displaying an OSPOS-derived UI satisfy it, and does removing the footer extinguish the license?
3. Does OSPOS's use of LGPL-2.1/3.0 transitives impose any obligation on a SmartStore distribution?
4. Are the OSPOS font binaries a licensing exposure that would follow a fork?
5. Can written permission be obtained from YourGbDev, heckur08, and Pushpendera5 / Wayin Fotech Solutions?
   *(Note: even with permission, RetailPOS's quality profile and the ui-lib template exposure would still
   make it unusable.)*
6. Is the ui-lib Matx template license in `retail-inventory-pos` redistributable at all?
