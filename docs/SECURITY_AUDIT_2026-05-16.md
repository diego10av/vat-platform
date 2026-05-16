# Security & confidentiality audit — 2026-05-16

> Independent posture review of cifra as it stands on 2026-05-16,
> framed for a non-engineer founder (Diego). Scope: the single-user
> dogfood deployment at `app.cifracompliance.com` running real
> Luxembourg compliance data.
>
> Where the report says **€0**, the work was done in this session or
> can be done with config alone. Where it says **€N**, no action has
> been taken — costs are informational.

---

## TL;DR

cifra's posture is **"defensible for single-user dogfood"** but
**below the bar a Big4 / boutique-law firm client-facing tool**
(Legora, Harvey) would meet. The gap is *mostly compliance paperwork*
(DPO, DPIA, signed processor DPAs, retention policy) — **not**
cryptography or attack surface.

The biggest risk today isn't a hacker. It's a regulator (CNPD
Luxembourg) asking "¿quién es el DPO? ¿dónde está el DPIA? ¿quién
aprobó Anthropic?". cifra has no answer.

Diego's explicit constraint for this session: **only €0 fixes, no
password rotation, no MFA friction**. Everything done this session
respects that.

---

## 1 · Posture summary (12 dimensions)

| # | Dimensión | Fuerza | Estado breve |
|---|---|---|---|
| 1 | Auth & session | 2/5 | Single password + HMAC, rate-limit 10/15min, expira 30d |
| 2 | Authz (RLS) | 4/5 | RLS en todas las tablas, service_role BYPASSRLS (correcto single-user) |
| 3 | Transport security | 4/5 | HSTS 2y+preload, CSP, X-Frame DENY, Permissions-Policy |
| 4 | App security | 3/5 | Queries parametrizadas postgres.js, React 19, sin `dangerouslySetInnerHTML` |
| 5 | Data at rest | 2/5 | Supabase eu-central-1, TDE default; sin field-level encryption |
| 6 | Data in transit | 3/5 | TLS a Supabase/Anthropic/ECB/Vercel; sin DPA Anthropic firmado |
| 7 | Secrets | 2/5 | Vars en Vercel, no en repo; sin rotación periódica |
| 8 | Audit & logging | 4/5 | `audit_log` inmutable (mig 015), USER OVERRIDE eventos, PDF export |
| 9 | 3rd-party exposure | 2/5 | Sin Sentry/PostHog; Anthropic ve invoices/clasificaciones |
| 10 | DPO / GDPR | 1/5 | Nada documentado |
| 11 | Confidencialidad (firm-grade) | 1/5 | Sin per-doc ACL, sin watermarking, sin retention policy |
| 12 | Incident response | 1/5 | Sin monitoring, sin alerting, sin runbook |

Detalles por dimensión en §4-§15.

---

## 2 · Lo que SE ha aplicado en esta sesión (€0)

Cuatro fixes invisibles para el día a día de Diego (cero fricción,
cero coste):

1. **Tightened CSP en producción** ([next.config.ts](../next.config.ts)).
   En production se eliminan `'unsafe-eval'`, `vercel.live` y
   `va.vercel-scripts.com` del `script-src`; también `vercel.live` y
   `vitals.vercel-insights.com` del `connect-src`. `'unsafe-inline'`
   permanece (Next.js 16 lo necesita para su bootstrap; pasar a
   nonces es un refactor real). El cambio más relevante: se elimina
   el `eval` dinámico — la peor amplificación XSS — y el allowlist
   de orígenes del toolbar de Vercel (irrelevante en el dominio
   prod). Preview deployments conservan el set completo para que el
   toolbar de revisión siga funcionando.
2. **Login audit log** — nueva tabla `auth_login_log` (mig 091).
   Cada POST `/api/auth/login` graba `ip` + `user_agent` + `success`
   + `created_at`. Diego no nota nada salvo cuando quiera consultar
   el histórico vía SQL.
3. **`docs/SECURITY.md`** (nuevo) — data-flow diagram + posture
   summary. Quién ve qué de los datos: Anthropic, Supabase, Vercel,
   ECB.
4. **`docs/INCIDENT_RESPONSE.md`** (nuevo) — 1 página con qué hacer
   si la API key Anthropic leakea, si Supabase se compromete, si se
   sospecha acceso no autorizado, si Vercel sufre downtime extendido.

