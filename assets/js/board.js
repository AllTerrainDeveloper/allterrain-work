(function() {
  "use strict";
  const TASK_PAYLOAD_TYPE = "allterrain-work/task";
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
  function fetchBoard(projectId = 0) {
    const query = projectId > 0 ? `?project=${projectId}` : "";
    return request(`/board${query}`);
  }
  function createTask(input) {
    return request("/tasks", { method: "POST", body: JSON.stringify(input) });
  }
  function updateTask(id, input) {
    return request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }
  function moveTask(id, status, position2) {
    return request(`/tasks/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ status, position: position2 })
    });
  }
  function fetchAssignees(search = "") {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    return request(`/assignees${query}`, {}, true);
  }
  function fetchComments(taskId) {
    return request(`/tasks/${taskId}/comments`, {}, true);
  }
  function addComment(taskId, content) {
    return request(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
  }
  function deleteComment(commentId) {
    return request(`/comments/${commentId}`, { method: "DELETE" });
  }
  function attachToTask(id, ids) {
    return request(`/tasks/${id}/links`, { method: "POST", body: JSON.stringify({ ids }) });
  }
  function detachFromTask(id, linked) {
    return request(`/tasks/${id}/links/${linked}`, { method: "DELETE" });
  }
  function trashProject(id) {
    return request(`/projects/${id}`, { method: "DELETE" });
  }
  function trashTask(id) {
    return request(`/tasks/${id}`, { method: "DELETE" });
  }
  function createProject(title) {
    return request("/projects", { method: "POST", body: JSON.stringify({ title }) });
  }
  function fetchProject(id) {
    return request(`/projects/${id}`);
  }
  function createStatus(name) {
    return request("/statuses", { method: "POST", body: JSON.stringify({ name }) });
  }
  function announceChange(action, ids) {
    getShell()?.broadcast?.(CHANGE_TOPICS[0], { source: BROADCAST_SOURCE, action, ids });
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
  const DRAG_THRESHOLD_PX = 4;
  const CLICK_GUARD_MS = 500;
  class FallbackDragManager {
    constructor() {
      this.targets = [];
      this.active = null;
      this.lastEndMs = 0;
    }
    start(opts) {
      if (this.active || opts.origin.button !== 0) {
        return null;
      }
      const { payload, origin } = opts;
      const startX = origin.clientX;
      const startY = origin.clientY;
      let lifted = false;
      let finished = false;
      let ghost = null;
      let hovered = null;
      let offsetX = 0;
      let offsetY = 0;
      const cleanup = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        ghost?.remove();
        ghost = null;
        payload.source.classList.remove("atwork-is-dragging");
        hovered?.onLeave?.(session);
        hovered = null;
        this.active = null;
        this.lastEndMs = Date.now();
      };
      const session = {
        payload,
        isFinished: () => finished,
        cancel: (reason = "caller") => {
          if (finished) {
            return;
          }
          finished = true;
          cleanup();
          opts.onCancel?.(reason);
        }
      };
      const lift = (ev) => {
        lifted = true;
        payload.source.classList.add("atwork-is-dragging");
        const rect = payload.source.getBoundingClientRect();
        offsetX = payload.ghost?.offsetX ?? startX - rect.left;
        offsetY = payload.ghost?.offsetY ?? startY - rect.top;
        ghost = payload.ghost?.element ?? payload.source.cloneNode(true);
        ghost.classList.add("atwork-drag-ghost");
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        position2(ev);
      };
      const position2 = (ev) => {
        if (ghost) {
          ghost.style.transform = `translate3d(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px, 0)`;
        }
      };
      const onMove = (ev) => {
        if (finished) {
          return;
        }
        if (!lifted) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
            return;
          }
          lift(ev);
        }
        position2(ev);
        const next = this.hitTest(ev.clientX, ev.clientY);
        if (next !== hovered) {
          hovered?.onLeave?.(session);
          hovered = next;
          hovered?.onEnter?.(session);
        }
      };
      const onUp = (ev) => {
        if (finished) {
          return;
        }
        if (!lifted) {
          finished = true;
          cleanup();
          opts.onClickOnly?.();
          return;
        }
        const target = hovered;
        finished = true;
        cleanup();
        if (target && target.accept(payload)) {
          opts.onCommit?.(target);
          void target.onDrop(session, { clientX: ev.clientX, clientY: ev.clientY });
          return;
        }
        opts.onCancel?.(target ? "rejected" : "no-target");
      };
      const onCancel = () => session.cancel("pointercancel");
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          session.cancel("escape");
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      this.active = session;
      return session;
    }
    registerDropTarget(target) {
      this.targets = this.targets.filter((t) => t.id !== target.id);
      this.targets.push(target);
      return () => {
        this.targets = this.targets.filter((t) => t.id !== target.id);
      };
    }
    isDragging() {
      return this.active !== null;
    }
    recentlyEndedDrag(withinMs = CLICK_GUARD_MS) {
      return Date.now() - this.lastEndMs < withinMs;
    }
    /**
     * The registered target the cursor is most specifically over.
     *
     * Depth first, so a target nested inside another wins — that is what makes
     * dropping on a card mean something more specific than dropping in the
     * column that holds it.
     *
     * Ties go to whichever element comes *later* in document order, which for
     * overlapping siblings is the one painted on top and therefore the one the
     * user believes they are aiming at. Without the tie-break, two overlapping
     * siblings resolve by registration order instead, and a small target sitting
     * on top of a large one never receives a drop at all — including when its
     * job was to refuse one, which is how a rejected drop falls through to the
     * surface behind and quietly does something else.
     *
     * The honest limitation: `z-index` can put a shallower, earlier element on
     * top and this will still prefer the later one. The shell's own manager is
     * the answer for anything that layered; this is the fallback for a flat
     * admin page.
     */
    hitTest(x, y) {
      let best = null;
      let bestDepth = -1;
      for (const target of this.targets) {
        const rect = target.element.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          continue;
        }
        const depth = depthOf(target.element);
        if (depth > bestDepth) {
          best = target;
          bestDepth = depth;
          continue;
        }
        if (depth === bestDepth && best && follows(target.element, best.element)) {
          best = target;
        }
      }
      return best;
    }
  }
  function watchShellDragVisuals(payloadType) {
    const sourceOf = (event) => {
      const payload = event.detail?.payload;
      return payload && payload.type === payloadType ? payload.source : null;
    };
    const onStart = (event) => sourceOf(event)?.classList.add("atwork-is-dragging");
    const onEnd = (event) => sourceOf(event)?.classList.remove("atwork-is-dragging");
    document.addEventListener("os.drag.start", onStart);
    document.addEventListener("os.drag.end", onEnd);
    return () => {
      document.removeEventListener("os.drag.start", onStart);
      document.removeEventListener("os.drag.end", onEnd);
    };
  }
  function depthOf(element) {
    let depth = 0;
    let node = element;
    while (node) {
      depth++;
      node = node.parentElement;
    }
    return depth;
  }
  function follows(a, b) {
    return (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }
  let fallback = null;
  function getDragManager() {
    const shell = getShell();
    if (shell?.dragManager) {
      return shell.dragManager;
    }
    if (!fallback) {
      fallback = new FallbackDragManager();
    }
    return fallback;
  }
  function taskPayload(type, source, task, origin) {
    const rect = source.getBoundingClientRect();
    return {
      type,
      source,
      data: { task },
      ghost: {
        offsetX: origin.clientX - rect.left,
        offsetY: origin.clientY - rect.top,
        hint: {
          neutral: "",
          accept: "",
          // Only the reject case earns a chip. "Drop here" over a column
          // the card is visibly hovering says nothing the drop indicator
          // hasn't already said; "can't drop here" is information.
          reject: "",
          hidden: true
        }
      }
    };
  }
  function clear(host) {
    host.replaceChildren();
    host.hidden = true;
  }
  function ask(host, opts) {
    return new Promise((resolve) => {
      clear(host);
      host.hidden = false;
      const form = document.createElement("form");
      form.className = "atwork-inline";
      const label = document.createElement("label");
      label.className = "atwork-inline__label";
      label.textContent = opts.label;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "atwork-inline__input";
      input.placeholder = opts.placeholder ?? "";
      label.appendChild(input);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "atwork__button atwork__button--primary";
      submit.textContent = opts.submit ?? "Add";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "atwork__button";
      cancel.textContent = "Cancel";
      form.append(label, submit, cancel);
      host.appendChild(form);
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clear(host);
        resolve(value);
      };
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const value = input.value.trim();
        finish(value === "" ? null : value);
      });
      cancel.addEventListener("click", () => finish(null));
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(null);
        }
      });
      input.focus();
    });
  }
  function confirm(host, opts) {
    return new Promise((resolve) => {
      clear(host);
      host.hidden = false;
      const wrap = document.createElement("div");
      wrap.className = "atwork-inline";
      wrap.setAttribute("role", "alertdialog");
      const text = document.createElement("p");
      text.className = "atwork-inline__message";
      text.textContent = opts.message;
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = opts.danger ? "atwork__button atwork__button--danger" : "atwork__button atwork__button--primary";
      yes.textContent = opts.confirm ?? "Confirm";
      const no = document.createElement("button");
      no.type = "button";
      no.className = "atwork__button";
      no.textContent = "Cancel";
      wrap.append(text, no, yes);
      host.appendChild(wrap);
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        host.removeEventListener("keydown", onKey);
        clear(host);
        resolve(value);
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(false);
        }
      };
      host.addEventListener("keydown", onKey);
      yes.addEventListener("click", () => finish(true));
      no.addEventListener("click", () => finish(false));
      no.focus();
    });
  }
  function notice(host, message, tone = "info") {
    clear(host);
    host.hidden = false;
    const wrap = document.createElement("div");
    wrap.className = `atwork-inline atwork-inline--${tone}`;
    wrap.setAttribute("role", tone === "error" ? "alert" : "status");
    const text = document.createElement("p");
    text.className = "atwork-inline__message";
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "atwork-inline__close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    wrap.append(text, close);
    host.appendChild(wrap);
    let timer = null;
    const dismiss = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (host.contains(wrap)) {
        clear(host);
      }
    };
    close.addEventListener("click", dismiss);
    if (tone !== "error") {
      timer = setTimeout(dismiss, 4e3);
    }
    return dismiss;
  }
  const KEY = "allterrain-work/focus";
  function store() {
    const create = window.wp?.os?.createSharedStore;
    if (!create) {
      return null;
    }
    return create(KEY, () => ({ projectId: 0, requestedAt: 0 }));
  }
  function onProjectFocus(apply) {
    const shared = store();
    if (!shared) {
      return () => void 0;
    }
    let seen = shared.getState().requestedAt;
    if (seen > 0) {
      apply(shared.getState().projectId);
    }
    return shared.subscribe((state) => {
      if (state.requestedAt === seen) {
        return;
      }
      seen = state.requestedAt;
      apply(state.projectId);
    });
  }
  let open$1 = null;
  function closeAssigneePicker() {
    open$1?.close();
  }
  function openAssigneePicker(anchor, current, onPick) {
    closeAssigneePicker();
    const panel = document.createElement("div");
    panel.className = "atwork-assignee";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Assign this task");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "atwork-assignee__search";
    search.placeholder = "Search people";
    search.setAttribute("aria-label", "Search people");
    const list = document.createElement("div");
    list.className = "atwork-assignee__list";
    list.setAttribute("role", "listbox");
    panel.append(search, list);
    document.body.appendChild(panel);
    position$1(panel, anchor);
    const close = () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      panel.remove();
      open$1 = null;
      anchor.setAttribute("aria-expanded", "false");
    };
    const onOutside = (event) => {
      const target = event.target;
      if (!panel.contains(target) && !anchor.contains(target)) {
        close();
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "true");
    open$1 = { panel, close };
    const choose = (id) => {
      close();
      onPick(id);
    };
    const paint = (people) => {
      list.replaceChildren();
      if (current) {
        list.appendChild(option("Unassign", "", () => choose(0), false, true));
      }
      if (!people.length) {
        const empty = document.createElement("p");
        empty.className = "atwork-assignee__empty";
        empty.textContent = "Nobody matches.";
        list.appendChild(empty);
        return;
      }
      for (const person of people) {
        list.appendChild(
          option(person.name, person.avatar, () => choose(person.id), person.id === current)
        );
      }
    };
    const loading = document.createElement("p");
    loading.className = "atwork-assignee__empty";
    loading.textContent = "Loading…";
    list.appendChild(loading);
    let token = 0;
    const load = (term) => {
      const mine = ++token;
      void fetchAssignees(term).then((people) => {
        if (mine === token && open$1?.panel === panel) {
          paint(people);
        }
      }).catch(() => {
        if (mine === token && open$1?.panel === panel) {
          paint([]);
        }
      });
    };
    let debounce;
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => load(search.value.trim()), 200);
    });
    load("");
    search.focus();
  }
  function option(label, avatar2, onSelect, selected, muted = false) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `atwork-assignee__option${muted ? " is-muted" : ""}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));
    if (avatar2) {
      const img = document.createElement("img");
      img.src = avatar2;
      img.alt = "";
      img.width = 20;
      img.height = 20;
      img.loading = "lazy";
      row.appendChild(img);
    }
    const name = document.createElement("span");
    name.textContent = label;
    row.appendChild(name);
    if (selected) {
      const tick = document.createElement("span");
      tick.className = "atwork-assignee__tick";
      tick.textContent = "✓";
      row.appendChild(tick);
    }
    row.addEventListener("click", onSelect);
    return row;
  }
  function position$1(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = 220;
    panel.style.width = `${width}px`;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const height = 260;
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  let open = null;
  function closeComments() {
    open?.close();
  }
  function openComments(anchor, taskId, onChange2) {
    closeComments();
    const panel = document.createElement("div");
    panel.className = "atwork-comments";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Comments on this task");
    const list = document.createElement("div");
    list.className = "atwork-comments__list";
    const form = document.createElement("form");
    form.className = "atwork-comments__form";
    const input = document.createElement("textarea");
    input.className = "atwork-comments__input";
    input.rows = 2;
    input.placeholder = "Write a comment…";
    input.setAttribute("aria-label", "Write a comment");
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "atwork__button atwork__button--primary";
    send.textContent = "Comment";
    form.append(input, send);
    panel.append(list, form);
    document.body.appendChild(panel);
    position(panel, anchor);
    const close = () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      panel.remove();
      open = null;
      anchor.setAttribute("aria-expanded", "false");
    };
    const onOutside = (event) => {
      const target = event.target;
      if (!panel.contains(target) && !anchor.contains(target)) {
        close();
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "true");
    open = { panel, close };
    let comments = [];
    const paint = () => {
      list.replaceChildren();
      if (!comments.length) {
        const empty = document.createElement("p");
        empty.className = "atwork-comments__empty";
        empty.textContent = "No comments yet.";
        list.appendChild(empty);
        return;
      }
      for (const comment of comments) {
        list.appendChild(render(comment));
      }
      list.scrollTop = list.scrollHeight;
    };
    const render = (comment) => {
      const row = document.createElement("article");
      row.className = "atwork-comments__item";
      const head = document.createElement("div");
      head.className = "atwork-comments__head";
      if (comment.avatar) {
        const img = document.createElement("img");
        img.src = comment.avatar;
        img.alt = "";
        img.width = 18;
        img.height = 18;
        img.loading = "lazy";
        head.appendChild(img);
      }
      const who = document.createElement("strong");
      who.textContent = comment.author;
      head.appendChild(who);
      const when = document.createElement("time");
      when.dateTime = comment.date;
      when.textContent = relative(comment.date);
      when.title = new Date(comment.date).toLocaleString();
      head.appendChild(when);
      if (comment.canDelete) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "atwork-comments__delete";
        remove.setAttribute("aria-label", `Delete ${comment.author}’s comment`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          void deleteComment(comment.id).then(() => {
            comments = comments.filter((c) => c.id !== comment.id);
            paint();
            onChange2(comments.length);
          }).catch(() => void 0);
        });
        head.appendChild(remove);
      }
      const body = document.createElement("p");
      body.className = "atwork-comments__body";
      body.textContent = comment.content;
      row.append(head, body);
      return row;
    };
    const loading = document.createElement("p");
    loading.className = "atwork-comments__empty";
    loading.textContent = "Loading…";
    list.appendChild(loading);
    void fetchComments(taskId).then((loaded) => {
      if (open?.panel !== panel) {
        return;
      }
      comments = loaded;
      paint();
    }).catch(() => {
      if (open?.panel === panel) {
        comments = [];
        paint();
      }
    });
    const submit = () => {
      const content = input.value.trim();
      if (!content) {
        return;
      }
      input.disabled = true;
      send.disabled = true;
      void addComment(taskId, content).then((comment) => {
        if (open?.panel !== panel) {
          return;
        }
        comments.push(comment);
        input.value = "";
        paint();
        onChange2(comments.length);
      }).catch(() => void 0).finally(() => {
        if (open?.panel === panel) {
          input.disabled = false;
          send.disabled = false;
          input.focus();
        }
      });
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    input.focus();
  }
  function relative(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) {
      return "";
    }
    const seconds = Math.round((Date.now() - then) / 1e3);
    if (seconds < 60) {
      return "just now";
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours} h ago`;
    }
    return new Date(iso).toLocaleDateString(void 0, { month: "short", day: "numeric" });
  }
  function position(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = 280;
    const height = 300;
    panel.style.width = `${width}px`;
    const left = Math.min(Math.max(8, rect.left - width / 2), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function registered(tag) {
    return typeof customElements !== "undefined" && !!customElements.get(tag);
  }
  function selectControl(opts) {
    if (registered("os-select")) {
      const select2 = document.createElement("os-select");
      select2.setAttribute("value", opts.value);
      if (opts.hideLabel) {
        select2.setAttribute("placeholder", opts.label);
      } else {
        select2.setAttribute("label", opts.label);
      }
      for (const option2 of opts.options) {
        const el = document.createElement("os-option");
        el.setAttribute("value", option2.value);
        el.textContent = option2.label;
        select2.appendChild(el);
      }
      select2.addEventListener("os-pick", (event) => {
        const value = event.detail?.value;
        if (typeof value === "string") {
          opts.onChange(value);
        }
      });
      return select2;
    }
    const select = document.createElement("select");
    select.className = opts.className ?? "";
    select.setAttribute("aria-label", opts.label);
    for (const option2 of opts.options) {
      const el = document.createElement("option");
      el.value = option2.value;
      el.textContent = option2.label;
      select.appendChild(el);
    }
    select.value = opts.value;
    select.addEventListener("change", () => opts.onChange(select.value));
    return select;
  }
  function buttonControl(opts) {
    if (registered("os-button")) {
      const button2 = document.createElement("os-button");
      button2.textContent = opts.label;
      if (opts.variant) {
        button2.setAttribute("variant", opts.variant);
      }
      button2.addEventListener("click", opts.onClick);
      return button2;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = opts.className ?? "atwork__button";
    button.textContent = opts.label;
    button.addEventListener("click", opts.onClick);
    return button;
  }
  function textControl(opts) {
    if (registered("os-text-field")) {
      const field = document.createElement("os-text-field");
      field.setAttribute("value", opts.value ?? "");
      if (opts.hideLabel) {
        field.setAttribute("aria-label", opts.label);
      } else {
        field.setAttribute("label", opts.label);
      }
      if (opts.placeholder) {
        field.setAttribute("placeholder", opts.placeholder);
      }
      field.addEventListener("input", (event) => {
        const value = event.target.value;
        opts.onInput(typeof value === "string" ? value : "");
      });
      return field;
    }
    const input = document.createElement("input");
    input.type = opts.type ?? "text";
    input.className = opts.className ?? "";
    input.setAttribute("aria-label", opts.label);
    input.value = opts.value ?? "";
    if (opts.placeholder) {
      input.placeholder = opts.placeholder;
    }
    input.addEventListener("input", () => opts.onInput(input.value));
    return input;
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
  function openUrl(url, title, icon) {
    if (!url) {
      return;
    }
    if (openInShell(url, title, icon)) {
      return;
    }
    window.open(url, "_blank", "noopener");
  }
  const ACCEPTED_TYPES = ["shortcut", "desktop-file"];
  function entitiesIn(payload) {
    if (payload.type === "shortcut") {
      const data = payload.data;
      const items = data.items?.length ? data.items : [data];
      return items.map(toEntity).filter(isUsable);
    }
    if (payload.type === "desktop-file") {
      const data = payload.data;
      const list = data.placements?.length ? data.placements : [data.placement];
      return list.map(
        (placement) => toEntity({
          kind: placement?.file?.type,
          ref: placement?.file?.ref,
          title: placement?.file?.title
        })
      ).filter(isUsable);
    }
    return [];
  }
  function toEntity(item) {
    return {
      kind: String(item.kind ?? ""),
      ref: String(item.ref ?? ""),
      title: String(item.title ?? "").trim()
    };
  }
  function isUsable(entity) {
    return entity.kind !== "" && entity.ref !== "";
  }
  function isDesktopPayload(payload) {
    return ACCEPTED_TYPES.includes(payload.type);
  }
  function attachableEntities(payload) {
    if (!isDesktopPayload(payload)) {
      return [];
    }
    return entitiesIn(payload).filter((entity) => sourcePostId(entity) > 0);
  }
  function assigneeIn(payload) {
    if (!isDesktopPayload(payload)) {
      return null;
    }
    const entities = entitiesIn(payload);
    return entities.length === 1 && entities[0].kind === "user" ? entities[0] : null;
  }
  function sourcePostId(entity) {
    if (!["post", "page", "attachment"].includes(entity.kind)) {
      return 0;
    }
    const id = Number.parseInt(entity.ref, 10);
    return Number.isFinite(id) && id > 0 ? id : 0;
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
  function mountBoard(root) {
    const board = new BoardView(root);
    void board.load();
    return () => board.destroy();
  }
  class BoardView {
    constructor(root) {
      this.dnd = getDragManager();
      this.data = null;
      this.filters = { projectId: 0, mineOnly: false, search: "" };
      this.destroyed = false;
      this.dropTargets = [];
      this.unsubscribe = () => void 0;
      this.unwatchDrag = () => void 0;
      this.unwatchFocus = () => void 0;
      this.projectDetail = null;
      this.root = root;
      this.toolbarEl = root.querySelector("[data-atwork-toolbar]") ?? this.append("atwork__toolbar");
      this.boardEl = root.querySelector("[data-atwork-board]") ?? this.append("atwork__board");
      this.inlineEl = document.createElement("div");
      this.inlineEl.className = "atwork__inline-host";
      this.inlineEl.hidden = true;
      this.toolbarEl.insertAdjacentElement("afterend", this.inlineEl);
      this.panelEl = document.createElement("div");
      this.panelEl.className = "atwork__project-host";
      this.panelEl.hidden = true;
      this.inlineEl.insertAdjacentElement("afterend", this.panelEl);
      this.unsubscribe = onChange(() => {
        if (!this.destroyed && !this.dnd.isDragging()) {
          void this.load(true);
        }
      });
      this.unwatchDrag = watchShellDragVisuals(TASK_PAYLOAD_TYPE);
      this.unwatchFocus = onProjectFocus((projectId) => {
        if (this.destroyed || this.filters.projectId === projectId) {
          return;
        }
        this.filters.projectId = projectId;
        this.projectDetail = null;
        if (this.data) {
          this.render();
          void this.loadProjectDetail();
        }
      });
    }
    append(className) {
      const el = document.createElement("div");
      el.className = className;
      this.root.appendChild(el);
      return el;
    }
    async load(silent = false) {
      if (!silent) {
        this.boardEl.replaceChildren(skeleton());
      }
      try {
        const data = await fetchBoard();
        if (this.destroyed) {
          return;
        }
        this.data = data;
        this.render();
        void this.loadProjectDetail();
      } catch (error) {
        if (this.destroyed) {
          return;
        }
        this.boardEl.replaceChildren(
          errorState(
            error instanceof Error ? error.message : "The board could not be loaded.",
            () => void this.load()
          )
        );
      }
    }
    destroy() {
      this.destroyed = true;
      closeAssigneePicker();
      closeComments();
      closeComments();
      this.clearDropTargets();
      this.unsubscribe();
      this.unwatchDrag();
      this.unwatchFocus();
      this.root.replaceChildren();
    }
    clearDropTargets() {
      this.dropTargets.forEach((off) => off());
      this.dropTargets = [];
    }
    // -- Rendering ---------------------------------------------------------
    render() {
      if (!this.data) {
        return;
      }
      this.renderToolbar();
      this.renderProjectPanel();
      this.renderColumns();
    }
    /**
     * Loads the numbers behind the project the board is filtered to.
     *
     * Separate from the board request rather than folded into it, because the
     * board is what the user is waiting for and this is not. Fetching it
     * alongside would make every unfiltered board pay for a panel it will not
     * draw.
     */
    async loadProjectDetail() {
      const id = this.filters.projectId;
      if (!id) {
        this.projectDetail = null;
        this.renderProjectPanel();
        return;
      }
      try {
        const detail = await fetchProject(id);
        if (this.destroyed || this.filters.projectId !== id) {
          return;
        }
        this.projectDetail = detail;
        this.renderProjectPanel();
      } catch (error) {
        if (!this.destroyed && this.filters.projectId === id) {
          this.reportError(error);
        }
      }
    }
    /**
     * The project header — what a project is, rather than what it filters.
     *
     * Only drawn when the board is narrowed to one project. Across every
     * project at once there is no single completion figure to report, and a
     * progress bar summing unrelated work would be a number that looks
     * meaningful and is not.
     */
    renderProjectPanel() {
      if (!this.filters.projectId) {
        this.panelEl.hidden = true;
        this.panelEl.replaceChildren();
        return;
      }
      const detail = this.projectDetail;
      const known = this.data?.projects.find((p) => p.id === this.filters.projectId);
      this.panelEl.hidden = false;
      const panel = document.createElement("div");
      panel.className = "atwork-project";
      const head = document.createElement("div");
      head.className = "atwork-project__head";
      const title = document.createElement("h2");
      title.className = "atwork-project__title";
      title.textContent = detail?.title ?? known?.title ?? "Project";
      head.appendChild(title);
      if (detail) {
        const percent = document.createElement("span");
        percent.className = "atwork-project__percent";
        percent.textContent = `${detail.percent}%`;
        head.appendChild(percent);
      }
      const edit = document.createElement("a");
      edit.className = "atwork-project__edit";
      edit.href = detail?.editUrl || known?.editUrl || "#";
      edit.textContent = "Edit";
      routeLinkIntoShell(edit, detail?.title ?? known?.title ?? "Project", "dashicons-portfolio");
      head.appendChild(edit);
      if (detail?.canEdit ?? known?.canEdit) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "atwork-project__delete";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => void this.confirmTrashProject(detail?.title ?? known?.title ?? "this project"));
        head.appendChild(remove);
      }
      panel.appendChild(head);
      if (!detail) {
        const loading = document.createElement("p");
        loading.className = "atwork-project__loading";
        loading.textContent = "Loading project…";
        panel.appendChild(loading);
        this.panelEl.replaceChildren(panel);
        return;
      }
      if (detail.description) {
        const description = document.createElement("p");
        description.className = "atwork-project__description";
        description.textContent = detail.description;
        panel.appendChild(description);
      }
      if (detail.total > 0) {
        const bar = document.createElement("div");
        bar.className = "atwork-project__bar";
        bar.setAttribute("role", "img");
        bar.setAttribute(
          "aria-label",
          `${detail.done} of ${detail.total} tasks done` + (detail.overdue ? `, ${detail.overdue} overdue` : "")
        );
        for (const band of detail.breakdown) {
          if (!band.count) {
            continue;
          }
          const segment = document.createElement("span");
          segment.className = "atwork-project__band";
          segment.style.flexGrow = String(band.count);
          segment.style.background = band.color;
          segment.title = `${band.name}: ${band.count}`;
          bar.appendChild(segment);
        }
        panel.appendChild(bar);
      }
      const stats = document.createElement("div");
      stats.className = "atwork-project__stats";
      const figures = [
        ["done", detail.done, ""],
        ["open", detail.open, ""],
        ["overdue", detail.overdue, "is-overdue"]
      ];
      for (const [label, value, modifier] of figures) {
        if (!value && modifier) {
          continue;
        }
        const chip = document.createElement("span");
        chip.className = `atwork-project__stat ${modifier}`.trim();
        chip.textContent = `${value} ${label}`;
        stats.appendChild(chip);
      }
      if (detail.members.length) {
        const members = document.createElement("span");
        members.className = "atwork-project__members";
        for (const member of detail.members.slice(0, 6)) {
          const face = avatar(member.name, member.avatar);
          face.title = member.open ? `${member.name} — ${member.open} open` : `${member.name} — nothing open`;
          members.appendChild(face);
        }
        stats.appendChild(members);
      }
      panel.appendChild(stats);
      if (!detail.total) {
        const empty = document.createElement("p");
        empty.className = "atwork-project__loading";
        empty.textContent = "No tasks in this project yet.";
        panel.appendChild(empty);
      }
      this.panelEl.replaceChildren(panel);
    }
    renderToolbar() {
      const data = this.data;
      if (!data) {
        return;
      }
      const bar = document.createElement("div");
      bar.className = "atwork__toolbar-inner";
      bar.appendChild(
        selectControl({
          label: "Project",
          hideLabel: true,
          className: "atwork__select",
          value: String(this.filters.projectId),
          options: [{ value: "0", label: `All projects (${data.projects.length})` }].concat(
            data.projects.map((p) => ({ value: String(p.id), label: p.title }))
          ),
          onChange: (value) => {
            this.filters.projectId = Number(value);
            this.projectDetail = null;
            this.renderProjectPanel();
            this.renderColumns();
            void this.loadProjectDetail();
          }
        })
      );
      const mine = document.createElement("button");
      mine.type = "button";
      mine.className = "atwork__toggle";
      mine.textContent = "Assigned to me";
      mine.setAttribute("aria-pressed", String(this.filters.mineOnly));
      mine.addEventListener("click", () => {
        this.filters.mineOnly = !this.filters.mineOnly;
        mine.setAttribute("aria-pressed", String(this.filters.mineOnly));
        this.renderColumns();
      });
      bar.appendChild(mine);
      bar.appendChild(
        textControl({
          label: "Search tasks",
          hideLabel: true,
          type: "search",
          className: "atwork__search",
          value: this.filters.search,
          placeholder: "Search tasks",
          onInput: (value) => {
            this.filters.search = value.trim().toLowerCase();
            this.renderColumns();
          }
        })
      );
      const spacer = document.createElement("span");
      spacer.className = "atwork__spacer";
      bar.appendChild(spacer);
      if (data.viewer.canCreate) {
        bar.appendChild(
          buttonControl({ label: "Add column", onClick: () => void this.addColumn() })
        );
        bar.appendChild(
          buttonControl({ label: "New project", onClick: () => void this.promptNewProject() })
        );
      }
      this.toolbarEl.replaceChildren(bar);
    }
    /** Whether the current filters admit a task. */
    passesFilters(task) {
      const data = this.data;
      if (!data) {
        return true;
      }
      if (this.filters.projectId && task.projectId !== this.filters.projectId) {
        return false;
      }
      if (this.filters.mineOnly && task.ownerId !== data.viewer.id) {
        return false;
      }
      if (this.filters.search && !task.title.toLowerCase().includes(this.filters.search)) {
        return false;
      }
      return true;
    }
    /**
     * Turns "third card I can see" into "third card in the column".
     *
     * The two are only the same number when nothing is filtered. Narrow the
     * board to one project and a card dropped below the last visible card is
     * not going to index 3 of the column -- it is going to the end of a column
     * that may hold twenty. Sending the visible index straight through is how a
     * drop lands somewhere the user did not aim, and worse, silently reshuffles
     * the cards the filter is hiding.
     *
     * Anchoring on the card the drop landed above, rather than on any count,
     * is what makes it exact: whatever is hidden between them stays where it is.
     *
     * @param task         The card being moved.
     * @param statusId     Destination column.
     * @param visibleIndex Index among the cards the user can currently see.
     */
    absolutePosition(task, statusId, visibleIndex) {
      const data = this.data;
      if (!data) {
        return visibleIndex;
      }
      const column = data.tasks.filter((t) => t.statusId === statusId && t.id !== task.id).sort((a, b) => a.order - b.order);
      const visible = column.filter((t) => this.passesFilters(t));
      if (visibleIndex >= visible.length) {
        return column.length;
      }
      const anchorTask = visible[visibleIndex];
      const index = column.findIndex((t) => t.id === anchorTask.id);
      return index < 0 ? column.length : index;
    }
    /** The tasks the current filters admit, grouped by column. */
    visibleTasks() {
      const grouped = /* @__PURE__ */ new Map();
      const data = this.data;
      if (!data) {
        return grouped;
      }
      data.statuses.forEach((s) => grouped.set(s.id, []));
      for (const task of data.tasks) {
        if (!this.passesFilters(task)) {
          continue;
        }
        const columnId = grouped.has(task.statusId) ? task.statusId : data.statuses[0]?.id ?? 0;
        grouped.get(columnId)?.push(task);
      }
      grouped.forEach((list) => list.sort((a, b) => a.order - b.order));
      return grouped;
    }
    renderColumns() {
      const data = this.data;
      if (!data) {
        return;
      }
      closeAssigneePicker();
      closeComments();
      this.clearDropTargets();
      if (!data.statuses.length) {
        this.boardEl.replaceChildren(
          emptyState(
            "No columns yet",
            "A board needs at least one status. Add one under Work → Statuses."
          )
        );
        return;
      }
      const grouped = this.visibleTasks();
      const columns = document.createElement("div");
      columns.className = "atwork__columns";
      for (const status of data.statuses) {
        columns.appendChild(this.renderColumn(status, grouped.get(status.id) ?? []));
      }
      this.boardEl.replaceChildren(columns);
    }
    renderColumn(status, tasks) {
      const column = document.createElement("section");
      column.className = "atwork-column";
      column.dataset.statusId = String(status.id);
      column.style.setProperty("--atwork-column-color", status.color);
      column.setAttribute("aria-label", `${status.name}, ${tasks.length} tasks`);
      const header = document.createElement("header");
      header.className = "atwork-column__header";
      const name = document.createElement("h2");
      name.className = "atwork-column__name";
      name.textContent = status.name;
      header.appendChild(name);
      const count = document.createElement("span");
      count.className = "atwork-column__count";
      count.textContent = String(tasks.length);
      header.appendChild(count);
      column.appendChild(header);
      const list = document.createElement("div");
      list.className = "atwork-column__list";
      list.dataset.statusId = String(status.id);
      column.appendChild(list);
      for (const task of tasks) {
        list.appendChild(this.renderCard(task, status, list));
      }
      if (!tasks.length) {
        const hint = document.createElement("p");
        hint.className = "atwork-column__empty";
        hint.textContent = "Drop a card here";
        list.appendChild(hint);
      }
      if (this.data?.viewer.canCreate) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "atwork-column__add";
        add.textContent = "+ Add task";
        add.addEventListener("click", () => this.showComposer(column, status.id));
        column.appendChild(add);
      }
      this.registerColumnDrop(column, list, status);
      return column;
    }
    renderCard(task, status, list) {
      const card = document.createElement("article");
      card.className = `atwork-card atwork-card--${task.priority}`;
      card.dataset.taskId = String(task.id);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${task.title}. Press Enter to open.`);
      const title = document.createElement("h3");
      title.className = "atwork-card__title";
      title.textContent = task.title;
      card.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "atwork-card__meta";
      if (task.projectId) {
        const project = this.data?.projects.find((p) => p.id === task.projectId);
        if (project) {
          const chip = document.createElement("span");
          chip.className = "atwork-card__project";
          chip.textContent = project.title;
          if (project.color) {
            chip.style.setProperty("--atwork-chip-color", project.color);
            chip.classList.add("has-color");
          }
          meta.appendChild(chip);
        }
      }
      if (task.due) {
        const due = document.createElement("span");
        due.className = "atwork-card__due";
        due.textContent = formatDue(task.due);
        if (isOverdue(task.due)) {
          due.classList.add("is-overdue");
        }
        meta.appendChild(due);
      }
      if (task.sourceId && task.sourceUrl) {
        const link = document.createElement("a");
        link.className = "atwork-card__source";
        link.href = task.sourceUrl;
        link.textContent = "↱ " + (task.sourceTitle || "Source");
        link.title = `Open “${task.sourceTitle}”`;
        routeLinkIntoShell(link, task.sourceTitle || "Source", "dashicons-admin-post");
        meta.appendChild(link);
      }
      meta.appendChild(this.commentControl(task));
      if (task.canEdit) {
        meta.appendChild(this.assignControl(task));
      } else if (task.ownerId) {
        meta.appendChild(avatar(task.ownerName, task.ownerAvatar));
      }
      if (meta.childElementCount) {
        card.appendChild(meta);
      }
      if (task.links.length) {
        card.appendChild(this.renderLinks(task));
      }
      if (task.canDelete) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "atwork-card__remove";
        remove.setAttribute("aria-label", `Move “${task.title}” to the trash`);
        remove.title = "Move to trash";
        remove.textContent = "×";
        remove.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        remove.addEventListener("click", (ev) => {
          ev.stopPropagation();
          void this.confirmTrash(task);
        });
        card.appendChild(remove);
      }
      this.wireCard(card, task, status, list);
      return card;
    }
    /**
     * The assign control — the avatar, made pressable.
     *
     * Every card carries one, assigned or not, because "who is this for" is a
     * question you ask of unassigned work most of all. An unassigned card shows
     * a dashed outline rather than nothing, so the affordance is visible before
     * anyone hovers it.
     */
    assignControl(task) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atwork-card__assign";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute(
        "aria-label",
        task.ownerId ? `Assigned to ${task.ownerName}. Change.` : "Assign this task"
      );
      button.title = task.ownerId ? `${task.ownerName} — click to change` : "Assign";
      if (task.ownerId) {
        button.appendChild(avatar(task.ownerName, task.ownerAvatar));
      } else {
        button.classList.add("is-empty");
        button.textContent = "+";
      }
      button.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openAssigneePicker(button, task.ownerId, (userId) => void this.setOwner(task, userId));
      });
      return button;
    }
    /**
     * The comment control — a count you can press.
     *
     * Always present, even at zero. A thread you can only find once somebody
     * else has started it is a thread nobody starts.
     */
    commentControl(task) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atwork-card__comments";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute(
        "aria-label",
        task.comments ? `${task.comments} comments. Open the thread.` : "Comment on this task"
      );
      button.title = task.comments ? `${task.comments} comments` : "Comment";
      const icon = document.createElement("span");
      icon.className = "atwork-card__comments-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "💬";
      button.appendChild(icon);
      if (task.comments) {
        const count = document.createElement("span");
        count.textContent = String(task.comments);
        button.appendChild(count);
      } else {
        button.classList.add("is-empty");
      }
      button.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openComments(button, task.id, (count) => {
          this.applyTask({ ...task, comments: count });
          button.querySelector("span:not(.atwork-card__comments-icon)")?.remove();
          button.classList.toggle("is-empty", count === 0);
          if (count) {
            const el = document.createElement("span");
            el.textContent = String(count);
            button.appendChild(el);
          }
        });
      });
      return button;
    }
    /** Writes a new assignee, or clears one. */
    async setOwner(task, userId) {
      if (userId === task.ownerId) {
        return;
      }
      try {
        const updated = await updateTask(task.id, { owner: userId });
        if (this.destroyed) {
          return;
        }
        this.applyTask(updated);
        announceChange("updated", [task.id]);
        this.renderColumns();
      } catch (error) {
        this.reportError(error);
      }
    }
    /**
     * The things attached to a task, as removable chips.
     *
     * Titles rather than a count: "3 attachments" tells you there is something
     * to go and look at, which is a worse answer than showing what it is.
     */
    renderLinks(task) {
      const wrap = document.createElement("div");
      wrap.className = "atwork-card__links";
      for (const link of task.links) {
        const chip = document.createElement("span");
        chip.className = "atwork-card__link";
        chip.title = `${link.typeLabel}: ${link.title}`;
        if (link.thumbnail) {
          const img = document.createElement("img");
          img.src = link.thumbnail;
          img.alt = "";
          img.loading = "lazy";
          chip.appendChild(img);
        }
        const label = document.createElement("a");
        label.className = "atwork-card__link-title";
        label.href = link.editUrl || "#";
        label.textContent = link.title;
        routeLinkIntoShell(label, link.title);
        chip.appendChild(label);
        if (task.canEdit) {
          const detach = document.createElement("button");
          detach.type = "button";
          detach.className = "atwork-card__detach";
          detach.setAttribute("aria-label", `Detach “${link.title}”`);
          detach.title = "Detach — the item itself is not deleted";
          detach.textContent = "×";
          detach.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          detach.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void this.detach(task, link.id);
          });
          chip.appendChild(detach);
        }
        wrap.appendChild(chip);
      }
      return wrap;
    }
    // -- Interaction -------------------------------------------------------
    /**
     * Makes a card draggable and openable.
     *
     * The click handler is `onClickOnly` on the drag session rather than a
     * `click` listener on the element, so a press that turns into a drag does
     * not also open the task when the pointer comes up.
     */
    wireCard(card, task, status, list) {
      const open2 = () => openUrl(task.editUrl, task.title, "dashicons-yes-alt");
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open2();
        }
      });
      card.addEventListener("pointerdown", (ev) => {
        if (!task.canEdit) {
          return;
        }
        this.dnd.start({
          payload: taskPayload(TASK_PAYLOAD_TYPE, card, task, ev),
          origin: ev,
          onClickOnly: open2
        });
      });
      this.registerCardDrop(card, task, status, list);
      card.addEventListener("contextmenu", (ev) => {
        if (!task.canDelete) {
          return;
        }
        ev.preventDefault();
        void this.confirmTrash(task);
      });
    }
    /**
     * Makes a column accept cards.
     *
     * `accept()` returns false for foreign payloads rather than the target
     * simply not existing, which makes the column a *claimant*: a media tile
     * dragged over it is refused here instead of falling through to whatever is
     * behind the board. Falling through is how a drop aimed at a column ends up
     * doing something else entirely.
     */
    registerColumnDrop(column, list, status) {
      const off = this.dnd.registerDropTarget({
        id: `allterrain-work/column-${status.id}`,
        // The whole column, not just its list of cards. The header, the
        // gap under the last card and the "+ Add task" row are all places
        // a person aims at when they mean "this column", and a target that
        // stops at the list turns a confident drop into a rejected one.
        element: column,
        // Tasks and nothing else. A column is a *status*, so the only thing
        // that can be in one is a task — dropping a draft here used to mint
        // a task from it, which is a real action taken on a gesture that
        // did not ask for one. Content goes onto a card, where it attaches.
        accept: (payload) => payload.type === TASK_PAYLOAD_TYPE,
        acceptLabel: `Move to ${status.name}`,
        onEnter: () => column.classList.add("is-drop-target"),
        onLeave: () => column.classList.remove("is-drop-target"),
        onDrop: (session, ev) => {
          column.classList.remove("is-drop-target");
          const task = session.payload.data.task;
          if (task) {
            void this.handleDrop(task, status, list, ev.clientY);
          }
        }
      });
      this.dropTargets.push(off);
    }
    /**
     * Makes a card a drop target in its own right.
     *
     * It has to accept **task** payloads as well as users, and that is not an
     * extra feature — it is the only way dropping a card onto a column works
     * when there are already cards in it. The drag manager picks the deepest
     * target under the cursor and treats a target whose `accept()` returns
     * false as a *claimant*: the drop is refused there and never falls through
     * to the column underneath. So a card that declined task payloads made
     * every other card in the column a dead patch, and the user had to find the
     * shrinking gap of empty list below them.
     *
     * A task dropped here is handed straight to the column's own handler, with
     * the pointer's height deciding where among the cards it lands — so
     * dropping *on* a card is not merely allowed, it is how you place one
     * precisely.
     */
    registerCardDrop(card, task, status, list) {
      const off = this.dnd.registerDropTarget({
        id: `allterrain-work/card-${task.id}`,
        element: card,
        accept: (payload) => {
          if (payload.type === TASK_PAYLOAD_TYPE) {
            return true;
          }
          if (!isDesktopPayload(payload) || !task.canEdit) {
            return false;
          }
          return assigneeIn(payload) !== null || attachableEntities(payload).length > 0;
        },
        acceptLabel: `Move to ${status.name}`,
        onEnter: (session) => card.classList.add(
          session.payload.type === TASK_PAYLOAD_TYPE ? "is-drop-near" : "is-assign-target"
        ),
        onLeave: () => card.classList.remove("is-assign-target", "is-drop-near"),
        onDrop: (session, ev) => {
          card.classList.remove("is-assign-target", "is-drop-near");
          if (session.payload.type === TASK_PAYLOAD_TYPE) {
            const dragged = session.payload.data.task;
            if (dragged) {
              void this.handleDrop(dragged, status, list, ev.clientY);
            }
            return;
          }
          const user = assigneeIn(session.payload);
          if (user) {
            void this.assign(task, user);
            return;
          }
          const attachable = attachableEntities(session.payload);
          if (attachable.length) {
            void this.attach(task, attachable);
          }
        }
      });
      this.dropTargets.push(off);
    }
    /**
     * Attaches dropped content to a task.
     *
     * Anything in `wp_posts` — a post, a page, an image, a product. The link is
     * a reference, so detaching later removes the link and never the thing.
     */
    async attach(task, entities) {
      const ids = entities.map(sourcePostId).filter((id) => id > 0);
      if (!ids.length) {
        return;
      }
      try {
        const links = await attachToTask(task.id, ids);
        if (this.destroyed) {
          return;
        }
        this.applyTask({ ...task, links });
        announceChange("updated", [task.id]);
        this.renderColumns();
        getShell()?.notify?.({
          title: "AllTerrain Work",
          body: ids.length === 1 ? `Attached “${entities[0].title || "item"}” to ${task.title}` : `Attached ${ids.length} items to ${task.title}`
        });
      } catch (error) {
        this.reportError(error);
      }
    }
    /** Removes one attachment. Unlinks it; never deletes the linked post. */
    async detach(task, linkedId) {
      try {
        const links = await detachFromTask(task.id, linkedId);
        if (this.destroyed) {
          return;
        }
        this.applyTask({ ...task, links });
        announceChange("updated", [task.id]);
        this.renderColumns();
      } catch (error) {
        this.reportError(error);
      }
    }
    /** Assigns from a dropped user tile — the same write the picker makes. */
    async assign(task, user) {
      const owner = Number.parseInt(user.ref, 10);
      if (!Number.isFinite(owner) || owner <= 0) {
        return;
      }
      await this.setOwner(task, owner);
      getShell()?.notify?.({
        title: "AllTerrain Work",
        body: `“${task.title}” is now ${user.title || "assigned"}`
      });
    }
    /**
     * Commits a drop: move the DOM now, tell the server, revert if it refuses.
     */
    async handleDrop(task, status, list, clientY) {
      const card = this.boardEl.querySelector(`[data-task-id="${task.id}"]`);
      if (!card) {
        return;
      }
      const previousParent = card.parentElement;
      const previousNext = card.nextElementSibling;
      const visibleIndex = insertionIndex(list, card, clientY);
      const position2 = this.absolutePosition(task, status.id, visibleIndex);
      list.querySelector(".atwork-column__empty")?.remove();
      list.insertBefore(card, list.children[visibleIndex] ?? null);
      card.classList.add("is-pending");
      try {
        const updated = await moveTask(task.id, status.id, position2);
        if (this.destroyed) {
          return;
        }
        card.classList.remove("is-pending");
        this.applyTask(updated);
        announceChange("moved", [task.id]);
        await this.load(true);
      } catch (error) {
        if (this.destroyed) {
          return;
        }
        card.classList.remove("is-pending");
        previousParent?.insertBefore(card, previousNext);
        this.reportError(error);
      }
    }
    /** Writes a server response back into the local model. */
    applyTask(updated) {
      if (!this.data) {
        return;
      }
      const index = this.data.tasks.findIndex((t) => t.id === updated.id);
      if (index === -1) {
        this.data.tasks.push(updated);
      } else {
        this.data.tasks[index] = updated;
      }
    }
    /**
     * The inline "add a task" field at the foot of a column.
     *
     * Inline rather than a modal because adding tasks is the thing people do
     * most, and a dialog per task turns a two-minute brain-dump into twenty
     * dialogs.
     */
    showComposer(column, statusId) {
      const existing = column.querySelector(".atwork-composer");
      if (existing) {
        existing.querySelector("input")?.focus();
        return;
      }
      const form = document.createElement("form");
      form.className = "atwork-composer";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "atwork-composer__input";
      input.placeholder = "What needs doing?";
      input.setAttribute("aria-label", "New task title");
      form.appendChild(input);
      const close = () => form.remove();
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const title = input.value.trim();
        if (!title) {
          close();
          return;
        }
        input.disabled = true;
        void createTask({
          title,
          status: statusId,
          project: this.filters.projectId || void 0,
          // Filtering to "assigned to me" and then adding a task that is
          // not assigned to you would make it vanish the moment it is
          // created. Match the view the user is looking at.
          owner: this.filters.mineOnly ? this.data?.viewer.id : void 0
        }).then((task) => {
          if (this.destroyed) {
            return;
          }
          this.data?.tasks.unshift(task);
          announceChange("created", [task.id]);
          close();
          this.renderColumns();
        }).catch((error) => {
          input.disabled = false;
          this.reportError(error);
        });
      });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          close();
        }
      });
      input.addEventListener("blur", () => {
        if (!input.value.trim()) {
          close();
        }
      });
      column.appendChild(form);
      input.focus();
    }
    async promptNewProject() {
      const title = await ask(this.inlineEl, {
        label: "New project",
        placeholder: "What is it called?",
        submit: "Create project"
      });
      if (!title || this.destroyed) {
        return;
      }
      try {
        const project = await createProject(title);
        if (this.destroyed) {
          return;
        }
        this.data?.projects.push(project);
        this.filters.projectId = project.id;
        this.projectDetail = null;
        this.render();
        void this.loadProjectDetail();
      } catch (error) {
        this.reportError(error);
      }
    }
    /**
     * Adds a column to the board.
     *
     * The board is not a fixed four-column pipeline. A team that works in
     * "Waiting on client" has to be able to say so here, on the board, rather
     * than being sent to the taxonomy screen in wp-admin to add a term and come
     * back — which is the moment a tool stops feeling like a tool.
     */
    async addColumn() {
      const name = await ask(this.inlineEl, {
        label: "New column",
        placeholder: "Blocked, In review, Waiting on client…",
        submit: "Add column"
      });
      if (!name || this.destroyed) {
        return;
      }
      try {
        const status = await createStatus(name);
        if (this.destroyed) {
          return;
        }
        this.data?.statuses.push(status);
        this.renderColumns();
        notice(this.inlineEl, `Added the “${status.name}” column.`, "success");
      } catch (error) {
        this.reportError(error);
      }
    }
    /**
     * Trashes the project the board is filtered to.
     *
     * The tasks in it stay. A project is a grouping, and deleting a folder
     * should not delete the work inside it — which is also why the message says
     * so rather than leaving the user to guess.
     */
    async confirmTrashProject(title) {
      const projectId = this.filters.projectId;
      if (!projectId) {
        return;
      }
      const shell = getShell();
      const message = `Move “${title}” to the trash? Its tasks are kept.`;
      const confirmed = shell?.confirm ? await shell.confirm({ title: "Delete project", message, confirmLabel: "Move to trash", danger: true }) : await confirm(this.inlineEl, { message, confirm: "Move to trash", danger: true });
      if (!confirmed || this.destroyed) {
        return;
      }
      try {
        await trashProject(projectId);
        if (this.destroyed) {
          return;
        }
        if (this.data) {
          this.data.projects = this.data.projects.filter((p) => p.id !== projectId);
        }
        this.filters.projectId = 0;
        this.projectDetail = null;
        announceChange("trashed", [projectId]);
        this.render();
        notice(this.inlineEl, `“${title}” is in the trash. Its tasks were kept.`, "success");
      } catch (error) {
        this.reportError(error);
      }
    }
    async confirmTrash(task) {
      const shell = getShell();
      const message = `Move “${task.title}” to the trash?`;
      const confirmed = shell?.confirm ? await shell.confirm({ title: "Move to trash", message, confirmLabel: "Move to trash", danger: true }) : await confirm(this.inlineEl, { message, confirm: "Move to trash", danger: true });
      if (!confirmed) {
        return;
      }
      try {
        await trashTask(task.id);
        if (this.destroyed) {
          return;
        }
        if (this.data) {
          this.data.tasks = this.data.tasks.filter((t) => t.id !== task.id);
        }
        announceChange("trashed", [task.id]);
        this.renderColumns();
      } catch (error) {
        this.reportError(error);
      }
    }
    /**
     * Surfaces a failure.
     *
     * Through the shell's toast when there is one — it stacks, it pauses while
     * the pointer is over it, and it does not steal focus. `alert()` is the
     * fallback and is deliberately last: it blocks the page, and blocking the
     * page inside a desktop shell freezes every other window too.
     */
    reportError(error) {
      const message = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong.";
      const shell = getShell();
      if (shell?.notify) {
        shell.notify({ title: "AllTerrain Work", body: message, type: "error" });
        return;
      }
      notice(this.inlineEl, message, "error");
    }
  }
  function insertionIndex(list, dragged, clientY) {
    const cards = Array.from(list.querySelectorAll(".atwork-card")).filter(
      (el) => el !== dragged
    );
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }
  function avatar(name, url) {
    const el = document.createElement("span");
    el.className = "atwork-card__owner";
    el.title = name;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.width = 22;
      img.height = 22;
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      el.textContent = initials(name);
      el.classList.add("atwork-card__owner--initials");
    }
    return el;
  }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
  }
  function skeleton() {
    const el = document.createElement("div");
    el.className = "atwork__skeleton";
    el.setAttribute("aria-busy", "true");
    for (let i = 0; i < 4; i++) {
      const column = document.createElement("div");
      column.className = "atwork__skeleton-column";
      el.appendChild(column);
    }
    return el;
  }
  function emptyState(title, body) {
    const el = document.createElement("div");
    el.className = "atwork__empty";
    const h = document.createElement("p");
    h.className = "atwork__empty-title";
    h.textContent = title;
    el.appendChild(h);
    const p = document.createElement("p");
    p.textContent = body;
    el.appendChild(p);
    return el;
  }
  function errorState(message, retry) {
    const el = emptyState("The board could not be loaded", message);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "atwork__button";
    button.textContent = "Try again";
    button.addEventListener("click", retry);
    el.appendChild(button);
    return el;
  }
  const MOUNTED = "atworkMounted";
  function mountOnce(root) {
    if (root.dataset[MOUNTED] === "1") {
      return () => void 0;
    }
    root.dataset[MOUNTED] = "1";
    const teardown = mountBoard(root);
    return () => {
      delete root.dataset[MOUNTED];
      teardown();
    };
  }
  function registerNativeWindow() {
    const w = window;
    w.openStationNativeWindows = w.openStationNativeWindows ?? {};
    w.openStationNativeWindows["allterrain-work"] = (body) => {
      const root = body.querySelector("[data-atwork-root]") ?? body;
      return mountOnce(root);
    };
  }
  function mountInPage() {
    document.querySelectorAll('[data-atwork-root][data-host="admin"]').forEach((root) => mountOnce(root));
  }
  function openWindowIfRequested() {
    if (!new URLSearchParams(window.location.search).has("atwork_open")) {
      return;
    }
    const open2 = () => {
      const os = window.wp?.os;
      os?.openWindow?.("allterrain-work", { source: "bookmark" });
    };
    if (window.wp?.os?.isReady?.()) {
      open2();
      return;
    }
    document.addEventListener("os-init", open2, { once: true });
  }
  function registerExplorerAction() {
    const hooks = window.wp?.hooks;
    if (!hooks?.addFilter) {
      return;
    }
    hooks.addFilter(
      "os.my-wordpress.preview-actions",
      "allterrain-work/open-board",
      (actions) => actions.map(
        (action) => action.id === "allterrain-work/open-board" ? {
          ...action,
          onSelect: () => {
            const os = window.wp?.os;
            os?.openWindow?.("allterrain-work", { source: "wp-explorer" });
          }
        } : action
      )
    );
  }
  registerNativeWindow();
  registerExplorerAction();
  openWindowIfRequested();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountInPage, { once: true });
  } else {
    mountInPage();
  }
})();
