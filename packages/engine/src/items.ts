import { z } from 'zod'

// The fixed item template. The AI invents items by filling it in; the app validates and stores them.
// Keep it Gemini-friendly: plain objects, arrays, enums, strings, numbers (no records or unions).

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const
export const RaritySchema = z.enum(RARITIES)

export const ITEM_TYPES = ['weapon', 'armor', 'accessory', 'consumable', 'material', 'quest', 'treasure', 'tool', 'misc'] as const

/** Icon catalog keys; the renderer maps each to an illustrated icon. Generated art replaces these in Phase 10. */
export const ICON_KEYS = [
  'sword', 'dagger', 'axe', 'hammer', 'spear', 'bow', 'staff', 'wand', 'shield',
  'armor', 'helmet', 'boots', 'gloves', 'cloak', 'ring', 'amulet', 'potion', 'scroll',
  'book', 'key', 'gem', 'coin', 'orb', 'herb', 'food', 'ore', 'bone', 'map', 'letter',
  'chest', 'tool', 'instrument', 'relic', 'misc',
] as const

export const MAX_STACK = 9999

export const ItemStatSchema = z.object({
  name: z.string().trim().min(1).max(24),
  value: z.number().int().min(-999).max(999),
})

export const ItemTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(ITEM_TYPES),
  rarity: RaritySchema,
  description: z.string().trim().min(1).max(400),
  stats: z.array(ItemStatSchema).max(8).default([]),
  effects: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  value: z.object({
    amount: z.number().int().min(0).max(1_000_000_000),
    currencyId: z.string().trim().min(1).max(40),
  }),
  icon: z.enum(ICON_KEYS),
  stackable: z.boolean().default(false),
})

/** Where the player can wear or wield gear. Which slots an item fits is derived from its type and icon (equipment.ts). */
export const EQUIP_SLOTS = ['mainHand', 'offHand', 'head', 'body', 'hands', 'feet', 'back', 'neck', 'ring1', 'ring2', 'trinket'] as const
export const EquipSlotSchema = z.enum(EQUIP_SLOTS)

/** A stored item: the template plus fields only the app sets. */
export const InventoryItemSchema = ItemTemplateSchema.extend({
  id: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_STACK),
  acquiredDay: z.number().int().min(1),
  source: z.string().max(200).default(''),
  /** Set while the item is worn or wielded. */
  equippedSlot: EquipSlotSchema.nullable().default(null),
  /** Generated art (asset ids in the campaign's art cache); the catalog `icon` stays the fallback. Never set by the AI. */
  art: z.string().optional(),
  model3d: z.string().optional(),
})

export type Rarity = z.infer<typeof RaritySchema>
export type ItemType = (typeof ITEM_TYPES)[number]
export type IconKey = (typeof ICON_KEYS)[number]
export type EquipSlot = (typeof EQUIP_SLOTS)[number]
export type ItemTemplate = z.infer<typeof ItemTemplateSchema>
export type InventoryItem = z.infer<typeof InventoryItemSchema>
