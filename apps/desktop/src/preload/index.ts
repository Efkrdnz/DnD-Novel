import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type GameApi, type TurnStreamEvent } from '../shared/ipc'

const api: GameApi = {
  listCampaigns: () => ipcRenderer.invoke(IPC.listCampaigns),
  createCampaign: (input) => ipcRenderer.invoke(IPC.createCampaign, input),
  loadCampaign: (id) => ipcRenderer.invoke(IPC.loadCampaign, id),
  renameCampaign: (id, name) => ipcRenderer.invoke(IPC.renameCampaign, id, name),
  listSnapshots: (campaignId) => ipcRenderer.invoke(IPC.snapshotsList, campaignId),
  createSnapshot: (campaignId, label) => ipcRenderer.invoke(IPC.snapshotsCreate, campaignId, label),
  rewindSnapshot: (campaignId, snapshotId) => ipcRenderer.invoke(IPC.snapshotsRewind, campaignId, snapshotId),
  branchSnapshot: (campaignId, snapshotId) => ipcRenderer.invoke(IPC.snapshotsBranch, campaignId, snapshotId),
  deleteSnapshot: (campaignId, snapshotId) => ipcRenderer.invoke(IPC.snapshotsDelete, campaignId, snapshotId),

  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  setApiKey: (connectionId, key) => ipcRenderer.invoke(IPC.setApiKey, connectionId, key),
  clearApiKey: (connectionId) => ipcRenderer.invoke(IPC.clearApiKey, connectionId),
  testConnection: (connectionId, model) => ipcRenderer.invoke(IPC.testConnection, connectionId, model),
  listModels: (connectionId) => ipcRenderer.invoke(IPC.listModels, connectionId),
  detectClis: () => ipcRenderer.invoke(IPC.detectClis),

  getTurns: (campaignId) => ipcRenderer.invoke(IPC.turnHistory, campaignId),
  sendTurn: (campaignId, text, requestId, addressee) => ipcRenderer.invoke(IPC.turnSend, campaignId, text, requestId, addressee),
  retryTurn: (campaignId, turnId, requestId) => ipcRenderer.invoke(IPC.turnRetry, campaignId, turnId, requestId),
  roll: (requestId, rollId) => ipcRenderer.invoke(IPC.turnRoll, requestId, rollId),
  cancelTurn: (requestId) => ipcRenderer.invoke(IPC.turnCancel, requestId),
  onTurnEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, turnEvent: TurnStreamEvent) => listener(turnEvent)
    ipcRenderer.on(IPC.turnEvent, handler)
    return () => ipcRenderer.removeListener(IPC.turnEvent, handler)
  },

  getJournal: (campaignId) => ipcRenderer.invoke(IPC.journal, campaignId),
  memoryStats: (campaignId) => ipcRenderer.invoke(IPC.memoryStats, campaignId),
  generateArt: (campaignId, target) => ipcRenderer.invoke(IPC.artGenerate, campaignId, target),
  generateModel3d: (campaignId, target) => ipcRenderer.invoke(IPC.artModel3d, campaignId, target),
  faceDraw: (campaignId, characterId, emotion) => ipcRenderer.invoke(IPC.artFace, campaignId, characterId, emotion),
  uploadArt: (campaignId, target) => ipcRenderer.invoke(IPC.artUpload, campaignId, target),
  setArtStyle: (campaignId, style) => ipcRenderer.invoke(IPC.artStyle, campaignId, style),
  setPresentation: (campaignId, patch) => ipcRenderer.invoke(IPC.campaignPresentation, campaignId, patch),
  addExpression: (campaignId, face) => ipcRenderer.invoke(IPC.expressionAdd, campaignId, face),
  removeExpression: (campaignId, faceId) => ipcRenderer.invoke(IPC.expressionRemove, campaignId, faceId),
  renameEra: (campaignId, eraId, name) => ipcRenderer.invoke(IPC.eraRename, campaignId, eraId, name),
  mergeEra: (campaignId, eraId) => ipcRenderer.invoke(IPC.eraMerge, campaignId, eraId),
  splitEra: (campaignId, eraId, entryId, name) => ipcRenderer.invoke(IPC.eraSplit, campaignId, eraId, entryId, name),
  equipItem: (campaignId, itemId, slot) => ipcRenderer.invoke(IPC.inventoryEquip, campaignId, itemId, slot),
  unequipItem: (campaignId, itemId) => ipcRenderer.invoke(IPC.inventoryUnequip, campaignId, itemId),
  heroOptions: (campaignId, concept) => ipcRenderer.invoke(IPC.heroOptions, campaignId, concept),
  worldPresets: () => ipcRenderer.invoke(IPC.worldPresets),
  importWorld: () => ipcRenderer.invoke(IPC.worldsImport),
  exportWorld: (source) => ipcRenderer.invoke(IPC.worldsExport, source),
  removeWorld: (id) => ipcRenderer.invoke(IPC.worldsRemove, id),
  worldSection: (answers, section, draft) => ipcRenderer.invoke(IPC.worldSection, answers, section, draft),
  createHero: (campaignId, archetype, attributes, name) => ipcRenderer.invoke(IPC.heroCreate, campaignId, archetype, attributes, name),
  setMode: (campaignId, mode) => ipcRenderer.invoke(IPC.campaignMode, campaignId, mode),
  suggestIdentity: (campaignId, answers) => ipcRenderer.invoke(IPC.characterSuggest, campaignId, answers),
  suggestCompanions: (campaignId, hero, wish) => ipcRenderer.invoke(IPC.characterCompanions, campaignId, hero, wish),
  createCharacter: (campaignId, setup) => ipcRenderer.invoke(IPC.characterCreate, campaignId, setup),
  editPerson: (campaignId, target, patch) => ipcRenderer.invoke(IPC.characterEdit, campaignId, target, patch),
  setRoute: (campaignId, choice) => ipcRenderer.invoke(IPC.campaignRoute, campaignId, choice),
}

contextBridge.exposeInMainWorld('game', api)
