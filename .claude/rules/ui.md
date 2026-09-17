# UI Rules

- When making UI, keep mobile responsiveness in mind.
- Every new page/component must work in BOTH light and dark mode. Prefer theme tokens (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`) over hardcoded colors (`bg-white`, `text-black`); if you hardcode, add a `dark:` variant. Theme is class-based (`.dark` on `<html>`) and follows the OS preference by default (`components/theme-provider.tsx`).
- Do not use browser native pop ups. Always create a styled pop up in the same style as the other pop ups of the system.
- Do not use browser native hover tooltips. Always create a custom instant hover tooltip rendered in the screen.
- When showing a pop up inside a table or list, ensure it has proper z-index so it is not overlapped by other rows or UI elements.
- When setting up or deploying an app, ensure Open Graph meta tags (title, description, image) are configured in the root layout metadata for proper social sharing previews (WhatsApp, Slack, etc.). Recommended OG image size: 1200x630px.
- Every data-fetching component should handle three states: loading, empty, and error — not just the happy path. Use skeleton loaders instead of spinners where possible.
- All interactive elements must be keyboard accessible. Images need alt text, form inputs need labels, buttons need descriptive text (not just icons). Use semantic HTML elements (`nav`, `main`, `section`, `button`) instead of generic `div` with click handlers.
- Error messages must use a solid red background (`bg-red-600`) with white text (`text-white`). Do not use subtle/light red backgrounds (`bg-red-50`) for errors — they need to be immediately obvious.
