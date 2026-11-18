# Native workspace mapping — implementation status

This is an unreleased replacement for the embedded-webpage preview. No native integration is shipped yet. The existing `lib` artifacts and preview release still implement the old panel.

## Product scope

Keep local Windows workspaces in the original sidebar. Configure one remote server, discover its workspaces, and select exactly one workspace to map into that same sidebar. Show its existing sessions and open them in the native conversation view. New sessions, history, prompts, stop requests, execution and authoritative persistence belong to Linux. No local history import, full webpage embedding, or general multi-server manager.

## Confirmed upstream integration requirements

The inspected source and the user's confirmed Windows version are both Harness `0.2.2-rc.3`.

- `ui-workspace` owns the single `sidebar.workspaces` slot. It consumes root `workspaces.list` and `sessions.list`; neither controller has a workspace-source registration API.
- `api-session-controller` constructs one `ClientSessions` with one `SessionManager` and one Remote surface. Session scope creation does not choose a remote runtime.
- `api-gateway` invokes unary calls and streams through its owning context's connection. Overriding a session context's connection alone does not change that dispatch.
- Permission checks, session status, attachments, model/preset selection and other root-level consumers also require source-aware resolution. Mapping just the tree or prompt method is insufficient.

The recommended implementation is a source registration extension in the native client controllers plus the external plugin's single authenticated connector. The native catalog facade must delegate mapped session acquisition to an isolated remote runtime and preserve that runtime's context in the returned binding. The existing workspace browser and conversation components remain the presentation. Authentication should use a local Host-owned connector instead of assuming the embedded guest's cookies are available to native RPC. Exact wire/auth compatibility must be checked against the installed desktop and remote versions before delivery.

## Implemented, not integrated

`src/native/mapping.ts` selects exactly one remote workspace and gives its workspace/session references UI-only identities. Original Host identities remain untouched; stale mappings are rejected and the remote identity family remains recognizable after unmapping. These helpers are not exported to the current client entry or included in its installed behavior. They do not authorize remote access or enforce server-side workspace isolation.

`src/native/catalog.ts` owns the observable composition of local rows and the selected remote workspace. Remote session summaries are filtered to its membership. Offline state retains remote rows but rejects remote dispatch; retired selection callbacks are ignored. Identity-bearing metadata beyond the primary IDs still needs a native adapter.

`src/native/connector.ts` implements a Host-only native launch-token exchange and process-local browser-cookie owner, restricted API HTTP transport and authenticated mux socket factory. It rejects redirects, cancels owned HTTP work and closes sockets on disposal without issuing a server-session cancellation. It is not yet mounted as a Cordis service, connected to a real remote Host, or persisted across restarts.

## Remaining acceptance gates

1. Register the native source extension and merge local and selected remote catalogs, with explicit offline state.
2. Authenticate and list workspaces through the remote connector; persist only intentional configuration and credentials through an appropriate storage service.
3. Acquire remote session bindings with their own transport, event streams, permissions and status. Resolve every session-scoped operation through its source; unmapped/offline remote identities must fail without local fallback.
4. Verify identical raw local/remote IDs, history opening, live replies, send/stop, new remote sessions, switching while running, reconnect and disposal.
5. Handle remote attachments without passing Windows filesystem paths to Linux. Disable unsupported source-dependent actions until implemented.
6. Build for the user's actual desktop version and test the delivered native workspace/session interaction on Windows. Unit tests or successful package installation are not Windows acceptance evidence.

The upstream Gateway runtime extension is implemented: its five isolation tests pass, and its Client TypeScript project compiles. The native runtime assembly's three tests pass after correcting its disposed-runtime assertion to check both namespace withdrawal and refusal by a previously borrowed method. The fifteen mapping/catalog/connector tests also pass in the resumed check.

## Current native implementation and verification

`src/native/controllers.ts` now mounts and tests the real generated Session/Workspace namespaces under the isolated runtime. `src/native/source.ts` registers both mapped catalogs, gates offline operations and permissions, and attaches only approval/question events to native UI listeners. Session bindings preserve their original Host identity/context so model selection and question replies use the remote source. Uploads are source-addressed but deliberately refused; remote presets, file previews and shared read markers are not enabled.

`src/client/native-entry.tsx` and `NativeClientManager` implement native configuration, discovery, mapping and disposal. The panel is configuration only; history and chat remain the existing native workspace/conversation UI. Server origin and workspace selection are saved, never the entered token. Authentication is process-local. Re-mapping after withdrawal currently requires a page reload.

Verified locally:

- Native integration suite: 40 passing tests through the portable matching-checkout runner; subsequent focused checks cover new-session creation and cleanup after a withdrawn desktop lease.
- Default preview suite: 37 passing tests, unchanged preview behavior.
- Real native Controller/runtime/source composition: opening nonempty remote history, send, stop, and remote workspace-addressed Session creation; identical local raw IDs remain isolated. This is an in-process carrier, not the user's actual server.
- Root UI regressions and explicit source tests cover model catalog/selection, local preset exclusion, refused source uploads, question claim/reply routing, and selective event attachment. Reported batches overlap and are not a single cumulative count.
- Related Client/desktop TypeScript projects compile; modified desktop and ten native UI/API modules bundle.
- Real Linux Electron with the built sandbox preload passes typed byte-request/response and event roundtrips over synthetic IPC. This does not prove Windows rendering or real remote network behavior.

Native code is built separately into `native-dist`; ordinary `lib/client.js` remains the old preview. The optional source patch applies cleanly to upstream `39163dd30f703a79079e2d2446545cff3c453738`. Legacy guest-persistence changes are deliberately excluded from this native patch.

The GitHub Windows workflow builds an unsigned, separately identified developer desktop plus the matching native plugin. Windows interaction acceptance belongs to the user; local absence of a Windows node is not a reason to withhold the test build. See [BUILD-NATIVE.md](BUILD-NATIVE.md) for reproduction, install steps, test checklist and limits.

No service restarts or live deployment changes are part of these build steps.
