import {
  ensureEditFlagged as ensureEditFlaggedFeature,
  getRawPulse as getRawPulseFeature,
  getDisplayPulse as getDisplayPulseFeature,
  backupEditMu as backupEditMuFeature,
  restoreEditBackup as restoreEditBackupFeature,
  recomputeEditDirty as recomputeEditDirtyFeature,
  getEditTotalSamples as getEditTotalSamplesFeature,
  getPulseViewMeta as getPulseViewMetaFeature,
  refreshEditTotals as refreshEditTotalsFeature,
  resetEditState as resetEditStateFeature,
  addSpikesInSelection as addSpikesInSelectionFeature,
  addArtifactInSelection as addArtifactInSelectionFeature,
  deleteSpikesInSelection as deleteSpikesInSelectionFeature,
  deleteDrInSelection as deleteDrInSelectionFeature,
  resetCurrentMuEdits as resetCurrentMuEditsFeature,
  duplicateMu as duplicateMuFeature,
} from "../../editing/operations.js";
import {
  renderEditExplorer as renderEditExplorerFeature,
  renderInstantaneousDr as renderInstantaneousDrFeature,
  renderEditTimeline as renderEditTimelineFeature,
  bindEditCanvas as bindEditCanvasFeature,
  bindEditDrCanvas as bindEditDrCanvasFeature,
  bindEditTimeline as bindEditTimelineFeature,
} from "../../view/edit-canvas.js";
import {
  saveEditedFile as saveEditedFileFeature,
  loadDecompositionForEdit as loadDecompositionForEditFeature,
  handleDecompositionFile as handleDecompositionFileFeature,
  requestRoiEdit as requestRoiEditFeature,
  requestFilterUpdate as requestFilterUpdateFeature,
  removeOutliers as removeOutliersFeature,
  flagMuForDeletion as flagMuForDeletionFeature,
  removeDuplicateMus as removeDuplicateMusFeature,
} from "../services/editing-service.js";
import {
  appendEditHistoryEntry,
  setEditProject,
  setEditCurrentMu,
  setEditCurrentMuGrid,
  setEditBookmark,
  setShowBookmark,
} from "../../state/actions.js";
import { getEditMuIndicesForGrid } from "../../state/selectors.js";

