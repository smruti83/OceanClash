# Deployment guide

## Render Blueprint

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect the repository, and apply the checked-in `render.yaml`.
3. Wait for the build and health check to complete. Render publishes an `https://…onrender.com` URL; share that URL with players. Socket.IO uses WSS automatically through the same HTTPS origin.
4. Open the public URL in two separate browsers, create a private room, and join with its room code to confirm the live service.

The Blueprint runs one Node web service, which is required while room state is in memory. It has no database, private key, or frontend secret to configure. `/health` returns `{ status, rooms, uptime }`.

## Free-tier limits

Render's free web services support WebSockets but have limited compute, restart behavior, idle spin-down, and no horizontal scaling or persistent disk. The current docs state that an idle free service spins down after 15 minutes without inbound HTTP or WebSocket messages, may take about a minute to start again, and receives 750 free instance hours per workspace per month. Render describes free instances as suitable for hobby projects and testing, not production. A restart clears all in-memory rooms and match state. Check the current [free instance limits](https://render.com/docs/free) and [WebSocket behavior](https://render.com/docs/websocket) before publishing.

For a continuously available public game, move the web service to an always-on plan. Before adding more than one server instance, implement shared room state and a Socket.IO adapter; the current in-memory engine must run as a single instance.

## Other Node hosts

The source also runs on any Node host that provides a long-lived process and WebSocket upgrades. Use `npm ci`, `npm run build`, and `npm start`, and configure the platform to route HTTPS requests and WebSocket upgrades to the same `$PORT`. Set `NODE_ENV=production`; do not set `VITE_*` secrets, because none are needed by this game.
