# PEVC3107E screen reference

Real device screen captures (SINO/PEVC PEVC3107E, dual-gun CCS2 DC charger), used to shape this
emulator's UI. Serial numbers, IPs, and prices visible in these captures are from a real unit and
are not meaningful outside this reference use — don't hardcode them into the emulator's defaults.

The device has two separate navigation surfaces that are easy to conflate:

- A **status/diagnostics overlay** (not on the bottom nav — reached from Home) showing overall
  component health and per-plug interface-board diagnostics.
- The standard **bottom nav**: Device, Setting, Maintenance, Event, Cost, Lock. Note "Device" here
  is a hardware test/diagnostics screen, *not* the "Device" tab inside Setting (identity info) —
  same label, two different screens.

## Curated screenshots (`screenshots/`)

| Screenshot | Screen |
| --- | --- |
| [01-home-dual-plug.png](screenshots/01-home-dual-plug.png) | Home — Plug A / Plug B charging cards, price |
| [02-status-diagnostics.png](screenshots/02-status-diagnostics.png) | Status/diagnostics overlay — overall component health grid |
| [03-communication.png](screenshots/03-communication.png) | Status/diagnostics overlay — per-module communication voltage/current grid |
| [04-plug-a-interface-board.png](screenshots/04-plug-a-interface-board.png) | Status/diagnostics overlay — Plug A interface board diagnostics |
| [05-settings-device.png](screenshots/05-settings-device.png) | Setting → **Device** tab (identity, firmware) |
| [06-settings-system.png](screenshots/06-settings-system.png) | Setting → **System** tab, page 1 (power/voltage/current limits) |
| [07-settings-system-p2.png](screenshots/07-settings-system-p2.png) | Setting → **System** tab, page 2 (manufacturer, security, sensors) — *not* the Other tab, despite earlier naming |
| [08-settings-system-p3.png](screenshots/08-settings-system-p3.png) | Setting → **System** tab, page 3 (contactor, distribution, currency) |

## Additional field photographs

The user supplied two distinct field photographs (three attachments, with Image 3 duplicating
Image 1). Originals, provenance, observed values, and implementation boundaries are recorded
in [field-photo-notes.md](field-photo-notes.md).

| Screenshot | Screen |
| --- | --- |
| [09-charge-method-fa.png](screenshots/09-charge-method-fa.png) | Persian charging-method selection: card, QR, EV ID/autocharge, a countdown, and tariff footer |
| [10-settings-device-field.png](screenshots/10-settings-device-field.png) | Setting → Device: six identity/board rows on the left, four plug firmware/date rows on the right |

The charging-method selector is reached from a connector's Charging button. The Device tab
uses the newer field photo for its column grouping; operator-only edits sit below the emulated
screen. Captured firmware values and serials remain references, never instance defaults.

## Additional screens (`manual-pages/`, raw filenames from the maintenance manual)

These fill in screens the curated captures did not cover. A handful of files in `manual-pages/` are
hardware photos/wiring diagrams, not UI (e.g. `Page34_Image4.jpg`, `Page35_Image2.jpg`) — not
useful for the emulator's UI, kept only because "all images" were requested.

| File(s) | Screen |
| --- | --- |
| `Page17_Image2.jpg`, `Page18_Image2.jpg`, `Page19_Image2.jpg`, `Page19_Image3.jpg` | Setting → **Networks** tab — Connection type (GPRS/DHCP/Ethernet), Default gateway, Local IP, Service IP, Service port, Domain name (holds the full OCPP WS URL, e.g. `ws://<host>/<chargePointId>`), Background enable (start/stop) |
| `Page9_Image3.jpg` | Setting → **Other** tab, page 1 — input/output overvoltage & overcurrent protection (enable/value/time) |
| `Page10_Image2.jpg` | Setting → **Other** tab, page 2 — pile/plug temperature protection (enable/value/time) |
| `Page13_Image2.jpg`–`Page14_Image3.jpg` | Bottom nav **Maintenance** — 5 sub-tabs: Time Setting, Event Record Clear, Consumption Record Clear, Restore Factory Setting (has both "Restore" and an "OCPP" button), Upgrade Board Program — each destructive action behind a confirm dialog |
| `Page14_Image2.jpg`, `Page14_Image3.jpg`/`Page30_Image2.jpg`, `Page15_Image2.jpg`/`Page31_Image2.jpg`, `Page16_Image2.jpg` | Bottom nav **Device** (hardware test/diagnostics, distinct from Setting → Device) — 4 sub-tabs: Charging Test (per-plug output V/A + start/stop), Plug A/B Test (CC1/CC2, KM1/KM2, contactor/aux-power/electronic-lock manual actions, interface temps), Charging Pile Test (breaker, GPRS status/signal, 3-phase/power/fan contactor + QF manual actions, module voltages, ICCID/IMEI) |
| `Page11_Image2.jpg` | Bottom nav **Event** — log table: S.N, Event occurrence time, Event description (examples seen: "Dev off-line", "Event Clear", "KM opt Err") |
| `Page11_Image3.jpg`/`Page27_Image2.jpg`/`Page27_Image3.jpg` | Bottom nav **Cost** — session history table: S.N, Gun ID, User Card NO., Start Time, Stop Time, Charging Energy(kWh), Power Usage(currency), Stop Cause (examples: "QF Err", "KM Err") |
| `Page30_Image2.jpg`/`Page31_Image2.jpg` (the small popup ones) | Post-charge summary popup: Cost(currency), Card number, Manu./Stop indicator, Start/Stop time, Charging Energy(kWh), Charging Time (example error: "Ins Err") |

No capture of the **Lock** bottom-nav screen exists in this manual — design it generically
(per-connector lock/unlock, matching `UnlockConnector` handling).

See this repo's issues for which screen feeds which build item.

## OCPP traffic validation

See the [2026-10-22 log audit](ocpp-log-audit-2026-10-22.md) for read-only real-device
evidence, message ordering, the configuration empty-key bug, supported key mappings,
read/change/read-back examples, and emulator/firmware differences.