export function createEditStageService(deps) {
  const {
    state,
    els,
    API_BASE,
    apiFetch,
    apiJson,
    COLORS,
    drawSeries,
    getCanvasPlotMetrics,
    getSuggestedNpzName,
    persistNpzBySaveTarget,
    getBidsMuscleNames,
    buildEntityLabelFromSession,
    applySessionInfoFromDecomposition,
    showWorkspace,
    switchStage,
    setUploadLoading,
    setEditStatus,
    setEditMode,
    refreshEditModeButtons,
    renderBidsMuscleFields,
  } = deps;

  function ensureEditFlagged() {
    ensureEditFlaggedFeature(state);
  }

  function getRawPulse(muIdx) {
    return getRawPulseFeature(state, muIdx);
  }

  function getDisplayPulse(muIdx) {
    return getDisplayPulseFeature(state, muIdx);
  }

  function backupEditMu() {
    backupEditMuFeature(state);
    refreshEditModeButtons();
  }

  function recomputeEditDirty() {
    recomputeEditDirtyFeature(state);
  }

  function appendEditHistory(entry) {
    appendEditHistoryEntry(state, {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  function getEditTotalSamples() {
    return getEditTotalSamplesFeature(state);
  }

  function getPulseViewMeta() {
    return getPulseViewMetaFeature(state);
  }

  function refreshEditTotals() {
    refreshEditTotalsFeature(state);
  }

  function resetEditState() {
    resetEditStateFeature({ state, els, refreshEditModeButtons });
  }

  function getEditMuIndices(gridIdx) {
    return getEditMuIndicesForGrid(state, gridIdx);
  }

  function renderEditDropdowns() {
    const gridSel = els.editMuGridSelect;
    const muSel = els.editMuSelect;
    if (!gridSel || !muSel) return;

    gridSel.innerHTML = "";
    (state.edit.gridNames || []).forEach((name, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `Grid ${idx + 1}${name ? ` • ${name}` : ""}`;
      gridSel.appendChild(opt);
    });

    let targetGrid = state.edit.currentMuGrid || 0;
    let mus = getEditMuIndices(targetGrid);
    if (!mus.length && state.edit.gridNames?.length) {
      for (let g = 0; g < state.edit.gridNames.length; g++) {
        const list = getEditMuIndices(g);
        if (list.length) {
          targetGrid = g;
          mus = list;
          setEditCurrentMuGrid(state, g, { resetView: false });
          break;
        }
      }
    }
    gridSel.value = String(targetGrid);

    muSel.innerHTML = "";
    if (!mus.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No motor units";
      muSel.appendChild(opt);
      muSel.disabled = true;
      return;
    }
    muSel.disabled = false;
    mus.forEach((muIdx) => {
      const opt = document.createElement("option");
      opt.value = String(muIdx);
      opt.textContent = `MU ${muIdx + 1}`;
      muSel.appendChild(opt);
    });
    const currentMu = state.edit.currentMu;
    if (!mus.includes(currentMu)) {
      setEditCurrentMu(state, mus[0], { resetView: false });
    }
    muSel.value = String(state.edit.currentMu);
  }

  function renderInstantaneousDr() {
    renderInstantaneousDrFeature({
      state,
      els,
      COLORS,
      drawSeries,
      getEditTotalSamples,
      ensureEditFlagged,
    });
  }

  function renderEditExplorer() {
    renderEditExplorerFeature({
      els,
      state,
      COLORS,
      drawSeries,
      renderEditDropdowns,
      getDisplayPulse,
      renderInstantaneousDr,
      getCanvasPlotMetrics,
    });
    renderEditTimelineFeature({ els, state, COLORS, getDisplayPulse });
  }

  function restoreEditBackup() {
    restoreEditBackupFeature({
      state,
      setEditStatus,
      renderEditExplorer,
      recomputeEditDirty,
      ensureEditFlagged,
    });
  }

  async function requestRoiEdit(action, payload) {
    return requestRoiEditFeature(
      {
        state,
        API_BASE,
        apiJson,
        setEditStatus,
        ensureEditFlagged,
        setEditMode,
        recomputeEditDirty,
        renderEditExplorer,
        appendEditHistory,
      },
      action,
      payload,
    );
  }

  async function requestFilterUpdate(mode) {
    return requestFilterUpdateFeature(
      {
        state,
        els,
        API_BASE,
        apiJson,
        setEditStatus,
        getRawPulse,
        backupEditMu,
        buildEntityLabelFromSession,
        ensureEditFlagged,
        recomputeEditDirty,
        refreshEditTotals,
        renderEditExplorer,
        appendEditHistory,
      },
      mode,
    );
  }

  function updateMuFilter() {
    return requestFilterUpdate("update-filter");
  }

  function addSpikesInSelection(sel) {
    return addSpikesInSelectionFeature(
      {
        state,
        els,
        getRawPulse,
        backupEditMu,
        getPulseViewMeta,
        getCanvasPlotMetrics,
        requestRoiEdit,
      },
      sel,
    );
  }

  function addArtifactInSelection(sel) {
    return addArtifactInSelectionFeature(
      {
        state,
        els,
        getRawPulse,
        backupEditMu,
        getPulseViewMeta,
        getCanvasPlotMetrics,
        requestRoiEdit,
      },
      sel,
    );
  }

  function deleteSpikesInSelection(sel) {
    return deleteSpikesInSelectionFeature(
      {
        state,
        els,
        getRawPulse,
        backupEditMu,
        getPulseViewMeta,
        getCanvasPlotMetrics,
        requestRoiEdit,
      },
      sel,
    );
  }

  function deleteDrInSelection(sel) {
    return deleteDrInSelectionFeature(
      {
        state,
        els,
        backupEditMu,
        getCanvasPlotMetrics,
        getRawPulse,
        requestRoiEdit,
      },
      sel,
    );
  }

  async function removeOutliers() {
    return removeOutliersFeature({
      state,
      API_BASE,
      apiJson,
      setEditStatus,
      getRawPulse,
      backupEditMu,
      ensureEditFlagged,
      recomputeEditDirty,
      renderEditExplorer,
      appendEditHistory,
    });
  }

  async function flagMuForDeletion() {
    return flagMuForDeletionFeature({
      state,
      API_BASE,
      apiJson,
      setEditStatus,
      getRawPulse,
      backupEditMu,
      ensureEditFlagged,
      setEditBookmark,
      setShowBookmark,
      recomputeEditDirty,
      renderEditExplorer,
      appendEditHistory,
    });
  }

  function resetCurrentMuEdits() {
    resetCurrentMuEditsFeature({
      state,
      ensureEditFlagged,
      recomputeEditDirty,
      renderEditExplorer,
    });
  }

  async function removeDuplicateMus() {
    return removeDuplicateMusFeature({
      state,
      API_BASE,
      apiJson,
      setEditStatus,
      ensureEditFlagged,
      setEditBookmark,
      setShowBookmark,
      recomputeEditDirty,
      renderEditExplorer,
      appendEditHistory,
    });
  }

  function duplicateMu() {
    duplicateMuFeature({
      state,
      setEditStatus,
      ensureEditFlagged,
      recomputeEditDirty,
      renderEditExplorer,
      appendEditHistory,
    });
  }

  function bindEditCanvas() {
    bindEditCanvasFeature({
      els,
      state,
      getRawPulse,
      getCanvasPlotMetrics,
      renderEditExplorer,
      setEditStatus,
      addSpikesInSelection,
      addArtifactInSelection,
      deleteSpikesInSelection,
      setEditMode,
      setShowBookmark,
    });
  }

  function bindEditDrCanvas() {
    bindEditDrCanvasFeature({
      els,
      state,
      getCanvasPlotMetrics,
      getEditTotalSamples,
      renderEditExplorer,
      deleteDrInSelection,
    });
  }

  function bindEditTimeline() {
    bindEditTimelineFeature({
      els,
      state,
      getDisplayPulse,
      renderEditExplorer,
    });
  }

  function saveEditedFile() {
    return saveEditedFileFeature({
      state,
      getSuggestedNpzName,
      persistNpzBySaveTarget,
      getBidsMuscleNames,
      setEditStatus,
      recomputeEditDirty,
    });
  }

  function loadDecompositionForEdit(file, absolutePath) {
    return loadDecompositionForEditFeature(
      {
        state,
        apiFetch,
        apiJson,
        API_BASE,
        applySessionInfoFromDecomposition,
        ensureEditFlagged,
        recomputeEditDirty,
        showWorkspace,
        switchStage,
        renderEditExplorer,
        renderBidsMuscleFields,
        setUploadLoading,
        setEditStatus,
        resetEditState,
        els,
      },
      file,
      absolutePath,
    );
  }

  function loadDecompositionForEditByPath(path) {
    const name = path.split("/").pop().split("\\").pop() || path;
    return loadDecompositionForEdit({ name }, path);
  }

  function handleDecompositionFile(file) {
    return handleDecompositionFileFeature(
      { loadDecompositionForEdit: (f) => loadDecompositionForEdit(f) },
      file,
    );
  }

  return {
    getEditMuIndices,
    ensureEditFlagged,
    getRawPulse,
    getDisplayPulse,
    backupEditMu,
    recomputeEditDirty,
    refreshEditTotals,
    restoreEditBackup,
    renderEditExplorer,
    renderInstantaneousDr,
    bindEditCanvas,
    bindEditDrCanvas,
    bindEditTimeline,
    requestRoiEdit,
    requestFilterUpdate,
    updateMuFilter,
    addSpikesInSelection,
    addArtifactInSelection,
    deleteSpikesInSelection,
    deleteDrInSelection,
    removeOutliers,
    flagMuForDeletion,
    resetCurrentMuEdits,
    saveEditedFile,
    loadDecompositionForEdit,
    loadDecompositionForEditByPath,
    handleDecompositionFile,
    duplicateMu,
    removeDuplicateMus,
  };
}

/**
 * @typedef {import('../deps.js').EditSetupDeps} EditSetupDeps
 */

/**
 * @param {EditSetupDeps} deps
 */
export function setupEditEvents(deps) {
  const {
    els,
    state,
    bindEditCanvas,
    bindEditDrCanvas,
    bindEditTimeline,
    renderEditExplorer,
    runEditAction,
    saveEditedFile,
    resetCurrentMuEdits,
    updateMuFilter,
    removeOutliers,
    flagMuForDeletion,
    duplicateMu,
    removeDuplicateMus,
    restoreEditBackup,
    setEditMode,
    refreshEditModeButtons,
    handleKeyboardNavigation,
    applyLabeledToggle,
  } = deps;

  bindEditCanvas();
  bindEditDrCanvas();
  bindEditTimeline();

  els.editMuGridSelect?.addEventListener("change", (e) => {
    const idx = Number(e.target.value) || 0;
    setEditCurrentMuGrid(state, idx, { resetView: true });
    renderEditExplorer();
    e.target.blur();
  });

  els.editMuSelect?.addEventListener("change", (e) => {
    const idx = Number(e.target.value);
    setEditCurrentMu(state, idx, { resetView: true });
    renderEditExplorer();
    e.target.blur();
  });

  els.editSaveBtn?.addEventListener("click", () => {
    void runEditAction(els.editSaveBtn, saveEditedFile);
  });
  els.editResetBtn?.addEventListener("click", () => {
    void runEditAction(els.editResetBtn, () => resetCurrentMuEdits());
  });
  els.editUpdateBtn?.addEventListener("click", () => {
    void runEditAction(els.editUpdateBtn, updateMuFilter);
  });
  if (els.editPeelOffToggle) {
    const peelOffConfig = {
      shortSel: ".peeloff-short",
      fullSel: ".peeloff-full",
      prefix: "Peel-off",
    };
    applyLabeledToggle(els.editPeelOffToggle, false, peelOffConfig);
    els.editPeelOffToggle.addEventListener("click", () => {
      applyLabeledToggle(
        els.editPeelOffToggle,
        els.editPeelOffToggle.dataset.state !== "on",
        peelOffConfig,
      );
    });
  }
  if (els.editLockSpikesToggle) {
    const lockSpikesConfig = {
      shortSel: ".lockspikes-short",
      fullSel: ".lockspikes-full",
      prefix: "Lock",
    };
    applyLabeledToggle(els.editLockSpikesToggle, false, lockSpikesConfig);
    els.editLockSpikesToggle.addEventListener("click", () => {
      applyLabeledToggle(
        els.editLockSpikesToggle,
        els.editLockSpikesToggle.dataset.state !== "on",
        lockSpikesConfig,
      );
    });
  }
  els.editOutliersBtn?.addEventListener("click", () => {
    void runEditAction(els.editOutliersBtn, () => removeOutliers());
  });
  els.editFlagBtn?.addEventListener("click", () => {
    void runEditAction(els.editFlagBtn, () => flagMuForDeletion());
  });
  els.editDuplicateBtn?.addEventListener("click", () => {
    void runEditAction(els.editDuplicateBtn, () => duplicateMu());
  });
  els.editDeduplicateBtn?.addEventListener("click", () => {
    void runEditAction(els.editDeduplicateBtn, () => removeDuplicateMus());
  });
  els.editUndoBtn?.addEventListener("click", () => {
    void runEditAction(els.editUndoBtn, () => restoreEditBackup());
  });
  els.editAddBtn?.addEventListener("click", () => {
    setEditMode("add", "Drag a box on pulse train to add spikes");
  });
  els.editAddArtifactBtn?.addEventListener("click", () => {
    setEditMode(
      "add_artifact",
      "Drag a box on pulse train to mark an artifact",
    );
  });
  els.editDeleteSpikeBtn?.addEventListener("click", () => {
    setEditMode("delete_spikes", "Drag a box on pulse train to delete spikes");
  });

  els.bidsProject?.addEventListener("input", (e) => {
    setEditProject(state, e.target.value);
  });

  els.bidsPlacementScheme?.addEventListener("change", (e) => {
    const row = els.bidsPlacementDescRow;
    if (row) row.classList.toggle("hidden", e.target.value !== "Other");
  });

  refreshEditModeButtons();
  window.addEventListener("keydown", handleKeyboardNavigation);
}
