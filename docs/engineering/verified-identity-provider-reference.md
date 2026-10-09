# Verified profile provider reference

Primary provider documentation checked on **2026-10-09**. This reference covers the server-only client in `lib/profiles/identity-provider.ts`; activation still requires owner-configured credentials and exact registered HTTPS callback URLs. Unit evidence uses mocked HTTP, not live accounts or provider consent.

## GitHub.com

The client uses `https://github.com/login/oauth/authorize`, exchanges the code at `https://github.com/login/oauth/access_token`, then calls `https://api.github.com/user` once to identify the authenticated account. GitHub's current OAuth-app documentation supports S256 PKCE and warns that omitting `scope` can inherit previous grants. Keryx explicitly supplies an empty scope, requires a 43-character SHA-256 challenge and its original verifier, and refuses any nonempty or missing token scope. No `repo`, `user`, email, or `offline_access` permission is requested. Refresh fields, if returned by app settings, are discarded. [GitHub: authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

An empty scope permits reading public information. The response's optional `X-OAuth-Scopes` must also be empty when present. Only a positive safe integer account ID and a validated login are projected into the identity contract; full name, email, avatar, counts and other response properties are dropped. The user request pins the currently documented `2026-03-10` API version. [GitHub: OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [GitHub: authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).

The caller generates and binds the state and verifier to the same wallet session. Verifiers follow the 43–128 character unreserved alphabet; the client never falls back to plain PKCE. [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html).

## ORCID.org

The client uses the production HTTPS authorization and token endpoints at `https://orcid.org/oauth/authorize` and `https://orcid.org/oauth/token`. It requests only `/authenticate`, then extracts the authenticated checksum-valid ORCID iD and name directly from the authorization-code token response. A missing or blank name displays the authenticated iD. It does not call ORCID record, works, employment, userinfo, or refresh endpoints. The documented exchange is a confidential server request; production callbacks require HTTPS. [ORCID: authenticated iD tutorial](https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/).

ORCID describes `/authenticate` as also permitting public-record reads, and notes the related `/read-public` capability. Keryx does not exercise that capability: it requires the returned `scope` string to be exactly `/authenticate` and discards the access/refresh tokens. It refuses widened scopes and requests no `openid` or update permissions. [ORCID: integration and API FAQ](https://info.orcid.org/documentation/integration-and-api-faq/).

The consulted ORCID primary references do not establish PKCE support for this flow. Keryx makes no ORCID PKCE claim and refuses a supplied challenge/verifier rather than silently ignoring it. Security therefore also requires the route's unguessable, single-use OAuth state, browser cookie and unchanged active SIWE session lineage. This is a limitation of the implemented, documented flow, not a claim that ORCID universally lacks PKCE.

## Transport and surface boundaries

Each fixed-endpoint request has a 10-second deadline covering fetch and streamed body reads, and a 64 KiB cap on actual response bytes. Redirects, non-200 status, unexpected response URLs, non-JSON MIME, malformed UTF-8/JSON, token errors, widened scopes and unsafe identity fields fail with `ProfileIdentityError("identity_unavailable")`. Provider bodies, tokens, credentials and transport exceptions are never exposed through the error. There are no retries, database writes, token persistence or logs in the provider client.

Configuration supplies only provider choice, client ID/secret and the trusted callback URI; it cannot change transport destinations. The owning route controls callback allowlisting, consent, state/session verification, persistence and unlinking. Browser linking remains interactive SIWE consent. CLI and remote/stdio MCP consumers may read the owner's allowlisted identity snapshot with explicit `profile:read` authority; they do not perform provider OAuth mutations. The existing `profile_read` snapshot remains unchanged.
