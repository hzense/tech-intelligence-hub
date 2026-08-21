# HZense Web

The HZense Technology Intelligence web application, built with Next.js App Router.

## Local development

From the repository root:

```bash
corepack enable
pnpm install
pnpm --filter @hzense/web dev
```

The initial MVP includes the responsive home experience, technology radar, theme toggle,
Daily index, and a historical seed briefing route.

## Styling conventions

HZense uses semantic CSS classes and centralized design tokens as its primary styling
convention. Tailwind remains available in the toolchain, but new interface work should
follow the existing semantic class system unless the team explicitly decides to migrate.
