# OCEAN CLASH

A browser-based naval arena for 2–10 captains per battle. Phaser 3 renders the ocean and ships; Socket.IO relays player intent to a Node server that owns movement, collision, weapons, damage, score, and match results.

## Play locally

Requirements: Node.js 24 LTS and npm 10 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in two separate browser profiles or devices. Create a private room in the first window, copy its six-character room code, join from the second window, mark both captains ready, and have the host launch. `npm run dev` runs the Vite client on port 5173 and the game server on port 3000; Vite proxies Socket.IO to the server.

To run the production build locally:

```bash
npm run build
npm start
```

Open `http://localhost:3000`. The Express server serves the built client, Socket.IO endpoint, and `/health` status endpoint from the same origin.

## Controls

**Desktop:** W / Up moves forward, S / Down reverses, A / Left and D / Right steer, mouse aims, hold left mouse to fire cannons, Q launches a torpedo, E fires the machine gun, R launches a missile, Space activates the ship ability, and Escape opens the local pause/settings panel. Pause is local and does not stop the shared match.

**Mobile:** use the left virtual joystick to steer and the right-side Fire, Torpedo, MG, Missile, and Special buttons to attack. Tap or drag on the water to aim.

## Low-end graphics and performance

Low Graphics removes the animated water texture, grid, ship wakes, and selection rings, disables antialiasing and extra glow/particle effects, skips unchanged health-bar redraws, and renders the battle at 50% of the screen resolution. It is enabled automatically when the browser reports 8 GB or less device memory (or a high-DPI screen); change it during a match from Pause → Low Graphics. The game HUD reports Phaser FPS, Socket.IO round-trip ping, and JavaScript heap usage when the browser exposes that metric. Heap usage is a browser estimate and does not include GPU memory or other applications' RAM. The game uses plain TypeScript and DOM updates; it does not include React.

## Ships and modes

| Ship | Strength | Special ability |
| --- | --- | --- |
| Destroyer | Balanced health, speed, and cannon | Depth Charge |
| Battleship | Heavy hull, armor, and damage | Broadside |
| Aircraft Carrier | Long-range air strike | Air Strike |
| Submarine | Low profile and stealth | Silent Run |
| Speedboat | Highest speed and quick reload | Afterburner |

Free For All and Team Deathmatch respawn after sinking. Last Ship Standing does not. Private room codes control access; any room can select a match mode. Public matchmaking places ready captains into an open lobby and starts a short countdown when at least two are ready.

## Tests and builds

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The server tests run independent Socket.IO clients through room creation, 10-player capacity, reconnects, server-simulated movement, cannon and torpedo damage, scoring, Last Ship Standing winner calculation, and cleanup. The Playwright tests use two isolated browser contexts to exercise the actual private lobby and match UI, and a touch-enabled mobile layout. Playwright uses a bundled Chromium by default; set `CHROME_PATH` to a local Chrome executable when preferred.

## Configuration

Copy `.env.example` to `.env` for local configuration. `PORT` controls the HTTP and Socket.IO listener; `NODE_ENV` selects the runtime environment. No frontend secret or third-party API key is required.

## Architecture and limits

`shared/` contains ship rules, map dimensions, and protocol types. `server/` owns room state and fixed-step match simulation. `client/` contains Phaser rendering, UI, input, audio, and the Socket.IO client. Match state is held in one Node process and is intentionally ephemeral. A server restart closes active battles; horizontal scaling requires shared room state and a Socket.IO adapter. The client uses interpolation for remote ships and server snapshots at 20 updates per second.

The sound effects and ambient ocean are synthesized in Web Audio after the first user interaction. Ship silhouettes, water texture, islands, and hit effects are drawn from original code rather than borrowed game assets.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Render setup. The included `render.yaml` builds and runs the single service, and the service health check uses `/health`. A deploy creates a Render-provided HTTPS URL; the client connects to Socket.IO on the same host using the browser's secure connection.
