(function() {
  "use strict";
  function today() {
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  function isOverdue(due) {
    return !!due && due < today();
  }
  function formatDue(due) {
    if (!due) {
      return "";
    }
    if (due === today()) {
      return "Today";
    }
    const [year, month, day] = due.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(void 0, {
      month: "short",
      day: "numeric"
    });
  }
  const KEY = "allterrain-work/focus";
  function store() {
    const create = window.wp?.os?.createSharedStore;
    if (!create) {
      return null;
    }
    return create(KEY, () => ({ projectId: 0, requestedAt: 0 }));
  }
  function requestProjectFocus(projectId) {
    const shared = store();
    if (!shared) {
      return;
    }
    shared.state.projectId = projectId;
    shared.state.requestedAt += 1;
    shared.notify();
  }
  const TASK_SECTION = "cpt-atwork-task";
  const PROJECT_SECTION = "cpt-atwork-project";
  const META = {
    project: "_atwork_project",
    owner: "_atwork_owner",
    due: "_atwork_due",
    priority: "_atwork_priority",
    source: "_atwork_source",
    lead: "_atwork_lead",
    start: "_atwork_start",
    target: "_atwork_target",
    state: "_atwork_state",
    color: "_atwork_color"
  };
  const STATE_LABELS = {
    planning: "Planning",
    active: "Active",
    "on-hold": "On hold",
    done: "Done"
  };
  const hooks = window.wp?.hooks;
  const config = window.allTerrainWork;
  const statuses = new Map(
    (config?.statuses ?? []).map((status) => [
      status.id,
      { name: status.name, color: status.color, order: status.order }
    ])
  );
  function statusOf(item) {
    const terms = item[config?.statusField ?? "atwork-statuses"];
    return Array.isArray(terms) && terms.length ? Number(terms[0]) : 0;
  }
  function metaString(item, key) {
    const value = item.meta?.[key];
    return value === void 0 || value === null ? "" : String(value);
  }
  function metaNumber(item, key) {
    const value = Number(item.meta?.[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }
  function row(label, value, modifier = "") {
    const line = document.createElement("div");
    line.className = `atwork-preview__row ${modifier}`.trim();
    const key = document.createElement("span");
    key.className = "atwork-preview__label";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = "atwork-preview__value";
    if (typeof value === "string") {
      val.textContent = value;
    } else {
      val.appendChild(value);
    }
    line.append(key, val);
    return line;
  }
  function statusChip(name, color) {
    const chip = document.createElement("span");
    chip.className = "atwork-preview__chip";
    chip.style.setProperty("--atwork-chip-color", color);
    chip.textContent = name;
    return chip;
  }
  const rowCache = /* @__PURE__ */ new Map();
  function withFields(item) {
    if (item.meta && item[config?.statusField ?? ""] !== void 0) {
      return Promise.resolve(item);
    }
    const cached = rowCache.get(item.id);
    if (cached) {
      return cached;
    }
    const root = window.wpApiSettings?.root ?? "/wp-json/";
    const field = config?.statusField ?? "";
    const url = `${root.replace(/\/$/, "")}/wp/v2/atwork-tasks/${item.id}?_fields=id,meta${field ? "," + field : ""}`;
    const promise = fetch(url, { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).then((row2) => row2 ? { ...item, ...row2 } : item).catch(() => item);
    rowCache.set(item.id, promise);
    return promise;
  }
  const userNames = /* @__PURE__ */ new Map();
  function userName(id) {
    if (!id) {
      return Promise.resolve("");
    }
    const cached = userNames.get(id);
    if (cached) {
      return cached;
    }
    const root = window.wpApiSettings?.root ?? "/wp-json/";
    const promise = fetch(`${root.replace(/\/$/, "")}/wp/v2/users/${id}?_fields=name`, {
      credentials: "same-origin"
    }).then((response) => response.ok ? response.json() : null).then((user) => user?.name ?? "").catch(() => "");
    userNames.set(id, promise);
    return promise;
  }
  function windowLink(label, url, title) {
    const link = document.createElement("a");
    link.className = "atwork-preview__link";
    link.href = url;
    link.textContent = label;
    link.addEventListener("click", (event) => {
      const os = window.wp?.os;
      if (!os?.deriveWindowId || !os.windowManager?.open || event.metaKey || event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const id = os.deriveWindowId(url);
      os.windowManager.open({ id, baseId: id, url, title, icon: "dashicons-yes-alt" });
    });
    return link;
  }
  if (hooks?.addFilter && hooks.addAction && config) {
    let renderTaskPreview = function(ctx) {
      const block = document.createElement("div");
      block.className = "atwork-preview";
      ctx.container.appendChild(block);
      void withFields(ctx.item).then((item) => paintTask(block, item));
    }, paintTask = function(block, item) {
      const statusId = statusOf(item);
      const chipHost = document.createElement("span");
      const status = statuses.get(statusId);
      if (status) {
        chipHost.appendChild(statusChip(status.name, status.color));
        block.appendChild(row("Status", chipHost));
      }
      const ownerId = metaNumber(item, META.owner);
      if (ownerId) {
        const nameHost = document.createElement("span");
        nameHost.textContent = "…";
        block.appendChild(row("Assignee", nameHost));
        void userName(ownerId).then((name) => {
          nameHost.textContent = name || `#${ownerId}`;
        });
      }
      const due = metaString(item, META.due);
      if (due) {
        block.appendChild(
          row("Due", formatDue(due), isOverdue(due) ? "is-overdue" : "")
        );
      }
      const priority = metaString(item, META.priority);
      if (priority && priority !== "medium") {
        block.appendChild(row("Priority", priority.charAt(0).toUpperCase() + priority.slice(1)));
      }
      const sourceId = metaNumber(item, META.source);
      if (sourceId) {
        block.appendChild(
          row(
            "About",
            windowLink(
              "Open the linked post",
              `${config.adminUrl.replace(/\/$/, "")}/post.php?post=${sourceId}&action=edit`,
              "Linked post"
            )
          )
        );
      }
    }, renderProjectPreview = function(ctx) {
      const block = document.createElement("div");
      block.className = "atwork-preview";
      ctx.container.appendChild(block);
      if (ctx.item.meta) {
        paintProject(block, ctx.item);
        return;
      }
      const root = window.wpApiSettings?.root ?? "/wp-json/";
      void fetch(`${root.replace(/\/$/, "")}/wp/v2/atwork-projects/${ctx.item.id}?_fields=id,meta`, {
        credentials: "same-origin"
      }).then((response) => response.ok ? response.json() : null).then((row2) => paintProject(block, row2 ? { ...ctx.item, ...row2 } : ctx.item)).catch(() => void 0);
    }, paintProject = function(block, item) {
      const state = metaString(item, META.state) || "active";
      block.appendChild(row("State", STATE_LABELS[state] ?? state));
      const leadId = metaNumber(item, META.lead);
      if (leadId) {
        const nameHost = document.createElement("span");
        nameHost.textContent = "…";
        block.appendChild(row("Lead", nameHost));
        void userName(leadId).then((name) => {
          nameHost.textContent = name || `#${leadId}`;
        });
      }
      const start = metaString(item, META.start);
      const target = metaString(item, META.target);
      if (start) {
        block.appendChild(row("Starts", formatDue(start)));
      }
      if (target) {
        block.appendChild(row("Target", formatDue(target), isOverdue(target) ? "is-overdue" : ""));
      }
      const colour = metaString(item, META.color);
      if (colour) {
        const swatch = document.createElement("span");
        swatch.className = "atwork-preview__swatch";
        swatch.style.setProperty("--atwork-chip-color", colour);
        const label = document.createElement("span");
        label.textContent = colour;
        const wrap = document.createElement("span");
        wrap.className = "atwork-preview__colour";
        wrap.append(swatch, label);
        block.appendChild(row("Colour", wrap));
      }
    };
    hooks.addAction(
      "os.my-wordpress.preview-extras",
      "allterrain-work/preview",
      (ctx) => {
        if (ctx.slot !== "meta") {
          return;
        }
        if (ctx.entityId === TASK_SECTION) {
          renderTaskPreview(ctx);
        } else if (ctx.entityId === PROJECT_SECTION) {
          renderProjectPreview(ctx);
        }
      }
    );
    hooks.addAction(
      "os.my-wordpress.preview-extras",
      "allterrain-work/preview-board-link",
      (ctx) => {
        if (ctx.slot !== "footer" || ctx.entityId !== TASK_SECTION && ctx.entityId !== PROJECT_SECTION) {
          return;
        }
        const os = window.wp?.os;
        if (!os?.openWindow) {
          return;
        }
        const projectId = ctx.entityId === PROJECT_SECTION ? Number(ctx.item.id) : metaNumber(ctx.item, META.project);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "atwork-preview__board";
        button.textContent = projectId ? "Open this project on the board" : "Open the work board";
        button.addEventListener("click", () => {
          if (projectId) {
            requestProjectFocus(projectId);
          }
          os.openWindow?.("allterrain-work", { source: "wp-explorer" });
        });
        ctx.container.appendChild(button);
      }
    );
    hooks.addFilter(
      "os.my-wordpress.list-bands",
      "allterrain-work/by-status",
      (banding, entity) => {
        if (entity.id !== TASK_SECTION) {
          return banding;
        }
        if (!statuses.size) {
          return banding;
        }
        const bands = [...statuses.entries()].map(([id, status]) => ({
          id: String(id),
          label: status.name,
          order: status.order
        })).sort((a, b) => a.order - b.order);
        bands.push({ id: "unfiled", label: "No status", order: 9999 });
        return {
          bands,
          assign: (item) => {
            const id = statusOf(item);
            return id && statuses.has(id) ? String(id) : "unfiled";
          }
        };
      }
    );
    hooks.addAction(
      "os.my-wordpress.list-tile",
      "allterrain-work/overdue-marker",
      (ctx) => {
        if (ctx.entityId !== TASK_SECTION || !ctx.tile) {
          return;
        }
        const due = metaString(ctx.item, META.due);
        if (!due || !isOverdue(due)) {
          return;
        }
        ctx.tile.classList.add("atwork-tile--overdue");
        ctx.tile.title = `Overdue — was due ${formatDue(due)}`;
      }
    );
  }
})();