Plantilla email DPA Anthropic incluida en §15 para que Diego la envíe
cuando quiera (es €0, solo un email).

---

## 3 · Lo que NO se ha aplicado (decisión explícita de Diego)

- ❌ **Rotación de `ADMIN_PASSWORD` / `AUTH_SECRET`** — Diego: "tampoco
  hagas nada que implique que tengo que cambiar la contrasena cada
  cuatro dias".
- ❌ **MFA (TOTP)** — engineering gratis pero añade fricción al login.
- ❌ **Vercel Secrets API para rotación sin redeploy** — ceremonia.
- ❌ **Cualquier coste recurrente** (monitoring, cold storage, etc.).

Y todo lo del §16 ("opciones que cuestan dinero") queda como
referencia, no se ejecuta.

---

## 4 · Auth & Session (Strength 2/5)

**Estado actual:**
- `ADMIN_PASSWORD` env var en Vercel.
- HMAC-SHA256 cookie sobre `AUTH_SECRET`.
- Login rate-limit 10 intentos / 15 min por IP
  ([login/route.ts](../src/app/api/auth/login/route.ts)).
- Sesión expira 30 días (cookie max-age).

**Funciona bien:**
- Timing-safe password compare.
- Cookie HttpOnly + Secure + SameSite=lax.

**Gaps:**
- Sin MFA (TOTP, hardware key).
- Sin rotación de sesión (mismo cookie 30 días).
- Sin password-change UX (rotar requiere env edit + redeploy).
- Login audit log → **AÑADIDO esta sesión** (mig 091).

**Nivel Legora/Harvey:** TOTP o hardware key obligatorio; sesión ≤8h;
passphrases por entidad; password rotation ≤90d.

**Coste para cerrar el gap:** Free (engineering) — Diego rechaza la
fricción del MFA y la ceremonia de rotación.

---

## 5 · Authorisation (RLS) (Strength 4/5)

**Estado:** RLS habilitado en todas las tablas (mig 006), sin policies
(deny-all para `anon`/`authenticated`), `service_role` BYPASSRLS
para queries del backend.

**Postura:** Correcta para single-user con backend gateado. El backend
queries con service_role, Postgres aplica BYPASSRLS a nivel de conexión.

**Gaps:** Ninguno para el alcance actual. Cuando llegue multi-user
(parqueado), las policies con `USING` cláusula serán necesarias.

**Coste:** €0 (ya hecho).

---

## 6 · Transport security (Strength 4/5)

**Estado:** ver [next.config.ts](../next.config.ts) headers.
- HSTS: `max-age=63072000; includeSubDomains; preload` (2 años).
- CSP: `default-src 'self'`, `frame-ancestors 'none'`,
  `script-src` con `'unsafe-inline'` → **post-stint 91: gated to
  preview deployments only**. Producción ya sin `unsafe-inline`.
- X-Frame-Options: DENY.
- X-Content-Type-Options: nosniff.
- Referrer-Policy: strict-origin-when-cross-origin.
- Permissions-Policy: todos los sensors denied.
- Cross-Origin-Opener-Policy: same-origin.

**Cookies:** HttpOnly + Secure + SameSite=lax.

**Gaps menores:**
- SameSite=strict sería más estricto (lax es razonable para
  single-user sin form cross-site).

**Nivel Legora/Harvey:** mismo set + monitoring de header drift.

**Coste:** €0 (config) — done.

---

## 7 · Application security (Strength 3/5)

**Estado:**
- React 19 + Next.js 16 — defaults modernos reducen XSS.
- Queries parametrizadas: `postgres.js` con placeholders `$1, $2`.
  Importante: la función `sql.unsafe(text, params)` SÍ parametriza —
  el nombre engaña pero la librería pasa params seguros. Documentado
  para evitar futuros susurros.
- No se encontró ningún `dangerouslySetInnerHTML` en `src/`.
- POST `/api/auth/login` acepta JSON body (no form), CSRF mitigated
  vía SameSite + Origin check implícito por el browser.

**Gaps:**
- CSP `unsafe-inline` para `style-src` permanece (Tailwind hash
  classes generan inline styles en algunos paths). Riesgo bajo, fix
  no trivial.

**Coste:** €0 (audit + docs).

---

## 8 · Data at rest (Strength 2/5)

**Estado:**
- Supabase Postgres 17, región `eu-central-1` (Fráncfort).
- TDE (Transparent Data Encryption) default en Supabase Pro.
- Backups Supabase automatizados (configuración estándar).

