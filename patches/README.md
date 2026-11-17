# Optional desktop source patch

The patch targets upstream DeepSeek Harness `39163dd3` (`0.2.2-rc.3`) and adds explicitly persistent guest cookie storage without changing ordinary Browser tabs. It is optional for installing the plugin on a compatible stock desktop. It requires rebuilding and qualifying the desktop; do not apply it to installed application files.

Paths in the patch are relative to an upstream checkout. No deployment endpoint, login token, local machine path or user configuration is included. Run `git apply --check` before applying it. See the main README for scope, security properties and unverified Windows behavior.
