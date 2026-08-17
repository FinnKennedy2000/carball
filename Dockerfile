# The game server is a long-lived process: a 60 Hz tick loop with rooms held in
# memory. It needs a host that keeps it running between requests, which rules
# out serverless. This image runs anywhere that takes a container — Fly.io,
# Railway, Render — and serves the built client itself, so it is the whole app.
FROM node:24-slim

WORKDIR /app

# NODE_ENV is deliberately not "production" yet: at that setting pnpm skips
# devDependencies, and vite is one, so the build below would not find it.
# Dependencies first, so a source change does not re-resolve the whole tree.
# pnpm-workspace.yaml carries the allowBuilds settings, so it has to be here
# too or the install refuses esbuild's build script.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
# VITE_ vars are read at build time and baked into the bundle, so they must be
# present here rather than only in the runtime environment. Docker warns about
# a key in an ARG; the anon key is meant to be public — it ships in the browser
# bundle either way and RLS is what guards the data. The service key is a
# different matter and is only ever read from the runtime environment.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN pnpm build

# Only dist/ and the server are needed from here on.
RUN pnpm prune --prod
ENV NODE_ENV=production

# server/index.js reads PORT; hosts set it themselves.
EXPOSE 3000
CMD ["node", "server/index.js"]
