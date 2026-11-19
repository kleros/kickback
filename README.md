# Kickback

Book an event with a refundable deposit. Everyone who comes gets it back, plus an equal share of the no-shows' deposits. Attendance disputes are settled by Kleros Court.

The web app (`apps/web`, Next.js) runs on the Proof of Presence protocol on Ethereum mainnet: a factory with no owner that creates one fixed contract per event (ETH or any ERC-20 deposit, bookings open until the event ends, Kleros challenges always on). Addresses: `packages/contracts/deployments-live/ethereum.json`.

## Run

```bash
yarn install
cp apps/web/.env.example apps/web/.env.local   # set NEXT_PUBLIC_REOWN_PROJECT_ID
yarn dev
```

## Host

Any Next.js host, with the app directory `apps/web` and the variable `NEXT_PUBLIC_REOWN_PROJECT_ID` (a Reown project that allows the site's domain). Production builds default to Ethereum mainnet. `apps/web/netlify.toml` holds the Netlify settings; on Vercel set the root directory to `apps/web`.

Powered by Kleros. MIT licence.
