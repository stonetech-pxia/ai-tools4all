# OmniRoute Setup (omniroute-onboard)

A desktop helper that runs [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
for you and connects the official free plans of AI services to it, so you get
one address and one key for any AI tool.

> Status: M1 (developer preview). OpenRouter and Groq. A user-facing guide with
> screenshots, installers, and more services come later.

## How it works

- The helper includes OmniRoute and runs it in the background on this computer (`http://localhost:20138/v1`). Nothing else to install. Closing the window keeps it running in the tray; quitting from the tray stops it. In the installed app it can start with your computer, if you choose.
- You sign in to each service yourself. The helper never reads, types or stores passwords, and never handles captchas or SMS codes.
- OpenRouter uses its official OAuth approval in your own browser.
- Groq opens in your usual browser, so your existing sign-ins, password manager and passkeys work. The helper shrinks to a small panel on top and tells you what to click. When you copy the new key, it picks it up from the clipboard (only if you allow it, only while waiting, only text that is exactly a key) and then removes it from the clipboard. Or you paste it yourself.
- Fallback: "Let the helper click for me" opens a separate helper window (its own browser profile, not your everyday browser) with a help panel; after you sign in there, the helper opens the keys page, asks before creating a key, and reads the new key.
- Keys go straight to OmniRoute on this computer, stored encrypted there. They are never logged, printed, or sent anywhere else. No telemetry, in the helper or in OmniRoute.
- Network: the helper starts OmniRoute with its own background checks switched off, so it only contacts the AI services you connected. Two exceptions come from OmniRoute itself and can't be switched off: opening its dashboard checks for OmniRoute updates and news and loads small flag icons; and with OpenRouter connected, listing models fetches OpenRouter's public model catalog.
- No cost, by construction: the helper builds a model named `free` that only contains models that cannot cost money (Groq's free models; OpenRouter models with a `:free` id whose every listed price is 0, re-checked from OpenRouter's catalog). Keys made by the helper can only call `free`. OmniRoute refuses everything else, including `auto` and single models, before any request goes out. If a provider makes a model paid, it drops out of `free` or simply stops working; it never starts charging. Accounts that have bought OpenRouter credits get a warning to set a credit limit.
- OmniRoute's settings are locked with a random password and encryption keys that the helper keeps in your OS keychain, so other programs on the computer can't change them.
- If anything on a page doesn't match, the helper switches to step-by-step instructions plus a box to paste the key yourself.

## Development

Requires Node.js 22.12+ (24 recommended).

```bash
npm install
npm start                 # build and run; the first run also prepares the bundled OmniRoute (a few minutes)
npm test                  # unit tests
npm run test:e2e          # Electron end-to-end tests (mock services; the hosted test needs vendor/omniroute)
npm run typecheck
npm run prepare:omniroute # rebuild vendor/omniroute (pinned version in scripts/prepare-omniroute.mjs)
```

Layout:

- `src/core/`: provider flow state machine, OmniRoute client and host (`omniroute/`), key validation, logging with redaction
- `src/providers/`: one folder per service; URLs, selectors and timeouts are in its `config.json`
- `src/overlay/`: help panel injected into service pages (isolated-world preload)
- `src/ui/`: the wizard window
- `src/main/`: Electron main process: windows, tray, settings, provider flows
- `src/i18n/`: all user-facing text (`en.json`)
- `vendor/omniroute/` (generated, not committed): OmniRoute's unmodified build, trimmed to what its server loads. MIT-licensed; its `LICENSE` and `THIRD_PARTY_NOTICES.md` are kept alongside.

Manual test checklist: [docs/manual-test-M1.md](docs/manual-test-M1.md).
