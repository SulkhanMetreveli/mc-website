// ============================================================================
// Met Capital — Document Management app (/admin/dms/)
// Port of the metreveli.org intranet document management system, running on
// this project's Supabase (tables dms_categories / dms_documents, bucket
// dms-files). Access requires the 'dms' app in the company panel.
// ============================================================================
(async () => {
  const session = await window.mcRequireAdminSession("/admin/dms/");
  if (!session) return;
  if (!window.mcHasApp("dms")) {
    window.location.href = "/admin/?denied_app=dms";
    return;
  }

  const sb = window.mcAdminClient;
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // dms-files bucket limit

  document.getElementById("logoutBtn").addEventListener("click", window.mcAdminLogout);

  /* ------------------------------------------------------------ helpers -- */
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function daysUntil(d) {
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(d); due.setHours(0, 0, 0, 0);
    return Math.round((due - today) / 86400000);
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function safeName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  /* --------------------------------------------------------- data layer -- */
  async function apiListCategories() {
    const [{ data: cats, error: e1 }, { data: docCats, error: e2 }] = await Promise.all([
      sb.from("dms_categories").select("*").order("name"),
      sb.from("dms_documents").select("category_id"),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const counts = {};
    (docCats || []).forEach((r) => {
      const k = r.category_id || "";
      counts[k] = (counts[k] || 0) + 1;
    });
    return {
      categories: (cats || []).map((c) => ({ ...c, document_count: counts[c.id] || 0 })),
      totalDocuments: (docCats || []).length,
    };
  }

  async function apiListDocuments({ categoryId, q, actionOnly }) {
    let query = sb.from("dms_documents").select("*").order("uploaded_at", { ascending: false }).limit(200);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (actionOnly) query = query.eq("action_required", true);
    if (q) {
      const cleaned = q.replace(/[,()%]/g, " ").trim();
      if (cleaned) query = query.or(`title.ilike.%${cleaned}%,description.ilike.%${cleaned}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function apiGetDocument(id) {
    const { data, error } = await sb.from("dms_documents").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  /* -------------------------------------------------------------- state -- */
  let categories = [];
  let totalDocuments = 0;
  let activeCategory = null; // null = all
  let editingDocId = null;
  let editingCategoryId = null;
  let docHasExistingFile = false;
  const selected = new Set();
  const collapsed = new Set();

  function openModal(id) { document.getElementById(id).classList.add("show"); }
  function closeModal(id) { document.getElementById(id).classList.remove("show"); }
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  /* ---------------------------------------------------- category tree ---- */
  function buildChildMap(list) {
    const map = new Map();
    list.forEach((c) => {
      const key = c.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }

  function flattenWithDepth(list, excludeId) {
    const map = buildChildMap(list);
    const out = [];
    function walk(parentKey, depth, excludeSubtree) {
      const children = map.get(parentKey) || [];
      children.forEach((c) => {
        if (excludeSubtree.has(c.id)) return;
        const isExcluded = c.id === excludeId;
        out.push({ ...c, depth });
        if (isExcluded) excludeSubtree.add(c.id);
        walk(c.id, depth + 1, excludeSubtree);
      });
    }
    walk("root", 0, new Set());
    return out;
  }

  function descendantIds(catId) {
    const map = buildChildMap(categories);
    const out = [];
    function walk(id) {
      (map.get(id) || []).forEach((c) => { out.push(c.id); walk(c.id); });
    }
    walk(catId);
    return out;
  }

  function buildCategoryOptions(selectEl, excludeId) {
    selectEl.innerHTML = selectEl.id === "categoryParent"
      ? '<option value="">— None (top level) —</option>'
      : '<option value="">Uncategorized</option>';
    flattenWithDepth(categories, excludeId).forEach((c) => {
      if (c.id === excludeId) return;
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = "—".repeat(c.depth) + (c.depth ? " " : "") + c.name;
      selectEl.appendChild(opt);
    });
  }

  function countWithDescendants(catId, map) {
    const cat = categories.find((c) => c.id === catId);
    let total = cat ? cat.document_count : 0;
    (map.get(catId) || []).forEach((child) => {
      total += countWithDescendants(child.id, map);
    });
    return total;
  }

  function renderTreeNode(cat, depth, map) {
    const children = map.get(cat.id) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(cat.id);
    const total = countWithDescendants(cat.id, map);
    const toggle = hasChildren
      ? `<button type="button" class="tree-toggle" data-toggle="${cat.id}">${isCollapsed ? "▸" : "▾"}</button>`
      : `<span class="tree-toggle tree-toggle-spacer"></span>`;
    let html = `
      <div class="tree-item ${activeCategory === cat.id ? "active" : ""}" data-cat="${cat.id}" data-depth="${depth}">
        ${toggle}
        <span class="tree-label">${escapeHtml(cat.name)}</span>
        <span class="count">${hasChildren ? total : cat.document_count}</span>
        <button type="button" class="tree-edit" data-edit="${cat.id}" title="Rename, move or delete this category">Edit</button>
      </div>`;
    if (hasChildren && !isCollapsed) {
      children.forEach((child) => { html += renderTreeNode(child, depth + 1, map); });
    }
    return html;
  }

  async function loadCategories() {
    const data = await apiListCategories();
    categories = data.categories;
    totalDocuments = data.totalDocuments;
    const map = buildChildMap(categories);
    const tree = document.getElementById("categoryTree");

    let html = `<div class="tree-item ${activeCategory === null ? "active" : ""}" data-cat="" data-depth="0">
        <span class="tree-toggle tree-toggle-spacer"></span>
        <span class="tree-label">All documents</span>
        <span class="count">${totalDocuments}</span>
      </div>`;
    (map.get("root") || []).forEach((cat) => { html += renderTreeNode(cat, 0, map); });
    tree.innerHTML = html;

    tree.querySelectorAll("[data-depth]").forEach((el) => {
      el.style.paddingLeft = `${16 + Number(el.dataset.depth || 0) * 20}px`;
    });
    tree.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCategoryForEdit(btn.dataset.edit);
      });
    });
    tree.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggle;
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        loadCategories();
      });
    });
    tree.querySelectorAll("[data-cat]").forEach((el) => {
      el.addEventListener("click", () => {
        activeCategory = el.dataset.cat || null;
        loadCategories();
        loadDocuments();
      });
    });
    buildCategoryOptions(document.getElementById("docCategory"));
  }

  /* ------------------------------------------------------ document list -- */
  function categoryName(id) {
    const c = categories.find((x) => x.id === id);
    return c ? c.name : null;
  }

  async function loadDocuments() {
    const q = document.getElementById("searchInput").value.trim();
    const actionOnly = document.getElementById("actionOnlyChk").checked;
    const docs = await apiListDocuments({ categoryId: activeCategory, q, actionOnly });
    const list = document.getElementById("docList");
    if (!docs.length) {
      list.innerHTML = '<div class="empty">No documents here yet.</div>';
      renderBulkBar();
      return;
    }
    list.innerHTML = docs.map((d) => {
      let badge = '<span class="badge none">No action</span>';
      if (d.action_required) {
        if (d.action_status === "done") badge = '<span class="badge done">Done</span>';
        else {
          const days = daysUntil(d.action_due_date);
          if (days === null) badge = '<span class="badge due-soon">Action needed</span>';
          else if (days < 0) badge = `<span class="badge overdue">Overdue ${Math.abs(days)}d</span>`;
          else badge = `<span class="badge due-soon">Due in ${days}d</span>`;
        }
      }
      return `
        <div class="item-row clickable-row${selected.has(d.id) ? " picked" : ""}" data-id="${d.id}">
          <input type="checkbox" class="pick" data-pick="${d.id}"${selected.has(d.id) ? " checked" : ""} aria-label="Select document">
          <div class="item-main">
            <div class="item-title">${escapeHtml(d.title)}</div>
            <div class="item-meta">${escapeHtml(categoryName(d.category_id) || "Uncategorized")} · ${escapeHtml(d.doc_type)}${d.file_name ? " · 📎 " + escapeHtml(d.file_name) : ""}</div>
          </div>
          ${badge}
        </div>`;
    }).join("");
    list.querySelectorAll("[data-id]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".pick")) return;
        openDocForEdit(el.dataset.id);
      });
    });
    list.querySelectorAll("[data-pick]").forEach((box) => {
      box.addEventListener("change", (e) => {
        e.stopPropagation();
        const id = box.dataset.pick;
        if (box.checked) selected.add(id); else selected.delete(id);
        box.closest(".item-row").classList.toggle("picked", box.checked);
        renderBulkBar();
      });
    });
    renderBulkBar();
  }

  function renderBulkBar() {
    const bar = document.getElementById("bulkBar");
    if (!bar) return;
    const visible = [...document.querySelectorAll("[data-pick]")];
    const n = selected.size;
    bar.classList.toggle("hidden", n === 0);
    document.getElementById("bulkCount").textContent = `${n} selected`;
    const all = document.getElementById("selectAllChk");
    all.checked = visible.length > 0 && visible.every((b) => selected.has(b.dataset.pick));
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll("[data-pick]").forEach((b) => {
      b.checked = false;
      b.closest(".item-row").classList.remove("picked");
    });
    renderBulkBar();
  }

  document.getElementById("searchInput").addEventListener("input", () => loadDocuments());
  document.getElementById("actionOnlyChk").addEventListener("change", () => loadDocuments());

  /* ------------------------------------------------------------ bulk move */
  document.getElementById("selectAllChk").addEventListener("change", (e) => {
    document.querySelectorAll("[data-pick]").forEach((b) => {
      b.checked = e.target.checked;
      if (e.target.checked) selected.add(b.dataset.pick); else selected.delete(b.dataset.pick);
      b.closest(".item-row").classList.toggle("picked", e.target.checked);
    });
    renderBulkBar();
  });
  document.getElementById("bulkClearBtn").addEventListener("click", clearSelection);

  document.getElementById("bulkMoveBtn").addEventListener("click", () => {
    if (!selected.size) return;
    document.getElementById("moveModalTitle").textContent =
      `Move ${selected.size} document${selected.size === 1 ? "" : "s"}`;
    buildCategoryOptions(document.getElementById("moveTarget"));
    document.getElementById("moveTarget").value = activeCategory || "";
    openModal("moveModal");
  });

  document.getElementById("confirmMoveBtn").addEventListener("click", async () => {
    const target = document.getElementById("moveTarget").value || null;
    const ids = [...selected];
    const btn = document.getElementById("confirmMoveBtn");
    btn.disabled = true;
    try {
      btn.textContent = `Moving ${ids.length}…`;
      const { error } = await sb.from("dms_documents")
        .update({ category_id: target, updated_at: new Date().toISOString() })
        .in("id", ids);
      closeModal("moveModal");
      clearSelection();
      await loadCategories();
      await loadDocuments();
      if (error) alert(`Could not move: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Move";
    }
  });

  /* ----------------------------------------------------------- category -- */
  document.getElementById("docActionRequired").addEventListener("change", (e) => {
    document.getElementById("actionFields").classList.toggle("hidden", !e.target.checked);
    document.getElementById("actionStatusField").classList.toggle("hidden", !e.target.checked);
  });

  document.getElementById("addCategoryBtn").addEventListener("click", () => {
    editingCategoryId = null;
    document.getElementById("categoryModalTitle").textContent = "New category";
    document.getElementById("categoryName").value = "";
    buildCategoryOptions(document.getElementById("categoryParent"));
    if (activeCategory) document.getElementById("categoryParent").value = activeCategory;
    document.getElementById("deleteCategoryBtn").classList.add("hidden");
    openModal("categoryModal");
  });

  function openCategoryForEdit(id) {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    editingCategoryId = id;
    document.getElementById("categoryModalTitle").textContent = cat.name;
    document.getElementById("categoryName").value = cat.name;
    buildCategoryOptions(document.getElementById("categoryParent"), id);
    document.getElementById("categoryParent").value = cat.parent_id || "";
    document.getElementById("deleteCategoryBtn").classList.remove("hidden");
    openModal("categoryModal");
  }

  document.getElementById("saveCategoryBtn").addEventListener("click", async () => {
    const name = document.getElementById("categoryName").value.trim();
    if (!name) { alert("A name is required."); return; }
    const parent_id = document.getElementById("categoryParent").value || null;
    const btn = document.getElementById("saveCategoryBtn");
    btn.disabled = true;
    try {
      let error;
      if (editingCategoryId) {
        ({ error } = await sb.from("dms_categories").update({ name, parent_id }).eq("id", editingCategoryId));
      } else {
        ({ error } = await sb.from("dms_categories").insert({ name, parent_id, created_by: session.user.id }));
      }
      if (error) throw error;
      if (parent_id) collapsed.delete(parent_id);
      closeModal("categoryModal");
      await loadCategories();
      await loadDocuments();
    } catch (err) {
      alert(`Could not save this category.\n\n${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  // Deleting an empty category just works. Anything with contents gets the
  // same promote/cascade choice as the original app.
  document.getElementById("deleteCategoryBtn").addEventListener("click", async () => {
    if (!editingCategoryId) return;
    const cat = categories.find((c) => c.id === editingCategoryId);
    if (!cat) return;
    const descendants = descendantIds(editingCategoryId);
    const map = buildChildMap(categories);
    const subtreeDocs = countWithDescendants(editingCategoryId, map);

    if (!descendants.length && !cat.document_count) {
      try {
        const { error } = await sb.from("dms_categories").delete().eq("id", editingCategoryId);
        if (error) throw error;
        closeModal("categoryModal");
        if (activeCategory === editingCategoryId) activeCategory = null;
        await loadCategories();
        await loadDocuments();
      } catch (err) {
        alert(`Could not delete this category.\n\n${err.message}`);
      }
      return;
    }

    showDeleteChoice({
      name: cat.name,
      has_parent: !!cat.parent_id,
      descendant_count: descendants.length,
      document_count: cat.document_count,
      subtree_document_count: subtreeDocs,
    });
  });

  function showDeleteChoice(info) {
    const bits = [];
    if (info.descendant_count) bits.push(`${info.descendant_count} subcategor${info.descendant_count === 1 ? "y" : "ies"}`);
    if (info.subtree_document_count) bits.push(`${info.subtree_document_count} document${info.subtree_document_count === 1 ? "" : "s"}`);
    const where = info.has_parent ? "the parent category" : "the top level";
    document.getElementById("catDeleteBody").innerHTML =
      `<p><strong>${escapeHtml(info.name)}</strong> contains ${bits.join(" and ")}.</p>
       <p><strong>Move contents up</strong> keeps everything: subcategories and documents are moved to ${where}, and only this category is removed.</p>
       <p><strong>Delete everything</strong> removes this category and all ${info.descendant_count} subcategor${info.descendant_count === 1 ? "y" : "ies"} beneath it. The ${info.subtree_document_count} document${info.subtree_document_count === 1 ? "" : "s"} inside are kept but become uncategorized — no files are deleted.</p>`;
    document.getElementById("catPromoteBtn").classList.toggle("hidden", !info.descendant_count && !info.document_count);
    openModal("catDeleteModal");
  }

  async function deleteWithStrategy(strategy) {
    if (!editingCategoryId) return;
    const cat = categories.find((c) => c.id === editingCategoryId);
    try {
      if (strategy === "promote") {
        const newParent = cat.parent_id || null;
        let r = await sb.from("dms_categories").update({ parent_id: newParent }).eq("parent_id", editingCategoryId);
        if (r.error) throw r.error;
        r = await sb.from("dms_documents").update({ category_id: newParent, updated_at: new Date().toISOString() }).eq("category_id", editingCategoryId);
        if (r.error) throw r.error;
        r = await sb.from("dms_categories").delete().eq("id", editingCategoryId);
        if (r.error) throw r.error;
      } else {
        // cascade: subtree docs become uncategorized, then delete the root
        // (parent_id FK cascades to descendants; documents FK sets null).
        const subtree = [editingCategoryId, ...descendantIds(editingCategoryId)];
        let r = await sb.from("dms_documents").update({ category_id: null, updated_at: new Date().toISOString() }).in("category_id", subtree);
        if (r.error) throw r.error;
        r = await sb.from("dms_categories").delete().eq("id", editingCategoryId);
        if (r.error) throw r.error;
      }
      closeModal("catDeleteModal");
      closeModal("categoryModal");
      if (activeCategory === editingCategoryId) activeCategory = null;
      await loadCategories();
      await loadDocuments();
    } catch (err) {
      alert(`Could not delete this category.\n\n${err.message}`);
    }
  }
  document.getElementById("catPromoteBtn").addEventListener("click", () => deleteWithStrategy("promote"));
  document.getElementById("catCascadeBtn").addEventListener("click", () => {
    if (confirm("Delete this category and every subcategory beneath it?")) deleteWithStrategy("cascade");
  });

  /* ----------------------------------------------------------- documents -- */
  function resetDocForm() {
    editingDocId = null;
    document.getElementById("docModalTitle").textContent = "New document";
    document.getElementById("docTitle").value = "";
    document.getElementById("docDescription").value = "";
    document.getElementById("docRelatedParty").value = "";
    document.getElementById("docType").value = "other";
    document.getElementById("docActionRequired").checked = false;
    document.getElementById("actionFields").classList.add("hidden");
    document.getElementById("actionStatusField").classList.add("hidden");
    document.getElementById("docActionDue").value = "";
    document.getElementById("docActionNote").value = "";
    document.getElementById("docFile").value = "";
    document.getElementById("existingFile").textContent = "";
    document.getElementById("deleteDocBtn").classList.add("hidden");
    docHasExistingFile = false;
    buildCategoryOptions(document.getElementById("docCategory"));
    document.getElementById("docCategory").value = activeCategory || "";
  }

  document.getElementById("addDocBtn").addEventListener("click", () => {
    resetDocForm();
    openModal("docModal");
  });

  async function openDocForEdit(id) {
    let d;
    try {
      d = await apiGetDocument(id);
    } catch (err) {
      alert(`Could not open this document.\n\n${err.message}`);
      return;
    }
    editingDocId = id;
    document.getElementById("docModalTitle").textContent = d.title;
    document.getElementById("docTitle").value = d.title || "";
    document.getElementById("docDescription").value = d.description || "";
    document.getElementById("docRelatedParty").value = d.related_party || "";
    document.getElementById("docType").value = d.doc_type || "other";
    document.getElementById("docActionRequired").checked = !!d.action_required;
    document.getElementById("actionFields").classList.toggle("hidden", !d.action_required);
    document.getElementById("actionStatusField").classList.toggle("hidden", !d.action_required);
    document.getElementById("docActionDue").value = d.action_due_date ? d.action_due_date.slice(0, 10) : "";
    document.getElementById("docActionNote").value = d.action_note || "";
    document.getElementById("docActionStatus").value = d.action_status === "done" ? "done" : "pending";
    document.getElementById("docFile").value = "";
    const existingFileEl = document.getElementById("existingFile");
    if (d.file_name) {
      const size = d.file_size ? ` (${formatBytes(Number(d.file_size))})` : "";
      existingFileEl.innerHTML =
        `Current file: <button type="button" class="text-link" id="downloadFileBtn">${escapeHtml(d.file_name)}</button>${size}`;
      document.getElementById("downloadFileBtn").addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
          const { data, error } = await sb.storage.from("dms-files").createSignedUrl(d.file_path, 120, { download: d.file_name });
          if (error || !data) throw (error || new Error("no url"));
          window.open(data.signedUrl, "_blank");
        } catch (err) {
          alert(`Could not download this file.\n\n${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    } else {
      existingFileEl.textContent = "No file attached.";
    }
    docHasExistingFile = !!d.file_name;
    buildCategoryOptions(document.getElementById("docCategory"));
    document.getElementById("docCategory").value = d.category_id || "";
    document.getElementById("deleteDocBtn").classList.remove("hidden");
    openModal("docModal");
  }

  function setBusy(busy, message) {
    const btn = document.getElementById("saveDocBtn");
    const status = document.getElementById("docUploadStatus");
    btn.disabled = busy;
    btn.textContent = busy ? "Saving…" : "Save";
    status.textContent = message || "";
    status.className = "hint" + (message ? " show" : "");
  }

  document.getElementById("saveDocBtn").addEventListener("click", async () => {
    const body = {
      title: document.getElementById("docTitle").value.trim(),
      description: document.getElementById("docDescription").value || null,
      related_party: document.getElementById("docRelatedParty").value || null,
      doc_type: document.getElementById("docType").value,
      category_id: document.getElementById("docCategory").value || null,
      action_required: document.getElementById("docActionRequired").checked,
      action_due_date: document.getElementById("docActionRequired").checked
        ? (document.getElementById("docActionDue").value || null) : null,
      action_note: document.getElementById("docActionNote").value || null,
      updated_at: new Date().toISOString(),
    };
    if (!body.title) { alert("Title is required."); return; }
    body.action_status = body.action_required
      ? (editingDocId ? document.getElementById("docActionStatus").value : "pending")
      : "none";

    const fileInput = document.getElementById("docFile");
    const file = fileInput.files && fileInput.files[0];
    if (!file && !docHasExistingFile) {
      const proceed = confirm("No document file is attached. Continue without attaching a file?");
      if (!proceed) return;
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      alert(`"${file.name}" is ${formatBytes(file.size)}. The maximum is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }

    try {
      setBusy(true, "Saving details…");
      let oldFilePath = null;
      if (editingDocId) {
        if (file) {
          const existing = await apiGetDocument(editingDocId);
          oldFilePath = existing.file_path;
        }
        const { error } = await sb.from("dms_documents").update(body).eq("id", editingDocId);
        if (error) throw error;
      } else {
        body.uploaded_by = session.user.id;
        const { data, error } = await sb.from("dms_documents").insert(body).select("id").single();
        if (error) throw error;
        editingDocId = data.id;
      }

      if (file) {
        setBusy(true, `Uploading ${formatBytes(file.size)}…`);
        const path = `${editingDocId}/${Date.now()}-${safeName(file.name)}`;
        const up = await sb.storage.from("dms-files").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (up.error) throw up.error;
        const { error } = await sb.from("dms_documents").update({
          file_path: path,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
          updated_at: new Date().toISOString(),
        }).eq("id", editingDocId);
        if (error) throw error;
        if (oldFilePath) {
          try { await sb.storage.from("dms-files").remove([oldFilePath]); } catch (e) { /* metadata already points at the new file */ }
        }
      }

      setBusy(false);
      closeModal("docModal");
      await loadCategories();
      await loadDocuments();
    } catch (err) {
      setBusy(false);
      alert(`Could not save this document.\n\n${err.message}`);
    }
  });

  document.getElementById("deleteDocBtn").addEventListener("click", async () => {
    if (!editingDocId) return;
    if (!confirm("Delete this document permanently?")) return;
    try {
      const d = await apiGetDocument(editingDocId);
      if (d.file_path) {
        try { await sb.storage.from("dms-files").remove([d.file_path]); } catch (e) { /* row cleanup still proceeds */ }
      }
      const { error } = await sb.from("dms_documents").delete().eq("id", editingDocId);
      if (error) throw error;
      closeModal("docModal");
      await loadCategories();
      await loadDocuments();
    } catch (err) {
      alert(`Could not delete this document.\n\n${err.message}`);
    }
  });

  /* ---------------------------------------------------------------- init -- */
  try {
    await loadCategories();
    await loadDocuments();
  } catch (err) {
    document.getElementById("docList").innerHTML =
      `<div class="empty">Could not load documents: ${escapeHtml(err.message)}. Make sure migration 015 has been run in Supabase.</div>`;
  }

  const params = new URLSearchParams(window.location.search);
  const docParam = params.get("doc");
  if (docParam) openDocForEdit(docParam);
})();