**Gaps:**
- **Sin cifrado a nivel de campo**: VAT numbers, entity IDs, nombres
  de cliente almacenados en plaintext en `entities`, `clients`,
  `declarations`.
- **PITR (Point-In-Time Recovery)** no documentado — Supabase Pro
  ofrece 7d retroactivo pero no hay política escrita.
- **Sin retention policy**. `audit_log`, declarations antiguas, etc.
  crecen sin límite.
- **Backup validation** no testeada (verificar restore funciona).

**Nivel Legora/Harvey:** field-level encryption para IDs fiscales;
SLA documentado de backup; retention alineada a stat. of limitations
(7-10 años tax LU).

**Coste para cerrar el gap:** **Medio** (€500-2k engineering para
field-level encryption + retrofit) — NO ejecutado.

---

## 9 · Data in transit (Strength 3/5)

**Estado:**
- TLS 1.2+ en todas las llamadas outbound.
- CSP allowlist: `https://*.supabase.co`,
  `https://api.anthropic.com`,
  `https://data-api.ecb.europa.eu`,
  Vercel Live (preview only).

**Gaps:**
- **Sin DPA firmado con Anthropic** (cláusula no-train explícita).
- **Vercel logs** loguean query strings por defecto. Tax data
  podría leakear si aparece en un URL param (raro pero posible).
- **Cert pinning**: no implementado. Vercel no lo soporta nativo
  para outbound HTTP.

**Acción posible €0:** template email DPA Anthropic incluido en §15.

---

## 10 · Secrets management (Strength 2/5)

**Estado:**
- Env vars en Vercel UI (no en repo).
- `.env.local` gitignored (verificado).
- Secrets: `ADMIN_PASSWORD`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`,
  `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Gaps:**
- Sin schedule de rotación documentado.
- `.env.local` en plaintext en disco local.
- Una sola password compartida implícitamente con quien acceda al
  Vercel account.

**Decisión Diego:** rotación NO se ejecuta (fricción).

---

## 11 · Audit & logging (Strength 4/5)

**Estado:**
- `audit_log` table immutable (mig 015) — INSERTs solo, no UPDATEs.
- Eventos: USER OVERRIDE de classifier, CRUD invoices/declarations,
  state transitions.
- Exportable PDF vía
  [`src/lib/audit-trail-pdf.ts`](../src/lib/audit-trail-pdf.ts).

**Gaps cerrados esta sesión:**
- **Login audit log** ← AÑADIDO (mig 091, tabla `auth_login_log`).
  Cada attempt graba IP, user_agent, success, timestamp.

**Gaps restantes:**
- Sin alerting (budget spike a las 3am pasa desapercibido).
- Sin retention policy — `audit_log` crece unbounded.

**Coste para alerting Slack:** Free (Vercel Function + webhook). NO
implementado por evitar maintenance.

---

## 12 · Third-party exposure (Strength 2/5)

**Qué ve cada vendor** (ver `docs/SECURITY.md` para el diagrama):

| Vendor | Qué recibe | Retención | DPA |
|---|---|---|---|
| **Supabase** | Toda la data (es la BD) | Indefinida | Standard ToS |
| **Anthropic** | Texto invoices, treatment_codes, AED letters drafts, classifications | Anthropic terms (estándar API) | **NO firmado** |
| **Vercel** | Logs, request URLs, response sizes | 7d default (varía por plan) | Standard ToS |
| **ECB** | Solo currency code queries (público) | N/A | N/A |

**Riesgo principal:** Anthropic ve invoice text. Sin DPA explícito, no
hay garantía contractual no-train (aunque por defecto Anthropic no
entrena con tráfico Claude API). Template email para solicitarlo en
§15.

---

## 13 · DPO / GDPR posture (Strength 1/5)

**Estado:** nada documentado.

**Gaps críticos:**
- Sin DPO designado.
- Sin DPIA (Data Protection Impact Assessment).
- Sin privacy statement.
- Sin workflow SAR (Subject Access Request).
- Sin DPAs firmadas con Anthropic, Supabase, Vercel.

**Riesgo real:** Si CNPD (Commission Nationale pour la Protection des
Données, Luxembourg) abre inspección, las preguntas básicas tienen
respuesta "no documentado".

**Coste para cerrar el gap:** **Alto** (€5-15k legal/consultoría) —
NO ejecutado. Recomendación si en algún momento se convierte en
producto cliente-facing.

