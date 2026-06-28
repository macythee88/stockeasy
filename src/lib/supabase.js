// src/lib/supabase.js
// Supabase client + offline sync queue using IndexedDB (via idb)

import { createClient } from '@supabase/supabase-js'
import { openDB } from 'idb'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Offline queue ────────────────────────────────────────────
// When offline, mutations are stored in IndexedDB and replayed when online.

const DB_NAME    = 'stockeasy-offline'
const STORE_NAME = 'pending-ops'

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) { db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true }) }
  })
}

export async function queueOperation(table, operation, data) {
  const db = await getDB()
  await db.add(STORE_NAME, { table, operation, data, timestamp: Date.now() })
}

export async function flushQueue() {
  if (!navigator.onLine) return
  const db = await getDB()
  const all = await db.getAll(STORE_NAME)
  for (const op of all) {
    try {
      if (op.operation === 'upsert') {
        await supabase.from(op.table).upsert(op.data)
      } else if (op.operation === 'delete') {
        await supabase.from(op.table).delete().eq('id', op.data.id)
      }
      await db.delete(STORE_NAME, op.id)
    } catch (e) {
      console.warn('Flush failed for op', op.id, e)
    }
  }
}

// Auto-flush when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    flushQueue()
  })
}

// ── Safe DB write (online = direct, offline = queue) ─────────
export async function safeUpsert(table, data) {
  if (navigator.onLine) {
    const { error } = await supabase.from(table).upsert(data)
    if (error) throw error
  } else {
    await queueOperation(table, 'upsert', data)
  }
}

export async function safeDelete(table, id) {
  if (navigator.onLine) {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
  } else {
    await queueOperation(table, 'delete', { id })
  }
}

// ── Photo upload to Supabase Storage ─────────────────────────
export async function uploadPhoto(file, productSku) {
  const ext  = file.name.split('.').pop()
  const path = `products/${productSku}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('product-photos').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('product-photos').getPublicUrl(path)
  return data.publicUrl
}
