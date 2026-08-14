(function() {
  "use strict";
  const CHANGE_TOPICS = ["os.atwork-task.changed", "os.atwork-project.changed"];
  const BROADCAST_SOURCE = `allterrain-work/${Math.random().toString(36).slice(2, 10)}`;
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  }
  function getConfig() {
    const config = window.allTerrainWork;
    if (!config || !config.restUrl) {
      throw new Error(
        "[allterrain-work] window.allTerrainWork is missing. The `allterrain-work-config` script handle was not enqueued on this page."
      );
    }
    return config;
  }
  function getShell() {
    const wp = window.wp;
    return wp?.os ?? null;
  }
  async function request(path, init = {}, silent = false) {
    const config = getConfig();
    const shell = getShell();
    const url = config.restUrl.replace(/\/$/, "") + path;
    const headers = {
      Accept: "application/json",
      ...init.headers ?? {}
    };
    if (init.body) {
      headers["Content-Type"] = "application/json";
    }
    if (!shell?.fetch) {
      headers["X-WP-Nonce"] = config.nonce;
    }
    const options = { credentials: "same-origin", ...init, headers };
    const response = shell?.fetch ? await shell.fetch(url, options, { source: "allterrain-work", silent }) : await fetch(url, options);
    if (!response.ok) {
      let message = response.statusText || "Request failed";
      let code = "atwork_request_failed";
      try {
        const body = await response.json();
        message = body.message ?? message;
        code = body.code ?? code;
      } catch {
      }
      throw new ApiError(message, code, response.status);
    }
    if (response.status === 204) {
      return void 0;
    }
    return await response.json();
  }
  function fetchMyWork(projects = [], limit = 25, silent = false) {
    const params = new URLSearchParams();
    projects.forEach((id) => params.append("projects[]", String(id)));
    params.set("limit", String(limit));
    return request(`/my-work?${params.toString()}`, {}, silent);
  }
  function onChange(cb) {
    const shell = getShell();
    if (!shell?.subscribe) {
      return () => void 0;
    }
    const listener = (payload) => {
      if (payload?.source === BROADCAST_SOURCE) {
        return;
      }
      cb();
    };
    const unsubscribes = CHANGE_TOPICS.map((topic) => shell.subscribe(topic, listener));
    return () => unsubscribes.forEach((off) => off());
  }
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
  function openInShell(url, title, icon = "dashicons-admin-post") {
    const shell = getShell();
    if (!url || !shell?.windowManager?.open || !shell.deriveWindowId) {
      return false;
    }
    try {
      const id = shell.deriveWindowId(url);
      void shell.windowManager.open({ id, baseId: id, url, title, icon });
      return true;
    } catch {
      return false;
    }
  }
  function routeLinkIntoShell(anchor, title, icon) {
    anchor.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (openInShell(anchor.href, title, icon)) {
        event.preventDefault();
      }
    });
    anchor.addEventListener("pointerdown", (event) => event.stopPropagation());
  }
  const WIDGET_ID = "allterrain-work/my-work";
  const POLL_MS = 3e5;
  const PICKED_KEY = "projects";
  async function mount(container, ctx) {
    let destroyed = false;
    let picked = ctx.storage.get(PICKED_KEY) ?? [];
    const root = document.createElement("div");
    root.className = "atwork-widget";
    container.appendChild(root);
    const header = document.createElement("div");
    header.className = "atwork-widget__header";
    root.appendChild(header);
    const counts = document.createElement("div");
    counts.className = "atwork-widget__counts";
    header.appendChild(counts);
    const filterButton = document.createElement("button");
    filterButton.type = "button";
    filterButton.className = "atwork-widget__filter";
    filterButton.setAttribute("aria-expanded", "false");
    filterButton.setAttribute("aria-label", "Choose projects");
    filterButton.textContent = "Projects";
    header.appendChild(filterButton);
    const picker = document.createElement("div");
    picker.className = "atwork-widget__picker";
    picker.hidden = true;
    root.appendChild(picker);
    const list = document.createElement("ul");
    list.className = "atwork-widget__list";
    root.appendChild(list);
    const status = document.createElement("p");
    status.className = "atwork-widget__status";
    status.textContent = "Loading…";
    root.appendChild(status);
    filterButton.addEventListener("click", () => {
      picker.hidden = !picker.hidden;
      filterButton.setAttribute("aria-expanded", String(!picker.hidden));
    });
    const renderPicker = (projects) => {
      picker.replaceChildren();
      if (!projects.length) {
        const none = document.createElement("p");
        none.className = "atwork-widget__picker-empty";
        none.textContent = "No projects yet.";
        picker.appendChild(none);
        return;
      }
      const all = document.createElement("button");
      all.type = "button";
      all.className = "atwork-widget__picker-all";
      all.textContent = picked.length ? "Show all projects" : "Showing all projects";
      all.disabled = !picked.length;
      all.addEventListener("click", () => {
        picked = [];
        ctx.storage.set(PICKED_KEY, picked);
        void refresh();
      });
      picker.appendChild(all);
      for (const project of projects) {
        const label = document.createElement("label");
        label.className = "atwork-widget__picker-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = picked.length === 0 || picked.includes(project.id);
        box.addEventListener("change", () => {
          const base = picked.length ? picked : projects.map((p) => p.id);
          const next = box.checked ? Array.from(/* @__PURE__ */ new Set([...base, project.id])) : base.filter((id) => id !== project.id);
          picked = next.length === projects.length ? [] : next;
          ctx.storage.set(PICKED_KEY, picked);
          void refresh();
        });
        const name = document.createElement("span");
        name.textContent = project.title;
        label.appendChild(box);
        label.appendChild(name);
        picker.appendChild(label);
      }
    };
    const renderCounts = (data) => {
      counts.replaceChildren();
      const pairs = [
        ["Overdue", data.counts.overdue, "is-overdue"],
        ["Today", data.counts.today, "is-today"],
        ["Open", data.counts.total, ""]
      ];
      for (const [label, value, modifier] of pairs) {
        if (!value && modifier) {
          continue;
        }
        const chip = document.createElement("span");
        chip.className = `atwork-widget__count ${modifier}`.trim();
        chip.textContent = `${value} ${label.toLowerCase()}`;
        counts.appendChild(chip);
      }
    };
    const renderList = (tasks, projects) => {
      list.replaceChildren();
      if (!tasks.length) {
        status.textContent = picked.length ? "Nothing open in the projects you picked." : "Nothing assigned to you. Enjoy it.";
        status.hidden = false;
        return;
      }
      status.hidden = true;
      for (const task of tasks) {
        const item = document.createElement("li");
        item.className = "atwork-widget__item";
        const link = document.createElement("a");
        link.className = "atwork-widget__link";
        link.href = task.editUrl || "#";
        link.textContent = task.title;
        routeLinkIntoShell(link, task.title, "dashicons-yes-alt");
        item.appendChild(link);
        const meta = document.createElement("span");
        meta.className = "atwork-widget__item-meta";
        const project = projects.find((p) => p.id === task.projectId);
        if (project) {
          const chip = document.createElement("span");
          chip.className = "atwork-widget__item-project";
          chip.textContent = project.title;
          meta.appendChild(chip);
        }
        if (task.due) {
          const due = document.createElement("span");
          due.className = "atwork-widget__item-due";
          due.textContent = formatDue(task.due);
          if (isOverdue(task.due)) {
            due.classList.add("is-overdue");
          }
          meta.appendChild(due);
        }
        if (meta.childElementCount) {
          item.appendChild(meta);
        }
        list.appendChild(item);
      }
    };
    const refresh = async (silent = true) => {
      if (destroyed) {
        return;
      }
      try {
        const data = await fetchMyWork(picked, 12, silent);
        if (destroyed) {
          return;
        }
        renderCounts(data);
        renderList(data.tasks, data.projects);
        renderPicker(data.projects);
      } catch (error) {
        if (destroyed) {
          return;
        }
        status.hidden = false;
        status.textContent = error instanceof Error ? error.message : "Your work could not be loaded.";
      }
    };
    await refresh(false);
    const unsubscribe = onChange(() => void refresh());
    let timer = null;
    let lastRunMs = Date.now();
    const startPolling = () => {
      if (timer === null) {
        timer = setInterval(() => {
          lastRunMs = Date.now();
          void refresh();
        }, POLL_MS);
      }
    };
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      if (Date.now() - lastRunMs >= POLL_MS) {
        lastRunMs = Date.now();
        void refresh();
      }
      startPolling();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) {
      startPolling();
    }
    return () => {
      destroyed = true;
      stopPolling();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      root.remove();
    };
  }
  try {
    getConfig();
  } catch (error) {
    console.error(error);
  }
  const w = window;
  w.openStationWidgets = w.openStationWidgets ?? {};
  w.openStationWidgets[WIDGET_ID] = mount;
})();
