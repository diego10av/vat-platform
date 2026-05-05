# eCDF XSD reconciliation — pending blocker

The eCDF XML produced by `src/lib/ecdf-xml.ts` is **not yet validated
against the AED's currently-published XSD schemas**. Until it is,
the OutputsPanel banner warns the reviewer that the downloaded XML
is "for inspection only" and should not be uploaded to MyGuichet
without a manual XSD validation pass first.

This document tracks the five flagged items, how they map into
configurable constants in `src/config/ecdf-xsd-config.ts`, and the
unblock procedure once we obtain the XSD.

---

## Why we don't have the XSD yet

The AED publishes XSDs through the eCDF developer portal at
`https://ecdf.b2g.etat.lu` under the "Informations générales →
Développeurs d'interfaces" menu. The portal requires:

  1. CIGUE registration (https://saturn.etat.lu/gu-societe/) for the
     legal entity that will issue the platform.
  2. A signed developer agreement on letterhead.
  3. LuxTrust signature on the request form.
  4. AED approval (≈ 5 business days).

Once approved, the developer space exposes XSDs for the seven
forms cifra cares about (TVA001N, TVA002NA, TVA002NT, TVA002NM,
SCT_TVA, FAIA + the ECSL state RC).

cifra hasn't completed registration yet because the firm
(cifra SARL-S — domain `cifracompliance.com`) is being constituted.
After incorporation Diego files the developer-space request and
this blocker resolves.

---

## The five items + where to update them

Each lives as a constant in `src/config/ecdf-xsd-config.ts`. The
`*_VERIFIED` flag is `false` everywhere today; flipping it to `true`
after a successful XSD pull is the explicit unblock signal.

### 1. XML namespace

```ts
export const ECDF_NAMESPACE = 'http://www.ctie.etat.lu/2011/ecdf';
export const ECDF_NAMESPACE_VERIFIED = false;
```

The 2011 namespace was the first-generation URL. Two likely
successors based on the AED's quick-fixes / ViDA cycles:
- `http://www.ctie.etat.lu/2020/ecdf`
- `http://www.ctie.etat.lu/2024/ecdf`

**To verify**: the XSD's `targetNamespace` attribute on its root
`<xs:schema>` element. Update the constant + flip the flag.

### 2. FormVersion

```ts
export const ECDF_FORM_VERSIONS: Record<string, string> = {
  // 'TVA002NA_2025': '2.0',
  // 'TVA002NT_2025': '2.0',
  // ...
};
export const ECDF_FORM_VERSION_FALLBACK = '1.0';
```

Each AED form carries a version stamped in the form PDF footer +
the XSD's `<xs:attribute name="version">` enumeration. The fallback
ships `"1.0"` (which all current 2011-namespace XSDs accepted).

**To verify**: download each form's XSD, pull the `version`
attribute enum, populate `ECDF_FORM_VERSIONS` with one entry per
(formCode, year), flip `ECDF_FORM_VERSIONS_VERIFIED`.

### 3. Box element shape

```ts
export const BOX_FIELD_ELEMENT_NAME = 'NumericField';
export const BOX_FIELD_INCLUDE_SECTION = true;
export const BOX_FIELD_VERIFIED = false;
```

Today emits `<NumericField id="012" section="A">123.45</NumericField>`.
AED schemas typically use `<Numeric>` or `<Value>` without a
section attribute (sectioning is by structure not metadata).

**To verify**: the `<xs:complexType>` for box-list elements in the
XSD. Update `BOX_FIELD_ELEMENT_NAME` + flip `BOX_FIELD_INCLUDE_SECTION`
if the section attribute isn't part of the schema.

### 4. Period encoding

```ts
export function encodePeriodForXSD(period: string): string {
  // Q1 = 13, …, Q4 = 16, monthly = 1..12, annual = 0
}
export const PERIOD_ENCODING_VERIFIED = false;
```

The platform currently emits `"2025-Q1"` strings; AED schemas
typically use integer codes (0 annual, 1..12 monthly, 13..16
quarterly). The new encoder is in place; flip `PERIOD_ENCODING_VERIFIED`
to switch the builder over to it.

**To verify**: the `<xs:simpleType>` of the `<Period>` element.

### 5. Sender/Agent block

```ts
export const SENDER_AGENT_REQUIRED = false;
export const PLATFORM_AGENT_INFO: AgentInfo | null = null;
```

When `SenderType="tax_professional"` AED XSDs require an `<Agent>`
sub-element with the firm's matricule + name. cifra is the agent;
the platform doesn't yet collect its own matricule.

**To verify**: the XSD's `<Sender>` content model. To unblock:
1. Add a Settings field for the firm's AED matricule + display name.
2. Populate `PLATFORM_AGENT_INFO` from that settings record.
3. Flip `SENDER_AGENT_REQUIRED`.

---

## Reviewer-facing safety net (in the meantime)

Until all five `*_VERIFIED` flags flip to `true`, OutputsPanel shows
a yellow banner above every download labelling the XML as "for
inspection only" and pointing at this doc + `src/lib/ecdf-xml.ts`
header for the open list. PROTOCOLS §2 prohibits filing real
declarations on the platform until the banner is gone.

If a real declaration must be filed before reconciliation:
1. Generate the XML.
2. Validate manually against the official XSD via the AED's
   developer-space upload form.
3. If accepted by MyGuichet preview, upload there.
4. If rejected, capture the validator's complaint and update the
   matching constant in `src/config/ecdf-xsd-config.ts`.
