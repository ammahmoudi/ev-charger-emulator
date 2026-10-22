# OCPP status and configuration audit — 2026-10-22

Read-only inspection of the development Core `OCPPMessages` log for physical PEVC3107E
stations. No commands or configuration writes were sent to real hardware. Only selected
fields and sanitized findings are recorded here; raw exports, URLs, serials, card IDs and
security values remain outside this repository. Timestamps below are UTC receipt times.

## Observed status order

A successful connector-1 sequence on 2026-09-24:

| Time | Observed message |
| --- | --- |
| 20:40:26.604 | `StatusNotification`: `Preparing` |
| 20:40:51.936 | `RemoteStartTransaction` request, connector 1 |
| 20:40:53.222 | Remote-start response: `Accepted` |
| 20:40:56.433 | `Authorize` request |
| 20:40:56.851 | Authorization response |
| 20:41:17.977 | `StartTransaction` request, connector 1 |
| 20:41:18.188 | Start-transaction response |
| 20:41:19.974 | `StatusNotification`: `Charging` |

This confirms that a remote start can arrive while a connector is already `Preparing`,
and that `Charging` follows the transaction response. OCPP alone does not prove the exact
physical cable/card action that caused a particular `Preparing` message.

A separate connector-2 window on the same day is explicit:

- `Preparing`: **21:06:56.619**.
- `Available`: **21:07:56.566**, **59.947 seconds** later.
- No `StartTransaction`, `RemoteStartTransaction`, or `Authorize` occurs inside that window
  for the inspected station. There is no transaction to count as charging.

Other captured Preparing windows are longer or shorter. Do not infer a universal firmware
window from one sample or confuse this UI/authorization window with every use of the OCPP
`ConnectionTimeOut` key. The emulator retains the requested **60-second default**, with an
explicit configurable timeout.

### Emulator changes

- EV connect and accepted authorization enter `Preparing` in either order.
- Remote starts accept an already-Preparing connector and perform `Authorize` when
  `AuthorizeRemoteTxRequests=true`.
- Local/card sessions remain `Preparing`, with zero energy and no transaction ID, while
  `StartTransaction` is awaiting acceptance. Declined starts never report `Charging`.
- Cancelling during that request cannot revive charging when a late response arrives; any
  transaction accepted after cancellation is closed with `StopTransaction`.
- Unchanged Preparing status is not emitted repeatedly merely because the second action
  arrives. Triggered/boot status sweeps remain explicit.
- Initial boot status is restored from persisted connector state, rather than always
  advertising `Available`. Expired incomplete Preparing is cleared before that sweep.

## Configuration evidence and root cause

The inspected real-device response at **2026-09-25 18:20:35.410** contains **29 entries**,
following a request at **18:20:34.919** whose payload was `{ "key": [] }`. It includes standard
OCPP keys, vendor QR names, and readonly capability entries.

The old emulator's Prisma store interpreted an empty list as a database `IN []` filter and
returned zero entries. Its default in-memory test store already treated an empty list as
"all", hiding the runtime bug. It also lacked persistent standard keys and exposed the UI's
`qrCodeUrl1/2` names without the real firmware's vendor names.

## Supported emulator configuration contract

Both `{}` and `{ "key": [] }` now return all **supported emulator** entries, with `key`,
`readonly`, and `value`. A selected-key request returns matched entries plus `unknownKey` for
unsupported names. Requested names are case-sensitive. `GetConfigurationMaxKeys=10` limits
an explicit key list, not the number of entries returned for an all-keys query.

| Protocol key | Value source / effect |
| --- | --- |
| `HeartbeatInterval` | Persisted seconds; boot negotiates the effective value and an accepted change reschedules the live heartbeat. Default before boot: 300. |
| `ConnectionTimeOut` | Persisted seconds; default 60. Applies to current Preparing deadlines and later attempts. |
| `MeterValueSampleInterval` | Persisted seconds; default 60. Changes active local and remote periodic senders. Zero disables periodic sends. |
| `AuthorizeRemoteTxRequests` | Persisted boolean; default true. Controls remote-start authorization. |
| `QRcodeConnectID1`, `QRcodeConnectID2` | Aliases for the same `qrCodeUrl1/2` HMI model/instance parameters. Values read back under either name and appear on the QR screen. Available when those model parameters exist. |
| `NumberOfConnectors` | Readonly, derived from the model's physical connector count. |
| `GetConfigurationMaxKeys` | Readonly, 10. |
| `SupportedFeatureProfiles` | Readonly, implemented feature modules. |
| `StopTransactionOnEVSideDisconnect` | Readonly, true. |
| `ServerURL` | Readonly emulator endpoint from the instance. Live endpoint replacement is not implemented as a remote firmware reboot; edit Networks in the emulator instead. |

Existing model parameter names remain queryable for compatibility. Firmware/UI/CRC identity
fields are readonly. Protocol overrides persist independently of HMI field names and do not
require re-seeding existing instances. Missing instance parameter rows use model defaults;
writing a vendor alias creates its instance row when necessary.

The real hardware's 29-key catalogue is **not** an assertion that all firmware behaviors are
implemented by the emulator. For example, firmware-only keys such as `ClearChargeRecord` and
`AuthorizationKey` are not advertised as writable no-ops; unsupported keys remain unknown /
`NotSupported`. Unlike the photographed hardware, this emulator reports `ServerURL` readonly.
No real endpoint, security value or card identity was copied into emulator defaults.

### Read, change, read back

```json
[2, "read-all", "GetConfiguration", {"key":[]}]
[2, "change-heartbeat", "ChangeConfiguration", {"key":"HeartbeatInterval","value":"30"}]
[3, "change-heartbeat", {"status":"Accepted"}]
[2, "verify-heartbeat", "GetConfiguration", {"key":["HeartbeatInterval"]}]
[3, "verify-heartbeat", {"configurationKey":[{"key":"HeartbeatInterval","readonly":false,"value":"30"}],"unknownKey":[]}]
```

`ChangeConfiguration` replies with a status, not a key/value body. That is the
[OCPP 1.6 response schema](https://github.com/mobilityhouse/ocpp/blob/master/ocpp/v16/schemas/ChangeConfigurationResponse.json).
Readonly and invalid values are rejected without writing; unsupported keys return
`NotSupported`. Seconds must be bounded nonnegative integers (strictly positive for heartbeat
and connection timeout); boolean values are exactly `true` or `false`.

## Verification and deployment

Integration tests use isolated PostgreSQL plus a mock CSMS over actual WebSockets. Coverage
includes empty/all queries, selected and unknown keys, persistence, readonly and invalid
writes, vendor QR read-back, active heartbeat/meter interval changes, EV Preparing/timeout,
boot-state restoration, remote authorization ordering, and accepted/declined/cancelled starts.
Apply migration `20261022120000_ocpp_configuration` before starting the updated application.