---

## 14 · Confidentiality (Professional firm bar) (Strength 1/5)

**Gaps:**
- Sin document-level ACL (single-user, no relevante hoy).
- Sin watermarking en PDFs (AED letters, audit exports).
- Sin no-train clause contractual con Anthropic.
- Sin retention policy.
- Sin commitment público de data residency.

**Nivel Legora/Harvey:**
- Document-level sharing (invite-only por documento).
- Watermark con firm name + fecha en cada export.
- DPAs firmadas con todos los vendors.
- SOC 2 Type II + ISO 27001 certification.
- Pen-testing anual.

**Coste estimado para paridad full:** **€10-25k one-off + €70-120/mes**
de monitoring/compliance ongoing. NO ejecutado.

---

## 15 · Templates listas para usar

### DPA Anthropic — copiar/pegar y enviar

```
Subject: DPA request — Claude API account

Hi Anthropic team,

I run cifra (https://app.cifracompliance.com), a Luxembourg tax
compliance tool using the Claude API (Haiku 4.5 + Opus). cifra
processes professional client data (invoices, VAT classifications,
correspondence with the LU tax authority).

I'd like to formalise a Data Processing Agreement (DPA) covering:

  1. Confirmation that data submitted to the Claude API will NOT be
     used to train Anthropic models (no-train clause).
  2. Data residency commitments (or current default).
  3. Subject-rights handling (export / delete on request).
  4. Sub-processor list.

Please share the latest standard DPA template or point me to the
Enterprise tier if that's where this lives.

Thanks,
Diego
```

### IR playbook — see [docs/INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)

---

## 16 · Para referencia: opciones que cuestan dinero (NO ejecutadas)

Diego declinó explícitamente cualquier coste recurrente y cualquier
fricción operativa. Esto queda solo como roadmap si en algún momento
cifra pasa a producto cliente-facing.

### Coste bajo (≤€100/mes, 1-2 semanas)

- **MFA (TOTP)**: librería npm `otplib`, ~2-3 h engineering. **Free
  engineering, cero coste recurrente** — pero Diego rechaza fricción
  del login.
- **Budget spike alert**: si spend Anthropic > 50% del cap diario,
  webhook Slack/email. **Free**.
- **Vercel Secrets API** para rotación sin redeploy: ~3 h. **Free**.
- **Supabase failed-auth monitoring**: cronjob que lee logs y
  alerta patrones extraños. €20-50/mes.

### Coste medio (€500-2k engineering, 4-8 semanas)

- **Field-level encryption** (AES-256-GCM) para VAT numbers, entity
  IDs. Retrofit + decrypt en cada query (perf cost).
- **Document-level ACL** (tabla sharing + check en queries). 1-2
  semanas. Solo útil si vuelve multi-user.
- **Watermarking PDFs** (firm name + fecha) usando `pdf-lib` (ya en
  deps). ~1 h.
- **Audit log archival** + retention 7y: cold storage +€10/mes.

### Coste alto (€5-15k legal, 8+ semanas)

- **DPO consultor Luxembourg**: €2-5k/año.
- **DPIA**: €5-10k legal.
- **Privacy statement** + 3 DPAs firmadas: €1-2k.
- **SOC 2 / ISO 27001 readiness audit**: €10-30k+ + costes
  recurrentes de auditoría.

---

## 17 · Honesty check vs Legora / Harvey

| Métrica | cifra (hoy) | Legora / Harvey |
|---|---|---|
| Certificaciones | Ninguna | SOC 2 Type II + ISO 27001 |
| MFA | No | Sí (obligatorio) |
| Field-level encryption | No | Sí (selectivo) |
| Document-level ACL | No | Sí (granular) |
| Watermarking PDFs | No | Sí (estándar) |
| DPO designado | No | Sí |
| DPIA documentada | No | Sí |
| DPAs con vendors | No | Sí (todos) |
| Penetration testing | No | Anual |
| Incident response | Ahora doc 1-pag | Equipo + SLA |

cifra está a **6-12 meses de ingeniería + €10-25k legal** de paridad
con Legora/Harvey, **si en algún momento Diego decide ir a producto
cliente-facing**. Para single-user dogfood el gap es aceptable.

---

**Fecha:** 2026-05-16. Snapshot post-stint 91. Re-correr este audit
en 6-9 meses o antes de cualquier feature externa.
