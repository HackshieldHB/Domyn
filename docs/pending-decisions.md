# Pending TLT decisions

These items are stored in the Decision register and shown in the application. Status is pending. A development default is a provisional implementation choice, not an approved business rule.

| ID | Topic | Provisional default | Owner |
|---|---|---|---|
| D01 | Two-page survey flow | Two pages: rating, then reasons for low scores | Bu Effi / TLT |
| D02 | Survey wording and Other | Seeded English reasons; Other text is optional | TLT |
| D03 | Ticket generation | One ticket per submission | TLT |
| D04 | SLA definitions | No active threshold. Seeded 20-minute example is inactive | TLT |
| D05 | Fallback and notification routing | Location supervisor, then role fallback | TLT |
| D06 | Roles and area access | Four roles; management with no areas sees all | TLT |
| D07 | Check-in method | Manual, tablet, or mobile web; presence only | TLT |
| D08 | WhatsApp provider | Sandbox adapter; no live send | TLT / vendor |
| D09 | Management KPIs and report access | Dashboard and the twelve report types for management | TLT |
| D10 | Hosting, SIM, and operating cost | Not selected | TLT |
| D11 | Tablet model | Not selected; not hardcoded | TLT |
| D12 | Power, Wi-Fi, installation | Seed notes only; editable per location | TLT facilities |
| D13 | Retention, availability, backup | Not selected; no invented RPO/RTO | TLT |

Approval history is the Decision History table. Changing a status in the UI records the note and actor. It does not silently rewrite tickets that already exist.
