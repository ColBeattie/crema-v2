---
name: comments
description: Question-driven setup of this project's comment system — threads on records with @mentions and a central inbox of your mentions and replies. Use when the app needs collaboration or discussion on records, or the user asks for comments, notes, mentions, or an inbox.
---

# /comments — design this project's comment system

Comments are not prebuilt in the template because every app attaches them to
different records with different audiences. This skill designs the system for
THIS project through questions, then guides the build. Do not build ad-hoc
comment features outside this skill.

## Non-negotiables

Every Productivity Tools comment system has these, so they are never asked:

- **@mentions** of members by name, through a picker that is typed-into and
  filtered, works with arrows and Enter, and restricts to the member list
  (checklist rows 1–4 of `reviewing-ui-before-shipping`).
- Reachable from **both ends**: a thread on the record itself, AND a central
  inbox listing your mentions and the replies to your comments, with
  read/unread state.
- **Replies** — a comment can answer another comment.
- Authors can **edit and delete their own comments** ("reversible by the
  person who did it"), enforced in RLS, not by hiding buttons.
- House rules apply: naming per `naming.md` (`snake_case`, singular tables,
  `_at`, `_id`), migrations in `/sql` + the SQL Files Log, RLS with
  ownership/role predicates per `database.md`, UI from the resource inventory,
  and the `reviewing-ui-before-shipping` checklist before calling it done.

## Step 1 — look at the project first

Before asking anything, gather real candidates so the questions come
pre-filled (same approach as `/start`):

- Which entity tables exist? (`grep -l "create table" sql/` and the schema) —
  these are the things people would comment on.
- What roles exist and whether the app has external (client) logins — read
  the support entitlement decision in `app/api/support-token/route.ts` and
  `CLAUDE.md`; it usually answers who "the team" is.
- What the sidebar and any existing notification surface look like
  (`app/components/Sidebar.tsx`) — the inbox should live where people already
  look.

## Step 2 — ask the scoping questions

Use AskUserQuestion (max 4 per call, options pre-filled from step 1, your
recommendation marked and justified). First call:

1. **Who participates** — internal staff only (Recommended when client logins
   exist: comments are usually internal notes) / staff + clients with a
   per-comment internal-vs-shared flag / everyone with access to the record.
   This decides the RLS design, so it goes first.
2. **Which records get comments** — list the real entity tables found in
   step 1. Few (≤3) → a dedicated `comment` table per entity or one table
   with nullable FKs; many/growing → one polymorphic `comment` table
   (`entity_type` + `entity_id`). Recommend based on the actual count.
3. **Who sees a comment** — everyone who can see the record (Recommended —
   inherits the record's RLS) / participants of the thread only.
4. **Where the inbox lives** — a Sidebar entry with an unread badge
   (Recommended) / a page linked from the profile menu / merged into an
   existing notifications surface if step 1 found one.

Second call, only what's still open:

5. **Notifications beyond the inbox** — none (Recommended: the badge is
   enough to start) / email via `lib/email/postmark.ts` for mentions.
6. **Extras** — resolve/close threads? Default NO: reactions, attachments and
   read-receipts-per-person are YAGNI until a real need shows up.

Echo the answers back in one line before building, so a wrong guess costs one
correction.

## Step 3 — schema and RLS

Design within these rails and show the SQL before running anything:

- Tables: `comment` (body, author `user_id`, the record reference from Q2,
  `parent_comment_id` for replies, `created_at`, `updated_at`), and
  `comment_mention` (`comment_id`, `mentioned_user_id`, `read_at`). Replies
  to your comment surface in the inbox via `parent_comment_id` + author.
- The inbox query is "mentions of me, unread first" plus "replies to my
  comments" — make sure both have an explicit `ORDER BY` and the indexes to
  match.
- RLS per the Q1/Q3 answers: SELECT inherits the record's visibility (never
  `USING (true)`), INSERT requires the author to be the session user, UPDATE
  and DELETE are own-rows-only (author edits/deletes their own; a role does
  not override ownership without an explicit decision). Store roles from
  `app_metadata`, never `user_metadata`.
- Write it as `/sql/NNNN_create-comment-system.sql` (next free prefix,
  idempotent, transactional), append it to the SQL Files Log in `CLAUDE.md`,
  and run the Supabase security advisor after applying.

## Step 4 — UI from the inventory

Check `documentation/resources.md` first, as always. The expected mapping:

- Mention picker: `command.tsx` inside `popover.tsx`, triggered by `@` in the
  composer — names, never emails (checklist row 10).
- Thread on the record: a shared `CommentThread` component under
  `app/components/`, so every entity renders comments the same way.
- Inbox: one page, reusing the same thread components; Sidebar entry with the
  unread count; clicking an item lands on the record with the comment in view.
- States per `ui.md`: loading (skeleton), empty (`empty.tsx` — an inbox with
  no mentions is the normal first-run state), and error (solid-red style).
- Both themes, keyboard accessible, no native popups.

## Step 5 — verify and register

- Run the `reviewing-ui-before-shipping` checklist on every surface you
  touched — the mention picker and the inbox hit rows 1–4, 5, 9–12 directly.
- Register `CommentThread`, the inbox page and the mention picker in
  `documentation/resources.md` in the same change.
- Report: the decisions taken (echoed from step 2), the migration file
  waiting to be run, and what still needs a human — running the SQL in the
  Supabase editor and one real two-user test (mention a colleague, see it
  arrive in their inbox).
