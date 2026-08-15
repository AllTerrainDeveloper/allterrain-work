=== AllTerrain Work - Kanban Project & Task Boards for OpenStation ===
Contributors: allterraindeveloper
Tags: project management, kanban, task management, todo, openstation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Requires Plugins: desktop-mode
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Kanban project and task boards for the OpenStation desktop. Drag cards between columns, attach any post, assign by drag. Every task is a post.

== Description ==

**AllTerrain Work is a project and task manager shaped like a Monday or Trello
board, built as a real desktop app for [OpenStation](https://wordpress.org/plugins/desktop-mode/).**

A column per status. A card per task. Drag a card and it moves. Filter by
project, by "assigned to me", or by typing. Add tasks inline at the foot of any
column, and add columns when your process needs one.

Two decisions shape everything else.

= Everything is an ordinary WordPress object =

A project is a post. A task is a post. A status is a term. A comment is a
comment. Nothing lives in a bespoke table.

That is not nostalgia, it is what you get for free: the REST API, user
capabilities, revisions, autosave, search, the trash, the Comments screen, and
every plugin you already run that hooks `save_post` all work on your work
immediately, with no integration layer. Export it, back it up, query it with
WP_Query, edit a task in the block editor. It is your data, in the place
WordPress keeps data.

Uninstalling the plugin does not delete any of it.

= The board is a native desktop window, not an iframe =

It renders into OpenStation's own DOM, which is what gives it the shell's
pointer pipeline - the same one the desktop's file tiles ride. That is the
difference between a board you can drag cards around inside, and a board that
is part of your desktop:

* **Drag a card between columns** to change its status - drop it on another
  card and the pointer's height picks its place in the order.
* **Drag any post, page, product, image or custom post type onto a card** and
  it is attached, with a link straight to it. One field covers every type,
  because attachments are stored as post IDs.
* **Drag a user onto a card** to assign the task to them.
* **Open a project straight from WP Explorer**, with the board already filtered
  to it.

= Assign work three ways =

A searchable picker on every card, the block editor sidebar, or a user dragged
from WP Explorer. All three take the same write path, and the picker only lists
people who can actually be given work.

= Talk about the work =

Every card has a comment thread, opened beside the card so a remark does not
become an errand. They are ordinary WordPress comments, so the admin Comments
screen moderates them like any other.

= See only what is yours =

A **My Work** widget lists your own open tasks, soonest first, with overdue
counted separately and a project picker that remembers what you chose. It
updates the moment anyone moves a card - including from another browser.

= Built for AI assistants, properly =

With the WordPress Abilities API available, AllTerrain Work registers
**14 typed abilities**: list, create, update, move, assign, comment, attach and
trash projects and tasks. Each one runs the same permission check a person
gets, over the same code the board uses, so an assistant can never reach
something a user could not.

= Everything is hookable =

Filters and actions on the board data, the REST responses, the Explorer
previews and the shell surfaces. Full reference in the
[GitHub repository](https://github.com/AllTerrainDeveloper/allterrain-work).

== Installation ==

AllTerrain Work requires [OpenStation](https://wordpress.org/plugins/desktop-mode/).
WordPress 6.5 and above will not activate this plugin until OpenStation is
installed and active.

1. Install and activate **OpenStation**.
2. Install **AllTerrain Work** from the Plugins screen, or upload it to
   `/wp-content/plugins/allterrain-work`.
3. Activate it. Four statuses are created if the site has none: Not started,
   Working on it, Stuck, Done.
4. Open the board from its desktop icon, its dock tile, or the command palette.

== Frequently Asked Questions ==

= Do I need OpenStation? =

Yes. The board opens as a window on the OpenStation desktop, and dragging cards
between columns, dropping a page onto a task to attach it and dropping a user
onto a card to assign it are all the shell's pointer pipeline. The plugin
declares OpenStation as a dependency, so WordPress 6.5 and above will not
activate it until OpenStation is active.

Your projects and tasks are ordinary posts, so if OpenStation is ever
deactivated the data stays exactly where it was and comes back with it.

= Does uninstalling delete my tasks? =

No. Projects and tasks are posts and are left exactly where they are.
Reinstalling brings them all back, including their columns and ordering.

= Can I use it with the block editor? =

Yes. Tasks and projects open in the block editor with a **Work** panel in the
document sidebar: status, assignee, due date and priority for a task; lead,
start and target dates and a colour for a project. Rename a project there and
every chip on the board follows without a reload.

= Is my data locked into this plugin? =

No, and that is the point of building it on posts. Everything is queryable with
`WP_Query`, readable over the REST API, included in a standard WordPress
export, and visible to any other plugin. There is no proprietary table to
migrate out of.

= Does it work on mobile? =

The board is a desktop interface and expects a pointer. It follows OpenStation
on whatever devices the shell supports.

= How many people can use one board? =

As many as the site has. Changes are broadcast between windows and browsers, so
two people moving cards see each other's work without reloading.

== Screenshots ==

1. The board: a column per status, a card per task. Drag a card to move it,
   filter by project or by "assigned to me", and add tasks inline.
2. A card carries its project, due date, comment count and assignee - and the
   posts and pages attached to it.
3. Comments open beside the card, as an ordinary WordPress comment thread.
4. Projects and tasks in WP Explorer, with previews showing status, assignee,
   due date and priority, and a button that opens the board filtered to that
   project.
5. The Work panel in the block editor: status, assignee, due date and priority
   on the task itself.

== Changelog ==

= 0.1.0 =
* First release: projects, tasks and statuses; the drag-and-drop board with
  attachments, assignment and comments; the REST namespace; 14 WordPress
  Abilities; block editor panels; WP Explorer integration; and the OpenStation
  native window, desktop icon, command and My Work widget.
