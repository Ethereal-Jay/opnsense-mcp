# OPNsense MCP

A safety-focused Model Context Protocol server for OPNsense's MVC API. It uses the API's native HTTP Basic authentication, keeps endpoint structure explicit, and fails closed when it cannot determine whether a command is read-only.

This is an early foundation. It intentionally provides a guarded generic API client before adding curated domain tools. That keeps it useful across current OPNsense core and plugin revisions without pretending the generated API reference contains complete request schemas.

## OPNsense API Model

OPNsense routes API requests as:

```text
/api/<module>/<controller>/<command>/<parameter...>
```

The important behaviors for automation are:

- API keys use HTTP Basic authentication: key as username, secret as password.
- Access is still constrained by the key owner's OPNsense ACL privileges.
- Requests and most responses are JSON. Downloads and streams may not be.
- `GET` and `POST` do not map cleanly to safe and unsafe operations. Some reads use `POST`, and some mutations use `GET`.
- Mutable model controllers commonly expose `get`, `search`, `add`, `set`, `del`, and `toggle` operations.
- Array model records use UUIDs. A `get` without a UUID often returns a blank record populated with defaults.
- A successful model mutation usually writes staged configuration. A separate `apply` or `reconfigure` activates it.
- Model writes return values such as `{"result":"saved"}` or `{"result":"failed","validations":...}`; HTTP 200 alone does not prove semantic success.
- OPNsense configuration locking, model validation, revision context, and ACL checks happen server-side and should not be bypassed.

Official references:

- <https://docs.opnsense.org/development/api.html>
- <https://docs.opnsense.org/development/how-tos/api.html>
- <https://docs.opnsense.org/development/architecture.html>
- <https://docs.opnsense.org/development/frontend/controller.html>
- <https://docs.opnsense.org/development/frontend/models_fieldtypes.html>
- <https://github.com/opnsense/core>
- <https://github.com/opnsense/plugins>

## Safety Model

`opnsense_request` accepts only commands classified as reads. Classification is based on the command, not its HTTP method.

Mutations use two tools:

- `opnsense_plan_change` reports the exact request and its risk without contacting OPNsense.
- `opnsense_execute_change` requires a matching one-time token that expires after five minutes.

Risk classes distinguish staged writes, activation, disruptive service or firmware operations, and catastrophic reset/restore operations. Unknown commands fail closed as mutations.

The write mode is controlled outside the agent:

- `disabled` permits reads only.
- `plan` permits mutation analysis but never creates an execution token.
- `enabled` permits execution with a matching token.

Use a dedicated OPNsense user and grant only the effective privileges required by the intended tools. For read-only deployments, also grant `System: Deny config write` (`user-config-readonly`) in OPNsense.

## Curated Read Tools

The guarded generic client is supplemented by fixed read-only tools for common operational tasks:

- `opnsense_get_firewall_logs` reads structured packet-filter events.
- `opnsense_get_logs` reads bounded pages from core and service logs, including system, configd, gateways, VPN, DNS, DHCP, IDS, routing, and web UI logs.
- `opnsense_list_firewall_rules` reads filter rules visible to the automation API.
- `opnsense_list_nat_rules` reads destination, source, one-to-one, or NPT rules.
- `opnsense_get_route_table` reads either the live kernel routing table or configured static routes.

These tools call fixed query endpoints directly. They cannot select mutating sibling actions such as clearing logs, flushing states, changing rules, or applying configuration. Results remain subject to the API user's OPNsense ACL privileges.

## Setup

```sh
npm install
npm run build
```

Configure the environment using `.env.example` as a reference. Environment files are not loaded automatically and are ignored by Git.

Prefer a publicly trusted certificate or set `OPNSENSE_CA_FILE` to the private CA certificate. `OPNSENSE_TLS_VERIFY=false` exists for isolated development only.

Run over stdio:

```sh
OPNSENSE_URL=https://firewall.example \
OPNSENSE_API_KEY=... \
OPNSENSE_API_SECRET=... \
node dist/index.js
```

For example, a read call for system status uses:

```json
{
  "module": "core",
  "controller": "system",
  "command": "status"
}
```

## Current Limits

- OPNsense does not publish a complete OpenAPI contract. The generated reference identifies routes and likely methods, but usually omits body schemas.
- Plugin endpoints exist only when their packages are installed and ACL-authorized.
- Semantic response validation is not yet endpoint-specific.
- The lexical risk classifier is intentionally conservative. Curated tools should eventually use an audited endpoint manifest with explicit request and response schemas.
- Plan tokens reduce accidental and mismatched execution, but MCP hosts should still present destructive tool approval to a human.
