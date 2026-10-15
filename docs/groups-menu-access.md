# When Housing does not offer group management

Some accounts receive a Housing Menu without a **Permissions and Groups**
entry. HTSW now finishes reading that menu and reports the missing entry
immediately. Previously it waited six more seconds for a window that no click
had requested, then reported a menu-load timeout.

The account's displayed group does not establish what this menu allows. The
recorded Humanity failure stopped before opening a group list or clicking
Owner. It does not prove that Co-Owner can or cannot edit the Owner group.
Ask the house owner to grant group-management access or apply the requested
group changes. HTSW does not guess another menu route or silently ignore
requested settings.

An import that does not declare or depend on groups already avoids the group
scan. Valid trusted group caches also skip their scan through the existing
trust path. Without a readable menu or a trusted baseline, HTSW cannot establish
that a declared group's settings are unchanged, or even that the group exists.

## In-game checklist for Callan / Elijah

1. In the intended house, open `/hmenu` as the house owner. Record its title
   and whether **Permissions and Groups** appears.
2. Repeat as one of the Co-Owner bots. If the entry is missing, check the
   account's group-management permissions with the owner. Record any permission
   change and reopen `/hmenu`.
3. If the entry appears, open it and record the group-list title and items.
   Click **Owner** once. Record the resulting menu or the exact refusal in chat.
   Do not change settings during this access check.
4. With an account that still lacks the entry, run an isolated import that
   requests an Owner-group change. Expect a clear missing-entry message naming
   the group in the failed step, with no menu click and no house change.
5. Run an isolated import with no group declarations or group dependencies.
   Expect it to proceed without opening `/hmenu` for groups.

Retain the menu dumps and packet/chat logs. An Owner-only editing rule remains
unconfirmed until step 3 is observed. Any automated live check belongs to the
headless box runner under its safety rules; this fix was tested offline only.
