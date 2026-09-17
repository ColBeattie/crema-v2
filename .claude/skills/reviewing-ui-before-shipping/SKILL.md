---
name: reviewing-ui-before-shipping
description: Use when about to call a screen finished, hand UI to a client, or say a feature is done — especially when typecheck, lint, tests and build are all green. Covers dropdowns that cannot be searched, records that cannot be deleted, destructive actions with no confirmation, raw validator output shown to users, emails shown where names belong, saves with no feedback, and lists whose order changes.
---

# Reviewing UI before shipping

## Overview

A green build says the code runs. It says nothing about whether the screen can
be used. Every item below comes from a real review where the suite was green
and the feature was unusable.

**The core test: open the page as a signed-in user and do the thing.** Not
`curl`, not a unit test, not "it compiles". Fifteen minutes of clicking finds
what a thousand tests do not.

## When to use

- Before saying a screen is done, or handing a build to a client
- Reviewing someone else's UI work
- After adding any picker, dialog, list, or destructive action

Not for: back-end-only changes with no screen, or internal debug pages nobody
but you will open.

**Not the same job as a design skill.** A design skill decides how a screen
should look — style, palette, type, spacing, accessibility (we suggest
`ui-ux-pro-max`; ask Víctor for it if you don't have it installed). This one
checks that the screen works before somebody else opens it. Use both: design
with that, hand over with this.

## The checklist

Run every row. Each one is a question with a yes/no answer.

| #   | Check                                                                                                                                                             | Failure it catches                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Can every picker be **typed into and filtered**?                                                                                                                  | A twenty-item `<select>` scrolled by hand                                                                        |
| 2   | Do pickers **restrict to the list** where inventing a value is wrong (people, statuses) and **allow free text** where a genuine one-off exists (a model, a note)? | A colleague invented by a typo, silently                                                                         |
| 3   | Does a picker inside a dialog **render above it**?                                                                                                                | Native `<dialog>` is in the browser's top layer; a portal to `document.body` renders underneath                  |
| 4   | Does every list you can pick from work with **arrows and Enter**?                                                                                                 | Mouse-only autocomplete. Hands are already on the keyboard                                                       |
| 5   | Can everything that can be **created** also be **removed**?                                                                                                       | Uploads with no delete; rows only an admin can remove                                                            |
| 6   | Does deleting say **what else goes with it**?                                                                                                                     | "Are you sure?" on a cascade that takes a year of history                                                        |
| 7   | Is confirmation **proportionate**? Inline for one line; typing the record's name for a cascade                                                                    | A Yes/No box is too easy to click through                                                                        |
| 8   | Can every state be **unset**? Marked paid → unpaid, done → not done                                                                                               | And can you still find the row afterwards — did it leave the tab you were on?                                    |
| 9   | Do errors say **what is wrong and what to do**?                                                                                                                   | Raw validator JSON; "an internal server error occurred"                                                          |
| 10  | Do you see a **person's name**, never an email or an id?                                                                                                          | The fallback that skips straight to the email address                                                            |
| 11  | Does a save with **no visible consequence** say it saved?                                                                                                         | Setting a threshold that changes nothing on screen reads as broken                                               |
| 12  | Does every list have an **explicit, deliberate `ORDER BY`** so its order is stable?                                                                               | A query with no `ORDER BY` returns rows in arbitrary order: an updated row moves, so editing reshuffles the list |
| 13  | Does each field **validate what it is for**?                                                                                                                      | An email box that accepts `asdf`                                                                                 |
| 14  | Does creating a record say **which field is missing**?                                                                                                            | A generic failure at the end of a multi-step form                                                                |
| 15  | Is the copy written for **whoever reads it**, not for the one person you were talking to?                                                                         | Text about "the client database" shown to the client                                                             |

## Two rules behind most of the list

**Reversible by the person who did it.** Not just by an admin. The someone who
uploaded the wrong file to the wrong job is the someone who needs to undo it.
Own-or-admin is usually the right rule, and it belongs in the database, not in
a hidden button: a policy is a rule, a hidden button is a suggestion.

**An error is a sentence addressed to a person.** It names what is wrong, in
their words, and what to do next. If it contains a stack trace, a column name,
a `{`, or the word "internal", it is not finished.

## Why the suite does not catch these

Typecheck, lint, tests and build all pass on every failure above. Two reasons
worth knowing:

- A page that is `force-dynamic` renders nothing at build time, so a runtime
  error — a function passed to a client component, a missing column — is
  invisible until somebody loads it.
- An unauthenticated `curl` gets a 307 to the login page. That is a green
  check that never reached the code under test.

**If the suite has no test that opens an authenticated page, it cannot catch
any of this. Say so rather than reporting green.**

## Red flags

- "The build is green" as evidence a screen works
- "I tested the query" instead of "I used the screen"
- A confirmation dialog you wrote but never clicked
- A dropdown you added but never opened
- Any sentence starting "it should work"

## Common mistakes

**Fixing the instance, not the class.** A function prop broke one page; the
same shape broke another nobody had opened yet. When you find one, grep for
the pattern before saying it is fixed.

**Guarding the case you thought of.** A trigger refused to log a deleted
project, but not the tasks that cascade with it. Write the guard for the rule,
not for the symptom.

**Treating "cannot reproduce" as "works".** If you cannot open the page as a
user, you have not verified it. Ask someone who can, and say what you did and
did not check.
