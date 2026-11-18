# Native Windows test build

This is a native-client replacement, **not** the old embedded-webpage preview. It requires the patched desktop and matching native plugin together. Updating the plugin alone on the stock desktop is insufficient.

## Reproduce

Base Harness commit: `39163dd30f703a79079e2d2446545cff3c453738` (`0.2.2-rc.3`).

1. Check out that exact upstream commit and apply `patches/native-client.patch` after `git apply --check`.
2. Install its locked dependencies and build the matching declarations/artifacts.
3. In this plugin checkout, set `DSH_NATIVE_ROOT` to the absolute upstream checkout path, then run:

```sh
npm ci
npm test
npm run check:native
npm run test:native
npm run build:native
npm pack ./native-dist
```

The native staging tree is `native-dist/`; the ordinary `lib/client.js` remains the old preview. Native generated contributions are bundled from the matching upstream build, while Controller/Connection/Gateway services are supplied by the patched desktop.

## Windows artifact

The `Native workspace Windows test build` GitHub Actions workflow builds on Windows x64, applies the source patch, prepares a separately identified **unsigned developer app**, builds the native plugin, and archives both outputs. It does not publish to the official updater, register the official URL scheme, or carry production signing credentials. The explicit CI-only packaging helper does not change signed/default builds.

After a successful run, release assets include the Windows test desktop and `dsh-remote-workspace-0.2.0-native.0.tgz`. Install the native plugin through the test desktop's plugin UI. Open **远程工作区**, enter the HTTPS server origin and its access token, choose one Linux workspace, and map it. Use the original workspace tree and conversation view for chat.

## Test checklist

- Existing local workspaces remain present; local and remote sessions do not mix even if their raw IDs match.
- The selected Linux workspace's existing sessions open with their remote history.
- Send, live reply, stop, and new-session creation operate on Linux.
- Tool approval and user-question requests appear and their answers return to Linux.
- Model selection lists the remote catalog and updates the remote session.
- Disconnecting or unmapping does not stop server work or route a stale remote identity to Windows.

## Current limits

Authentication is process-local; only the server origin and selected workspace are saved in browser storage. Remapping after withdrawal currently requires reloading the page. Attachments, remote preset selection, remote file previews, and shared read/unread marks are disabled. These limits are explicit; none should silently use the local Host.

Linux Electron sandbox/preload carrier roundtrips and in-process native chat integration have passed. They do not prove the actual user's server, Windows UI, or installed-package behavior. Windows acceptance is performed by the user.
