# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Safe onboarding roles

This app supports two Safe onboarding modes:

- Owner (signer): proposes an on-chain `addOwner` transaction to the configured Safe
- Proposer: registers the user wallet as a Safe delegate (can propose transactions, cannot confirm/execute)

Configure the default behavior with:

- `SAFE_ONBOARDING_ROLE=owner|proposer`
- `SAFE_DELEGATOR_PRIVATE_KEY` (recommended): an EOA that can sign delegate registrations

## Voting

Voting now happens inside ecohubsOS via the internal "Voting" app. There is no
external Snapshot dependency: proposals, votes, and results are stored in the
local SQLite database (see `proposals` / `proposal_votes` tables). Voting is
open to any authenticated user; authoring a new proposal requires Offcoin
Level 3 or higher.
