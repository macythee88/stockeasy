// src/pages/ImportPage.jsx
// Reusable Excel import tool for Shopee & Lazada
// Generates SQL that matches the same logic used in manual imports
// Supports: Shopee MY/SG (inventory/sales/media/basic)
//           Lazada MY/SG (pricestock/basic/skuimg)

import { useState, useRef } from 'react'
import { C, S } from '../App'
import * as XLSX from 'xlsx'

// ── Same categories as manual import ─────────────────────────
const CATEGORIES = {
  '维他命/保健品': ['vitamin','dhc','supplement','lutein','omega','collagen','probiotic',
                   'calcium','iron','coenzyme','spirulina','glucosamine','biotin','melatonin',
                   'profertil','zinc','blueberry','taurine','quercetin','fish oil','folic'],
  '护肤/美容':    ['serum','cream','lotion','toner','sunscreen','whitening','hada labo',
                   'biore','skincare','mask','facial','cleanser','spf','uv','beauty',
                   'ceramide','retinol','moistur'],
  '个人护理':     ['shampoo','conditioner','hair','dental','oral','body wash','deodorant',
                   'feminine','razor','shave'],
  '厨房/家居':    ['bottle','flask','thermos','kitchen','cookware','storage','container',
                   'bialetti','coffee','moka','pot','jar'],
  '母婴/儿童':    ['baby','kids','child','infant','toddler','tomica','toy','puzzle'],
  '健康/医疗':    ['mosquito','repellent','pain','relief','bandage','plaster','sanitizer'],
  '食品/饮料':    ['food','snack','drink','tea','chocolate','candy','noodle','sauce'],
  '文具/办公':    ['pen','pencil','notebook','stationery','tape','scissor'],
  '运动/户外':    ['sport','exercise','gym','yoga','outdoor','hiking','fitness'],
  '电子/配件':    ['usb','cable','charger','phone','earphone','bluetooth','battery'],
  '日本进口':     ['japan','japanese','nippon','tomica','made in japan'],
}

function getCategory(name) {
  const t = (name || '').toLowerCase()
  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    if (kws.some(k => t.includes(k))) return cat
  }
  return '其他'
}

function cleanName(name) {
  return (name || '').replace(/【.*?】/g, '').trim().slice(0, 120).replace(/'/g, "''")
}

function safeSku(s) {
  return (s || '').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 50)
}

function genUUID() {
  return crypto.randomUUID()
}

// ── Parse Excel file into rows ────────────────────────────────
function parseExcel(buffer, headerRowIndex = 4) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (raw.length <= headerRowIndex) return []
  const headers = raw[headerRowIndex].map(h => String(h).trim())
  const rows = []
  for (let i = headerRowIndex + 3; i < raw.length; i++) {
    const row = raw[i]
    if (!row[0] || !String(row[0]).trim()) continue
    const obj = {}
    headers.forEach((h, j) => { obj[h] = String(row[j] || '').trim() })
    rows.push(obj)
  }
  return rows
}

