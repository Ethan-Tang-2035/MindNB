/** Shared contract between the native menu and the editor's existing actions. */
export type DesktopCommand = 'new' | 'import' | 'choose-vault' | 'save' | 'rename' | 'export-png' | 'export'
  | 'undo' | 'redo' | 'home' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'zoom-fit' | 'panel'
  | 'child' | 'sibling' | 'edit-node' | 'link'

export interface DesktopMenuState {
  vault: boolean
  document: boolean
  modal: boolean
  textEditing: boolean
  canUndo: boolean
  canRedo: boolean
  node: boolean
  sibling: boolean
}
export interface ExportSaveRequest { name: string; extension: string; bytes: Uint8Array }
export type ExportSaveResult = { canceled: true } | { canceled: false; path: string }
