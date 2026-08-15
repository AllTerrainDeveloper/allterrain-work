=== AllTerrain Work ===
Contributors: allterraindeveloper
Tags: project management, tasks, kanban, board, openstation
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Projects and tasks on a drag-and-drop board, as an OpenStation desktop app.

== Description ==

A board with a column per status and a card per task. Drag a card between
columns to move it. Filter by project, by "assigned to me", or by typing. Add
tasks inline at the foot of any column.

Everything is an ordinary WordPress object: a project is a post, a task is a
post, a status is a term. Nothing lives in a custom table, so the REST API,
capabilities, revisions, search and the trash all work on your work.

With OpenStation installed, the board is a native desktop window rather than an
iframe -- which is what lets a card be dragged onto other windows on the
desktop. Without OpenStation, the same board renders on its own admin page
under Work.

= Registers WordPress Abilities =

When the Abilities API is available, nine typed abilities let an AI assistant
or MCP client list, create, update, move and trash work -- each one running the
same permission check a person gets.

= Adds a My Work widget =

A desktop widget listing your own open tasks, soonest first, with a picker for
which projects to include. It updates the moment you drag a card on the board.

== Installation ==

1. Upload the plugin to `/wp-content/plugins/allterrain-work`.
2. Activate it through the Plugins screen. Four statuses are created if the
   site has none: Not started, Working on it, Stuck, Done.
3. Open the board from Work in the admin menu, or -- with OpenStation switched
   on -- from its desktop icon or dock tile.

== Frequently Asked Questions ==

= Does uninstalling delete my tasks? =

No. Projects and tasks are posts and are left exactly where they are.
Reinstalling brings them all back, including their columns and ordering.

= Do I need OpenStation? =

Yes. AllTerrain Work is a desktop app: the board opens as a window on the
OpenStation desktop, and dragging cards between columns, dropping a page onto a
task to attach it and dropping a user onto a card to assign it are all the
shell's pointer pipeline. The plugin declares OpenStation as a dependency, so
WordPress 6.5 and above will not activate it until OpenStation is active.

Your projects and tasks are ordinary posts, so if OpenStation is ever
deactivated the data stays exactly where it was and comes back with it.

== Changelog ==

= 0.1.0 =
* First release: projects, tasks, statuses, the drag-and-drop board, the REST
  namespace, nine WordPress Abilities, and the OpenStation native window,
  desktop icon, command and My Work widget.