// ── Generate SQL (same logic as manual imports) ───────────────
function generateShopeeSQL(salesRows, mediaRows, platform) {
  const currency = platform.includes('MY') ? 'RM' : 'SGD'
  const prefix   = platform.includes('MY') ? 'SHPMY' : 'SHPSG'
  const batchTag = platform.includes('MY') ? 'LOT-SHPMY-IMPORT' : 'LOT-SHPSG-IMPORT'

  // Build media map: pid -> cover url
  const mediaMap = {}
  mediaRows.forEach(r => {
    const pid = r['Product ID']
    if (pid) mediaMap[pid] = r['Cover image'] || r['ps_item_cover_image'] || ''
  })

  // Group by Product ID
  const groups = {}
  salesRows.forEach(r => {
    const pid = r['Product ID']
    if (!pid) return
    if (!groups[pid]) groups[pid] = []
    groups[pid].push(r)
  })

  const seenSkus = {}
  const dedupSku = (sku) => {
    if (!seenSkus[sku]) { seenSkus[sku] = 0; return sku }
    seenSkus[sku]++
    return `${sku}-${seenSkus[sku]}`
  }

  const pRows = [], bRows = []

  Object.entries(groups).forEach(([pid, variants]) => {
    const first   = variants[0]
    const rawName = first['Product Name'] || ''
    const cname   = cleanName(rawName)
    const cat     = getCategory(rawName)
    const cover   = mediaMap[pid] || ''
    const imgSql  = cover ? `'${cover.replace(/'/g, "''")}'` : 'NULL'

    if (variants.length === 1 && !first['Variation Name']) {
      const v     = variants[0]
      const raw   = v['SKU'] || `${prefix}-${pid.slice(-10)}`
      const sku   = dedupSku(safeSku(raw) || `${prefix}-${pid.slice(-10)}`)
      const qty   = parseInt(v['Stock'] || v['Quantity'] || '0') || 0
      const price = parseFloat(v['Price'] || '0') || 0
      const vid   = genUUID()
      const shpSku = (v['SKU'] || '').replace(/'/g, "''")

      pRows.push(`('${vid}'::uuid, NULL::uuid, '${cname}', NULL, '${sku}', ` +
        `${price.toFixed(2)}, ${price.toFixed(2)}, '${shpSku}', NULL, ` +
        `30, 30, false, '${platform}', '${cat}', ${imgSql})`)
      if (qty > 0) bRows.push({ vid, sku, qty, price, tag: batchTag })
    } else {
      const parentId = genUUID()
      const psku     = dedupSku(`${prefix}-${pid.slice(-10)}-P`)
      pRows.push(`('${parentId}'::uuid, NULL::uuid, '${cname}', NULL, '${psku}', ` +
        `0, 0, '${pid}', NULL, 30, 30, false, '${platform}', '${cat}', ${imgSql})`)

      variants.forEach((v, i) => {
        const vid   = genUUID()
        const vname = (v['Variation Name'] || `Variant ${i+1}`).replace(/'/g, "''").slice(0, 80)
        const raw   = v['SKU'] || `${prefix}-${pid.slice(-10)}-V${i}`
        const vsku  = dedupSku(safeSku(raw) || `${prefix}-${pid.slice(-10)}-V${i}`)
        const qty   = parseInt(v['Stock'] || v['Quantity'] || '0') || 0
        const price = parseFloat(v['Price'] || '0') || 0
        const shpSku = (v['SKU'] || '').replace(/'/g, "''")

        pRows.push(`('${vid}'::uuid, '${parentId}'::uuid, '${cname}', '${vname}', '${vsku}', ` +
          `${price.toFixed(2)}, ${price.toFixed(2)}, '${shpSku}', NULL, ` +
          `30, 30, false, '${platform}', '${cat}', ${imgSql})`)
        if (qty > 0) bRows.push({ vid, sku: vsku, qty, price, tag: batchTag })
      })
    }
  })

  return { pRows, bRows, currency }
}

function generateLazadaSQL(priceRows, basicRows, imgRows, platform) {
  const currency = platform.includes('MY') ? 'RM' : 'SGD'
  const batchTag = platform.includes('MY') ? 'LOT-LZMY-IMPORT' : 'LOT-LZSG-IMPORT'

  const basicMap = {}
  basicRows.forEach(r => { if (r['Product ID']) basicMap[r['Product ID']] = r })

  const imgMap = {}
  imgRows.forEach(r => { if (r['SellerSKU']) imgMap[r['SellerSKU']] = r['Images1'] || '' })

  const groups = {}
  priceRows.forEach(r => {
    const pid = r['Product ID']
    if (!pid) return
    if (!groups[pid]) groups[pid] = []
    groups[pid].push(r)
  })

  const seenSkus = {}
  const dedupSku = (sku) => {
    if (!seenSkus[sku]) { seenSkus[sku] = 0; return sku }
    seenSkus[sku]++
    return `${sku}-${seenSkus[sku]}`
  }

  const pRows = [], bRows = []

  Object.entries(groups).forEach(([pid, variants]) => {
    const b       = basicMap[pid] || {}
    const rawName = b['Product Name'] || variants[0]['Product Name'] || ''
    const cname   = cleanName(rawName)
    const cat     = getCategory(rawName)
    const cover   = b['Product Images1'] || ''

    if (variants.length === 1) {
      const v      = variants[0]
      const selSku = v['SellerSKU'] || ''
      const sku    = dedupSku(safeSku(selSku) || `LZ-${pid.slice(-10)}`)
      const qty    = parseInt(v['Quantity'] || '0') || 0
      const price  = parseFloat(v['Price'] || '0') || 0
      const img    = imgMap[selSku] || cover
      const imgSql = img ? `'${img.replace(/'/g,"''")}' ` : 'NULL'
      const vid    = genUUID()
      const lzSku  = selSku.replace(/'/g,"''")

      pRows.push(`('${vid}'::uuid, NULL::uuid, '${cname}', NULL, '${sku}', ` +
        `${price.toFixed(2)}, ${price.toFixed(2)}, NULL, '${lzSku}', ` +
        `30, 30, false, '${platform}', '${cat}', ${imgSql})`)
      if (qty > 0) bRows.push({ vid, sku, qty, price, tag: batchTag })
    } else {
      const parentId = genUUID()
      const psku     = dedupSku(`LZ-${pid.slice(-10)}-P`)
      const imgSql   = cover ? `'${cover.replace(/'/g,"''")}'` : 'NULL'
      pRows.push(`('${parentId}'::uuid, NULL::uuid, '${cname}', NULL, '${psku}', ` +
        `0, 0, NULL, '${pid}', 30, 30, false, '${platform}', '${cat}', ${imgSql})`)

      variants.forEach((v, i) => {
        const vid    = genUUID()
        const vname  = (v['Variations Combo'] || `Variant ${i+1}`).replace(/'/g,"''").slice(0,80)
        const selSku = v['SellerSKU'] || ''
        const vsku   = dedupSku(safeSku(selSku) || `LZ-${pid.slice(-10)}-V${i}`)
        const qty    = parseInt(v['Quantity'] || '0') || 0
        const price  = parseFloat(v['Price'] || '0') || 0
        const img    = imgMap[selSku] || cover
        const imgSql = img ? `'${img.replace(/'/g,"''")}'` : 'NULL'
        const lzSku  = selSku.replace(/'/g,"''")

        pRows.push(`('${vid}'::uuid, '${parentId}'::uuid, '${cname}', '${vname}', '${vsku}', ` +
          `${price.toFixed(2)}, ${price.toFixed(2)}, NULL, '${lzSku}', ` +
          `30, 30, false, '${platform}', '${cat}', ${imgSql})`)
        if (qty > 0) bRows.push({ vid, sku: vsku, qty, price, tag: batchTag })
      })
    }
  })

  return { pRows, bRows, currency }
}

function buildFinalSQL(pRows, bRows, platform, currency) {
  const batchLines = bRows.map(({ vid, sku, qty, price, tag }) => {
    const bid    = genUUID()
    const cost   = (price * 0.5).toFixed(2)
    const skuEsc = sku.replace(/'/g, "''")
    return `INSERT INTO batches (id,product_id,batch_no,qty,received_date,expiry_date,cost)\n` +
           `SELECT '${bid}'::uuid, id, '${tag}', ${qty}, CURRENT_DATE, NULL, ${cost}\n` +
           `FROM products WHERE sku='${skuEsc}' LIMIT 1;`
  })

  const totalStock = bRows.reduce((s, r) => s + r.qty, 0)

  return {
    step1: `-- ============================================================
-- StockEasy: ${platform} 产品导入（自动生成）
-- 产品/变体: ${pRows.length} 条 | 货币: ${currency}
-- 生成时间: ${new Date().toLocaleString()}
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS category  TEXT DEFAULT '其他';
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;

INSERT INTO products
  (id, parent_id, name, variant_name, sku, cost, price,
   shopee_sku, lazada_sku, min_stock, reorder_days, has_expiry,
   platform, category, photo_url)
VALUES
${pRows.join(',\n')}
ON CONFLICT (sku) DO NOTHING;

SELECT COUNT(*) as "导入产品数" FROM products WHERE platform = '${platform}';`,

    step2: `-- ============================================================
-- StockEasy: ${platform} 库存批次（步骤2，Step1成功后运行）
-- 批次数: ${batchLines.length} | 总库存: ${totalStock} 件
-- 成本暂用售价50%，请在产品页更新实际成本
-- ============================================================

${batchLines.join('\n\n')}`
  }
}

// ── Download helper ───────────────────────────────────────────
function downloadSQL(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ════════════════════════════════════════════════════════════════
export default function ImportPage({ shout }) {
  const [platform,   setPlatform]   = useState('Shopee MY')
  const [files,      setFiles]      = useState({})
  const [processing, setProcessing] = useState(false)
  const [result,     setResult]     = useState(null)
  const [step,       setStep]       = useState(1)

  const isShopee = platform.startsWith('Shopee')
  const isLazada = platform.startsWith('Lazada')

  const FILE_SLOTS = isShopee
    ? [
        { key:'sales',  label:'Sales/Inventory Info Excel', desc:'Mass Update → Sales Info 或 Inventory Info' },
        { key:'media',  label:'Media Info Excel',            desc:'Mass Update → Media Info' },
      ]
    : [
        { key:'price',  label:'Price & Stock Excel',         desc:'Seller Centre → Manage Products → Export → pricestock' },
        { key:'basic',  label:'Basic Info Excel',             desc:'Manage Products → Export → basic' },
        { key:'skuimg', label:'SKU Image Excel (optional)',   desc:'Manage Products → Export → skuimg' },
      ]

  const handleFile = (key, e) => {
    const file = e.target.files[0]
    if (!file) return
    setFiles(prev => ({ ...prev, [key]: file }))
  }

  const allUploaded = FILE_SLOTS.filter(s => !s.label.includes('optional')).every(s => files[s.key])

  const processFiles = async () => {
    setProcessing(true)
    try {
      const readFile = (file) => new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = e => res(new Uint8Array(e.target.result))
        reader.onerror = rej
        reader.readAsArrayBuffer(file)
      })

      let pRows, bRows, currency

      if (isShopee) {
        const salesBuf = await readFile(files.sales)
        const mediaBuf = files.media ? await readFile(files.media) : null
        const salesRows = parseExcel(salesBuf)
        const mediaRows = mediaBuf ? parseExcel(mediaBuf) : []
        ;({ pRows, bRows, currency } = generateShopeeSQL(salesRows, mediaRows, platform))
      } else {
        const priceBuf  = await readFile(files.price)
        const basicBuf  = await readFile(files.basic)
        const imgBuf    = files.skuimg ? await readFile(files.skuimg) : null
        const priceRows = parseExcel(priceBuf, 2)
        const basicRows = parseExcel(basicBuf, 2)
        const imgRows   = imgBuf ? parseExcel(imgBuf, 2) : []
        ;({ pRows, bRows, currency } = generateLazadaSQL(priceRows, basicRows, imgRows, platform))
      }

      const sql = buildFinalSQL(pRows, bRows, platform, currency)
      setResult({ sql, pRows, bRows, platform, currency })
      shout(`✓ 已生成 ${pRows.length} 个产品，${bRows.length} 笔库存`)
    } catch (e) {
      shout('处理失败：' + (e.message || ''), true)
      console.error(e)
    }
    setProcessing(false)
  }

  const totalStock = result?.bRows.reduce((s,r) => s + r.qty, 0) || 0

  return (
    <div>
      {/* Header */}
      <div style={{ ...S.card, background: C.navy }}>
        <div style={{ color: C.orange, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          📥 Excel 导入工具
        </div>
        <div style={{ color: C.slateLight, fontSize: 12, lineHeight: 1.6 }}>
          上传平台 Excel → 自动生成 SQL → 在 Supabase 运行
        </div>
      </div>

      {/* Step 1: Platform */}
      <div style={S.card}>
        <div style={S.secTitle}>步骤 1：选择平台</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {['Shopee MY','Shopee SG','Lazada MY','Lazada SG'].map(p => (
            <button key={p} onClick={() => { setPlatform(p); setFiles({}); setResult(null) }}
              style={{
                padding:'8px 16px', borderRadius:20, border:'none', cursor:'pointer',
                background: platform===p ? C.orange : C.cream,
                color:      platform===p ? '#fff'   : C.slate,
                fontWeight: platform===p ? 700 : 400, fontSize: 13,
              }}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ marginTop:10, fontSize:11, color:C.slate }}>
          货币：<strong style={{ color:C.orange }}>
            {platform.includes('MY') ? 'RM (Malaysian Ringgit)' : 'SGD (Singapore Dollar)'}
          </strong>
        </div>
      </div>

      {/* Step 2: Upload files */}
      <div style={S.card}>
        <div style={S.secTitle}>步骤 2：上传 Excel 文件</div>
        {FILE_SLOTS.map(slot => (
          <div key={slot.key} style={{ marginBottom:14 }}>
            <label style={{ ...S.lbl, fontSize:12 }}>
              {slot.label}
              {slot.label.includes('optional') && (
                <span style={{ color:C.slateLight, fontWeight:400 }}> (选填)</span>
              )}
            </label>
            <div style={{ fontSize:10, color:C.slateLight, marginBottom:5 }}>{slot.desc}</div>
            <div style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'10px 12px', borderRadius:8, border:`1.5px dashed ${files[slot.key]?C.green:C.slateLight}50`,
              background: files[slot.key] ? C.green+'08' : C.cream, cursor:'pointer',
            }}
              onClick={() => document.getElementById(`file-${slot.key}`).click()}>
              <span style={{ fontSize:20 }}>{files[slot.key] ? '✅' : '📄'}</span>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:files[slot.key]?C.green:C.slate }}>
                  {files[slot.key] ? files[slot.key].name : '点击选择文件'}
                </div>
                {files[slot.key] && (
                  <div style={{ fontSize:10, color:C.slate }}>
                    {(files[slot.key].size / 1024).toFixed(0)} KB
                  </div>
                )}
              </div>
              <input id={`file-${slot.key}`} type="file" accept=".xlsx,.xls,.csv"
                style={{ display:'none' }} onChange={e => handleFile(slot.key, e)} />
            </div>
          </div>
        ))}

        <button onClick={processFiles} disabled={!allUploaded || processing}
          style={{
            ...S.btn(allUploaded && !processing ? C.green : C.slateLight),
            opacity: allUploaded ? 1 : 0.5,
          }}>
          {processing ? '⏳ 处理中…' : '⚙️ 生成导入 SQL'}
        </button>
      </div>

      {/* Step 3: Result */}
      {result && (
        <div>
          {/* Summary */}
          <div style={{ ...S.card, background:C.navy }}>
            <div style={{ color:C.orange, fontWeight:700, marginBottom:8 }}>✅ SQL 已生成</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                [result.pRows.length, '产品/变体'],
                [result.bRows.length, '库存批次'],
                [totalStock,          '总库存件数'],
                [result.currency,     '货币'],
              ].map(([v,l]) => (
                <div key={l} style={{ background:C.navyMid, borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ fontSize:18, fontWeight:900, color:C.orange }}>{v}</div>
                  <div style={{ fontSize:10, color:C.slateLight }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Important notes */}
          <div style={{ ...S.card, border:`1px solid ${C.yellow}40`, background:C.yellow+'08' }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.yellow, marginBottom:8 }}>⚠️ 运行前注意</div>
            {[
              '先运行 Step 1，看到 Success 后才运行 Step 2',
              '成本暂用售价 50% 估算，导入后请在产品页更新实际成本',
              'ON CONFLICT DO NOTHING — 重复 SKU 会自动跳过，安全',
              `图片来自${result.platform}CDN，产品下架后图片会失效`,
            ].map((note, i) => (
              <div key={i} style={{ fontSize:11, color:C.navy, marginBottom:4 }}>
                {i+1}. {note}
              </div>
            ))}
          </div>

          {/* Download buttons */}
          <div style={{ display:'flex', gap:8, marginBottom:12 }}>
            <button onClick={() => downloadSQL(result.sql.step1,
              `${result.platform.replace(' ','-')}-step1-products.sql`)}
              style={S.btn(C.green)}>
              ⬇ 下载 Step 1（产品）
            </button>
            <button onClick={() => downloadSQL(result.sql.step2,
              `${result.platform.replace(' ','-')}-step2-batches.sql`)}
              style={S.btn(C.blue)}>
              ⬇ 下载 Step 2（库存）
            </button>
          </div>

          {/* Supabase instructions */}
          <div style={{ ...S.card, background:C.navyLight }}>
            <div style={{ color:C.orange, fontWeight:700, fontSize:12, marginBottom:10 }}>
              📋 Supabase 运行步骤
            </div>
            {[
              ['1', '打开 Supabase → SQL Editor → New query'],
              ['2', '贴上 Step 1 内容 → 点 Run → 等待 Success'],
              ['3', '新建 query → 贴上 Step 2 → 点 Run'],
              ['4', '查看底部验证结果，确认产品数量正确'],
            ].map(([n, text]) => (
              <div key={n} style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:8 }}>
                <div style={{ background:C.orange, color:'#fff', borderRadius:'50%',
                              width:20, height:20, display:'flex', alignItems:'center',
                              justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>
                  {n}
                </div>
                <div style={{ fontSize:12, color:C.cream, lineHeight:1.5 }}>{text}</div>
              </div>
            ))}
          </div>

          {/* Preview */}
          <div style={S.card}>
            <div style={S.secTitle}>预览（前5个产品）</div>
            {result.pRows.slice(0, 5).map((row, i) => {
              const parts = row.match(/'([^']+)'/g) || []
              const name  = parts[2]?.replace(/'/g,'') || '—'
              const sku   = parts[4]?.replace(/'/g,'') || '—'
              return (
                <div key={i} style={{ paddingBottom:8, marginBottom:8,
                    borderBottom: i < 4 ? `1px solid ${C.cream}` : 'none' }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{name}</div>
                  <div style={{ fontSize:10, color:C.slate, fontFamily:'monospace' }}>SKU: {sku}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
