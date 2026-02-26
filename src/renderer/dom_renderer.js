import {
  cacheElements,
  buildGrid,
  updateCells,
  setLegendIcons,
  resizeCanvas,
  setMessage,
  clearDropTarget,
  setDropTarget,
  showWallDragGhost,
  moveWallDragGhost,
  hideWallDragGhost,
} from '../renderer.js';

export function createDomRenderer(options = {}) {
  const icons = options.icons || {};
  const iconX = options.iconX || '';

  let refs = null;
  let lastBodyClassState = {
    isWallDragging: false,
    isPathDragging: false,
  };

  const setDraggingBodyClasses = (state = {}) => {
    if (typeof document === 'undefined' || !document.body) return;
    const nextWall = Boolean(state.isWallDragging);
    const nextPath = Boolean(state.isPathDragging);

    if (nextWall !== lastBodyClassState.isWallDragging) {
      document.body.classList.toggle('isWallDragging', nextWall);
      lastBodyClassState.isWallDragging = nextWall;
    }

    if (nextPath !== lastBodyClassState.isPathDragging) {
      document.body.classList.toggle('isPathDragging', nextPath);
      lastBodyClassState.isPathDragging = nextPath;
    }
  };

  return {
    mount(shellRefs = null) {
      refs = shellRefs || cacheElements();
      setLegendIcons(icons, refs, iconX);
    },

    getRefs() {
      return refs;
    },

    rebuildGrid(snapshot) {
      if (!refs) return;
      buildGrid(snapshot, refs, icons, iconX);
    },

    renderFrame({ snapshot, evaluation, uiModel = {}, interactionModel = {} }) {
      if (!refs) return;
      updateCells(snapshot, evaluation, refs);

      if (Object.prototype.hasOwnProperty.call(uiModel, 'messageHtml')) {
        setMessage(refs.msgEl, uiModel.messageKind || null, uiModel.messageHtml || '');
      }

      if (interactionModel.dropTarget && Number.isInteger(interactionModel.dropTarget.r) && Number.isInteger(interactionModel.dropTarget.c)) {
        setDropTarget(interactionModel.dropTarget.r, interactionModel.dropTarget.c);
      } else {
        clearDropTarget();
      }

      const ghost = interactionModel.wallGhost;
      if (ghost?.visible) {
        showWallDragGhost(ghost.x || 0, ghost.y || 0);
        moveWallDragGhost(ghost.x || 0, ghost.y || 0);
      } else {
        hideWallDragGhost();
      }

      setDraggingBodyClasses(interactionModel);

      if (refs.boardWrap && uiModel.tutorialFlags) {
        refs.boardWrap.classList.toggle('tutorialPathBrackets', Boolean(uiModel.tutorialFlags.path));
        refs.boardWrap.classList.toggle('tutorialMovableBrackets', Boolean(uiModel.tutorialFlags.movable));
      }
    },

    resize() {
      if (!refs) return;
      resizeCanvas(refs);
    },

    unmount() {
      clearDropTarget();
      hideWallDragGhost();
      setDraggingBodyClasses({ isWallDragging: false, isPathDragging: false });
    },
  };
}
