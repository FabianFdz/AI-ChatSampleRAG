# E5: Frontend Setup

## Goal
Next.js application with TypeScript, TailwindCSS, and development tooling configured for RAG UI.

## Scope
Frontend project initialization:
- Next.js 14 with App Router architecture
- Strict TypeScript configuration
- TailwindCSS for styling and design system
- ESLint + Prettier for code quality
- Environment configuration for API connection
- Base layout, navigation, and page structure
- Development server and build tooling

## Depends on
None (parallel with backend)

## Priority
must-have

## To settle
- Component library (shadcn, Headless UI, Mantine)?
- State management (useState, Context, Zustand)?
- API client library (fetch, axios, SWR)?
- Dark mode support?

---

## Acceptance Criteria
- [ ] `pnpm dev` starts dev server on port 3000
- [ ] TypeScript compiles with zero errors
- [ ] TailwindCSS styles load and render correctly
- [ ] Base layout includes header, main content area, footer
- [ ] No build warnings
- [ ] Environment variables configure backend API URL

## Notes
Can be developed in parallel with backend. Foundation for E6 and E7.
