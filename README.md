# Harness remote workspace plugin

**Experimental preview for Windows testing.** This plugin adds a **Linux workspace** entry next to the existing local navigation in DeepSeek Harness Desktop. It embeds one remote Harness server's original UI in an isolated Electron guest. Messages, models, tools, session history and memory run on that remote server, not through a second local model.

This is an embedded remote UI, **not a merged native workspace tree**: local workspaces remain in the outer sidebar, while the remote UI has its own sidebar and may show multiple workspaces from that server. Selecting only one remote workspace is not yet implemented. It has not been qualified on Windows.

## Install directly from GitHub

In Harness Desktop, open **Plugins**, choose the external-plugin installation action, and enter:

```text
https://github.com/CatInOrange/dsh-remote-workspace
```

The repository is public and includes compiled `lib` files, so installing from GitHub does not require compiling the plugin yourself. Enable the installed bundle and restart Harness if requested. For a version-pinned Git spec, use `github:CatInOrange/dsh-remote-workspace#v0.1.0-preview.1`.

If the installed Harness build does not accept a GitHub spec, install the release tarball below instead. A successful package installation does not establish runtime compatibility with your desktop version; see the compatibility section below.

## Install a release tarball

1. Download `dsh-remote-workspace-0.1.0-preview.1.tgz` from [Releases](https://github.com/CatInOrange/dsh-remote-workspace/releases). Do not use GitHub's source archive as an installable plugin.
2. Open **Plugins** in Harness Desktop, install the local `.tgz` package and enable its bundle. Restart Desktop if its profile does not support live reload.
3. Open **Linux workspace**, enter your server's HTTPS origin, such as `https://example.com`, and its native Harness access token. Alternatively, paste the server's complete native login link into the address field.

No server address or credential is preset. The example domain is only a placeholder. Use a remote Harness server you administer or are authorized to access. The credential is a **Harness access token, not a DeepSeek API key and not a newly created plugin password**. The remote server exchanges it for its ordinary browser cookie. Invalid or expired login is handled by that server; obtain its current launch link when required.

The tarball contains the compiled Host and Client entries and its opt-in bundle activation patch. It does not modify your installed desktop executable. Linux needs no plugin installation or service changes.

### What works on an unmodified desktop?

A desktop build exposing the compatible protocol-1 `dshDesktop.browser` guest bridge and the `main` / `sidebar.panellist` slots can load the plugin without a carrier patch. If the bridge is missing, the panel displays an unsupported notice. These APIs were inspected in Harness `0.2.2-rc.3`; compatibility with your installed Windows version must be tested rather than assumed.

On an unmodified compatible carrier, guest cookies may remain process-local: exiting Desktop can require entering the access token again. There is no claim of stock-desktop persistent login. Applying the optional source patch below and rebuilding Desktop enables explicitly persistent guest storage.

## Connection and data storage

The plugin only saves the sanitized HTTPS origin. It does not persist an access token or credential-bearing URL in plugin configuration or local storage. The remote guest manages that server's own browser cookie and browser cache, independently of the local Host. A cookie can expire or be revoked under the server's authentication policy.

Opening the panel reconnects to the saved server. Offline status is shown, a browser network-online event reloads the guest, and **Reload** is available for other failures. The remote Harness UI owns its streaming and WebSocket recovery. **Disconnect** closes this view; it does not revoke the remote cookie or explicitly cancel a Linux task. Use the remote application's sign-out operation to revoke its login. Do not post a real login link or access token in issues or screenshots.

## Build from source

Node.js 24.9 or later is recommended to match Harness development. This repository builds independently: no upstream checkout, absolute machine paths, workspace symlinks or global `dsh` command is required.

```sh
npm ci
npm run build
npm test
npm pack
```

`npm run pack:release` rebuilds the artifacts and produces `dsh-remote-workspace-0.1.0-preview.1.tgz`. Install that file through the desktop Plugins page. The generated `lib` directory is also committed for direct GitHub installation; rebuild and commit it whenever source changes. The build uses esbuild and Lightning CSS to emit the standard DSH lazy-CJS module and deferred stylesheet metadata, with React and Harness UI primitives supplied by the desktop's module loader.

The scripts transpile TypeScript but do not claim a full upstream typecheck. Tests cover endpoint/credential sanitization, guest lifecycle and the built module format; they do not boot a complete Harness Desktop application.

## Optional persistent-cookie carrier patch

`patches/desktop-persistent-guest.patch` is optional upstream source code, **not something to apply to an installed Windows app or a prerequisite for the preview panel**. It was prepared against upstream DeepSeek Harness commit `39163dd3` (`0.2.2-rc.3`). In a matching upstream checkout:

```sh
git apply --check path/to/desktop-persistent-guest.patch
git apply path/to/desktop-persistent-guest.patch
```

Then follow upstream's desktop build and platform qualification instructions. This repository does not build or distribute a custom Windows executable.

The patch forwards `acquire(workspace, { persistent: true })` through the existing authenticated preload/IPC bridge. It creates a separate persistent partition keyed by a hash of the account identity, while ordinary Browser callers keep temporary storage. Remote documents still receive no local privileged preload; Node integration stays disabled, context isolation, sandbox and web security stay enabled, and existing local-Host request filtering stays in place. Session caches and cookies are stored by Electron in that desktop installation's user data directory. This persistence behavior remains unverified on Windows.

## Limitations and verification status

- This is one configured remote server entry, not general multi-server management. It does not enforce one workspace on that server or combine remote project rows into the local workspace tree.
- Navigating to a local conversation unmounts the guest. Reopening the remote panel reloads it using the same storage account. Both conversations are not displayed simultaneously.
- The plugin does not synchronize files, histories or memory between Windows and Linux. Guest caching does not create a second authoritative session database.
- Existing guest restrictions on downloads, native windows and device permissions remain. File transfer, clipboard/device integration and remote workspace selection are not implemented here.
- Actual Windows installation/rendering, login, cookie persistence, live streaming, task survival after Windows shuts down, and visual acceptance in both themes are **unverified**. Their behavior is not established by the unit or artifact tests.
- The optional carrier patch was exercised with focused storage-isolation tests and existing guest/native-keyboard regression tests in the upstream development checkout. The standalone test suite does not execute Electron or certify that patch on another upstream revision.

## Model and memory effects

No prompt section or model-facing tool is added. No local model call is made for remote messages. The remote server's configuration determines long-term memory and model/KV-cache behavior; centralized session storage does not itself create cross-session memory.

## License

MIT. The optional patch modifies MIT-licensed DeepSeek Harness code; the included license preserves the upstream notice. This is an independent experimental plugin, not an official DeepSeek release.
