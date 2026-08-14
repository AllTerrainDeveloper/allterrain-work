(function() {
  "use strict";
  const wp = window.wp;
  function editorApi() {
    if (!wp?.element || !wp.data || !wp.plugins || !wp.components) {
      return null;
    }
    const panel = wp.editor?.PluginDocumentSettingPanel ?? wp.editPost?.PluginDocumentSettingPanel;
    if (!panel) {
      return null;
    }
    return {
      el: wp.element.createElement,
      Fragment: wp.element.Fragment,
      useSelect: wp.data.useSelect,
      useDispatch: wp.data.useDispatch,
      registerPlugin: wp.plugins.registerPlugin,
      components: wp.components,
      Panel: panel,
      __: wp.i18n?.__ ?? ((text) => text)
    };
  }
  const api = editorApi();
  const config = window.allTerrainWorkEditor;
  if (api && config) {
    const { el, useSelect, useDispatch, registerPlugin, components, Panel, __ } = api;
    const { TextControl, SelectControl, ColorPalette, BaseControl, Button } = components;
    const useMeta = () => {
      const meta = useSelect(
        (select) => select("core/editor").getEditedPostAttribute("meta"),
        []
      );
      const { editPost } = useDispatch("core/editor");
      return {
        meta: meta ?? {},
        set: (key, value) => editPost({ meta: { [key]: value } })
      };
    };
    const toOptions = (rows, emptyLabel, label) => [{ label: emptyLabel, value: "0" }].concat(
      (rows ?? []).map((row) => ({ label: label(row), value: String(row.id) }))
    );
    const useUsers = () => useSelect(
      (select) => select("core").getEntityRecords("root", "user", { per_page: 100 }),
      []
    );
    const dateField = (label, value, onChange) => el(TextControl, {
      label,
      type: "date",
      value: value || "",
      onChange,
      __nextHasNoMarginBottom: true
    });
    const boardButton = () => el(
      Button,
      {
        variant: "secondary",
        onClick: () => {
          const os = window.wp?.os;
          os?.openWindow?.(config.boardWindow, { source: "editor" });
        }
      },
      __("Open the work board", "allterrain-work")
    );
    const hasShell = () => !!window.wp?.os?.openWindow;
    const TaskPanel = () => {
      const { meta, set } = useMeta();
      const userRows = useUsers();
      const projectRows = useSelect(
        (select) => select("core").getEntityRecords("postType", config.projectType, {
          per_page: 100,
          status: "any"
        }),
        []
      );
      const users = toOptions(
        userRows,
        __("— Nobody —", "allterrain-work"),
        (row) => row.name ?? String(row.id)
      );
      const projects = toOptions(
        projectRows,
        __("— No project —", "allterrain-work"),
        (row) => row.title?.raw || row.title?.rendered || String(row.id)
      );
      return el(
        Panel,
        { name: "allterrain-work-task", title: __("Work", "allterrain-work") },
        el(SelectControl, {
          label: __("Project", "allterrain-work"),
          value: String(meta[config.meta.project] ?? 0),
          options: projects,
          onChange: (value) => set(config.meta.project, Number(value)),
          __nextHasNoMarginBottom: true
        }),
        el(SelectControl, {
          label: __("Assignee", "allterrain-work"),
          value: String(meta[config.meta.owner] ?? 0),
          options: users,
          onChange: (value) => set(config.meta.owner, Number(value)),
          __nextHasNoMarginBottom: true
        }),
        dateField(
          __("Due date", "allterrain-work"),
          String(meta[config.meta.due] ?? ""),
          (value) => set(config.meta.due, value)
        ),
        el(SelectControl, {
          label: __("Priority", "allterrain-work"),
          value: String(meta[config.meta.priority] ?? "medium"),
          options: config.priorities.map((slug) => ({
            label: config.priorityLabels[slug] ?? slug,
            value: slug
          })),
          onChange: (value) => set(config.meta.priority, value),
          __nextHasNoMarginBottom: true
        }),
        hasShell() ? boardButton() : null
      );
    };
    const ProjectPanel = () => {
      const { meta, set } = useMeta();
      const users = toOptions(
        useUsers(),
        __("— Nobody —", "allterrain-work"),
        (row) => row.name ?? String(row.id)
      );
      return el(
        Panel,
        { name: "allterrain-work-project", title: __("Project", "allterrain-work") },
        el(SelectControl, {
          label: __("Lead", "allterrain-work"),
          value: String(meta[config.meta.lead] ?? 0),
          options: users,
          onChange: (value) => set(config.meta.lead, Number(value)),
          __nextHasNoMarginBottom: true
        }),
        el(SelectControl, {
          label: __("State", "allterrain-work"),
          value: String(meta[config.meta.state] ?? "active"),
          options: config.states.map((slug) => ({
            label: config.stateLabels[slug] ?? slug,
            value: slug
          })),
          onChange: (value) => set(config.meta.state, value),
          __nextHasNoMarginBottom: true
        }),
        dateField(
          __("Starts", "allterrain-work"),
          String(meta[config.meta.start] ?? ""),
          (value) => set(config.meta.start, value)
        ),
        dateField(
          __("Target", "allterrain-work"),
          String(meta[config.meta.target] ?? ""),
          (value) => set(config.meta.target, value)
        ),
        el(
          BaseControl,
          {
            label: __("Colour", "allterrain-work"),
            id: "atwork-project-colour",
            help: __("Worn by this project’s chips on the board.", "allterrain-work"),
            __nextHasNoMarginBottom: true
          },
          el(ColorPalette, {
            value: String(meta[config.meta.color] ?? "") || void 0,
            // `clearable` matters: the field is optional, and a palette
            // with no way back to "none" makes the first click permanent.
            clearable: true,
            onChange: (value) => set(config.meta.color, value ?? "")
          })
        ),
        hasShell() ? boardButton() : null
      );
    };
    const panelFor = config.postType === config.projectType ? ProjectPanel : TaskPanel;
    registerPlugin("allterrain-work-fields", { render: panelFor, icon: "clipboard" });
  }
})();
