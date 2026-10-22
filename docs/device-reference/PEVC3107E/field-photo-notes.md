# Field photographs: charging methods and Device information

User-supplied references added on 2026-10-22. The capture dates are unknown; the firmware
build dates shown on the Device tab are not photograph timestamps. Original photos are retained
without cropping or retouching. The photographed serial number identifies the reference unit,
not an emulator default.

## Sources

| Attachment | Saved reference | SHA-256 |
| --- | --- | --- |
| Image 1, `paste-20261021-124354-6f83f727.png` | [09-charge-method-fa.png](screenshots/09-charge-method-fa.png) | `ab307f8cc2676a59d9743a029414bc39490df90a3f3ba772eaf0c8649e602abc` |
| Image 2, `paste-20261021-124521-103bf7ab.png` | [10-settings-device-field.png](screenshots/10-settings-device-field.png) | `570e54b7d5eefcfa58b63c3d21013cfe33c783a680aeb0caad73282de9bc1441` |
| Image 3, `paste-20261021-124528-14b9fb36.png` | Same bytes as Image 1; stored once | Same as Image 1 |

## Charging-method selection

The photo shows a blue header with Hi, Home, a Persian serial-number label, serial, clock, and
computer indicator. A single pale panel contains three choices, from left to right:

| Visible label | Meaning | Emulator action |
| --- | --- | --- |
| کارت شارژ | Charging card | Open the existing card prompt for the selected connector; accepted cards join the EV/authorization handshake. |
| اسکن کد QR | Scan QR code | Open the configured connector QR codes. Scanning continues on the phone; selecting QR does not itself authorize charging. |
| شارژ خودکار / EV ID | Autocharge / vehicle identity | Open an EV ID prompt, then authorize the supplied identifier through the existing local-list/CSMS path. This is a simulation, not automatic identity detection or an ISO 15118 implementation. |

The card icon uses concentric radio waves; EV ID is framed by blue corner brackets, with a
glossy blue action below. The centre of the QR choice is washed out in the photo; the emulator
uses a QR glyph as an affordance, not as a scannable charging code. Configured codes are on
the next screen. The footer shows the runtime price to four decimal places and currency per
kWh. Persian labels have RTL direction; serials, clocks, currency codes, and QR retain LTR isolation.

The upper-right panel number reads `22`. This suggests a countdown but does not establish its
initial duration. The emulator uses a 60-second selection timeout and returns Home on expiry.
This UI timeout does not create a transaction or replace the persisted Preparing deadline:
that separate 60-second EV/authorization handshake starts with EV connection or accepted
authorization. Remote start bypasses method selection.

Entry point: Home (`/instances/[id]`) → a connector's **Charging** action. Card and EV ID
prompts return to the same method screen on cancellation. QR opens `/instances/[id]/qr`.
The Home icon returns to the connector cards. The selector has no bottom navigation strip.
The QR detail screen itself is still not captured by these photographs.

## Setting → Device

The newer photo confirms a read-only identity panel under Device, System, Networks, Fee Rate,
and Other tabs. There is no serial in this screen's header, no Name/master-card fields inside
the panel, and no Save button on the Device tab. The bottom navigation remains Device,
Setting, Maintenance, Event, Cost, and Lock.

| Left column: six rows | Right column: four taller rows |
| --- | --- |
| SN | Plug A Firmware |
| Model | Plug A Date |
| Firmware | Plug B Firmware |
| UI | Plug B Date |
| CRC | |
| Date | |

Observed reference values: model `PEVC3107E`, board firmware `401`, UI `101`, CRC `0X8382`,
board date `2025 y 04 m 15 d`; both plug firmware values are `S 207`, dated
`2025 y 02 m 20 d`. These document the photographed unit and are not copied into seed defaults.

The emulator displays its own instance serial, model, and firmware parameters. Date values
continue to use parameter `updatedAt` as an install/set-date proxy; true firmware build dates
are not currently stored separately. Missing recorded dates display an em dash. Name,
charge-point identity, and master-card edits remain available in **Emulator configuration**
below the device screen, with their existing save operation. Other tabs retain editable
parameters and their Save action.
