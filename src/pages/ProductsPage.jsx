// src/pages/ProductsPage.jsx
import { useState, useRef } from 'react'
import { C, S, StatusBadge } from '../App'
import { uploadPhoto } from '../lib/supabase'

const EMPTY = { name:'', variant_name:'', sku:'', barcode:'', cost:'', price:'',
                shopee_sku:'', lazada_sku:'', min_stock:'30', reorder_days:'30',
                has_expiry:false, platform:'Shopee MY', supplier_id:'', photo_url:'', parent_id:null,
                default_location:'' }

function genBarcode(sku) {
  const d = sku.replace(/[^a-zA-Z0-9]/g,'').split('').map(c=>c.charCodeAt(0)%10).join('').slice(0,11).padEnd(11,'0')
  return '9'+d
}

function BarcodeDisplay({ value }) {
  if (!value) return null
  const bars=[]; let x=8
  for(let i=0;i<value.length;i++){
    const n=parseInt(value[i])||0
    for(let b=0;b<4;b++){
      const f=(n>>b)&1
      bars.push(<rect key={`${i}-${b}`} x={x} y={0} width={2} height={f?50:36} fill={f?'#0F1B2D':'#ccc'} rx={1}/>)
      x+=3
    }
    x+=2
  }
  return (
    <div style={{textAlign:'center',padding:'10px 0',background:C.cream,borderRadius:10}}>
      <svg width="100%" viewBox={`0 0 ${x+8} 66`} style={{maxWidth:260}}>
        {bars}
        <text x={(x+8)/2} y={62} textAnchor="middle" fontSize={10} fill={C.slate} fontFamily="monospace">{value}</text>
      </svg>
      <div style={{fontSize:10,color:C.slateLight}}>可截图打印贴在产品上</div>
    </div>
  )
}

// ── Product photo with broken-link detection ─────────────────
function ProductPhoto({ url, size=54, radius=10 }) {
  const [broken, setBroken] = useState(false)

  if (!url || broken) return (
    <div style={{width:size,height:size,borderRadius:radius,background:C.cream,
                 display:'flex',flexDirection:'column',alignItems:'center',
                 justifyContent:'center',fontSize:size>40?18:12,gap:2,
                 border:`1px dashed ${broken?C.yellow:C.slateLight}40`}}>
      {broken
        ? <><span>⚠️</span><span style={{fontSize:9,color:C.yellow,textAlign:'center',lineHeight:1.2}}>图片{'\n'}失效</span></>
        : <span>📦</span>
      }
    </div>
  )

  return (
    <img
      src={url}
      onError={() => setBroken(true)}
      style={{width:size,height:size,borderRadius:radius,objectFit:'cover',
              border:`1px solid ${C.cream}`}}
      alt=""
    />
  )
}

// ── 货架位置：点一下就能直接改，不用进完整编辑表单 ──────────────
function LocationBadge({ product, upsertProduct, shout }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(product.default_location || '')
  const [saving, setSaving]   = useState(false)

  const save = async () => {
    const next = val.trim()
    if (next === (product.default_location||'')) { setEditing(false); return }
    setSaving(true)
    try {
      // 传整个产品对象（只改 default_location 这个字段），避免 upsert 把其他栏位清空
      await upsertProduct({ ...product, default_location: next || null })
      shout(next ? `货架位置已设为 ${next} ✓` : '货架位置已清空')
    } catch(e) {
      shout('保存失败：' + (e.message || '请检查网络'), true)
      setVal(product.default_location || '')
    }
    setSaving(false); setEditing(false)
  }

  if (editing) return (
    <input autoFocus value={val} disabled={saving}
      onChange={e=>setVal(e.target.value)}
      onBlur={save}
      onKeyDown={e=>{
        if (e.key==='Enter') save()
        if (e.key==='Escape') { setVal(product.default_location||''); setEditing(false) }
      }}
      placeholder="如 A-01"
      style={{width:58,fontSize:10,padding:'2px 5px',borderRadius:5,
              border:`1px solid ${C.orange}`,fontFamily:'monospace',textAlign:'center'}}/>
  )

  return (
    <button onClick={()=>setEditing(true)}
      title="点击设置货架位置"
      style={{background: product.default_location?C.navy:'#fff',
              color: product.default_location?'#fff':C.slateLight,
              border:`1px dashed ${product.default_location?C.navy:C.slateLight}80`,
              borderRadius:6,padding:'2px 7px',fontSize:10,fontWeight:700,
              cursor:'pointer',fontFamily:'monospace',whiteSpace:'nowrap'}}>
      {saving ? '…' : (product.default_location ? `📍${product.default_location}` : '📍设置')}
    </button>
  )
}

export default function ProductsPage({ products, batches, suppliers, totalStock, upsertProduct, shout }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(EMPTY)
  const [editId, setEditId]     = useState(null)
  const [uploading, setUploading] = useState(false)
  const [searchQ, setSearchQ]   = useState('')
  const [onlyNoLocation, setOnlyNoLocation] = useState(false)
  const photoRef = useRef()

  const parentProducts = products.filter(p => !p.parent_id)
  const variantMap = {}
  products.filter(p => p.parent_id).forEach(p => {
    if (!variantMap[p.parent_id]) variantMap[p.parent_id] = []
    variantMap[p.parent_id].push(p)
  })

  const filtered = parentProducts.filter(p => {
    const matchQ = !searchQ ||
      p.name.toLowerCase().includes(searchQ.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQ.toLowerCase())
    if (!matchQ) return false
    if (onlyNoLocation) {
      const group = [p, ...(variantMap[p.id]||[])]
      if (!group.some(v => !v.default_location)) return false
    }
    return true
  })

  const handlePhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return
    if (!form.sku) { shout('请先填写 SKU，再上传照片', true); return }
    setUploading(true)
    try {
      const url = await uploadPhoto(file, form.sku)
      setForm(f => ({ ...f, photo_url: url }))
      shout('照片上传成功 ✓')
    } catch {
      const reader = new FileReader()
      reader.onload = ev => setForm(f => ({ ...f, photo_url: ev.target.result }))
      reader.readAsDataURL(file)
      shout('离线模式：照片暂存本地，联网后重新上传')
    }
    setUploading(false)
  }

  const handleSave = async () => {
    if (!form.name || !form.sku) { shout('请填写产品名称和 SKU', true); return }
    const data = {
      ...form,
      id:           editId || crypto.randomUUID(),
      cost:         parseFloat(form.cost)       || 0,
      price:        parseFloat(form.price)      || 0,
      min_stock:    parseInt(form.min_stock)    || 30,
      reorder_days: parseInt(form.reorder_days) || 30,
      supplier_id:  form.supplier_id  || null,
      parent_id:    form.parent_id    || null,
      default_location: form.default_location?.trim() || null,
    }
    try {
      await upsertProduct(data)
      shout(editId ? '产品已更新 ✓' : '产品已新增 ✓')
      setForm(EMPTY); setEditId(null); setShowForm(false)
    } catch(e) {
      console.error(e)
      shout('保存失败：' + (e.message || '请检查网络'), true)
    }
  }

  const openEdit = (p) => {
    setForm({ ...EMPTY, ...p,
      cost:             String(p.cost         || ''),
      price:            String(p.price        || ''),
      min_stock:        String(p.min_stock    || 30),
      reorder_days:     String(p.reorder_days || 30),
      supplier_id:      p.supplier_id || '',
      default_location: p.default_location || '',
    })
    setEditId(p.id); setShowForm(true)
  }

  // ── Form view ─────────────────────────────────────────────
  if (showForm) return (
    <div>
      <button onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY) }}
        style={{background:'none',border:'none',color:C.orange,fontWeight:700,fontSize:14,cursor:'pointer',paddingBottom:12}}>
        ← 返回
      </button>
      <div style={S.card}>
        <div style={S.secTitle}>{editId ? '编辑产品' : '新增产品'}{form.parent_id ? ' (变体)' : ''}</div>

        {/* Photo upload */}
        <div style={{textAlign:'center',marginBottom:16}}>
          <div onClick={() => photoRef.current?.click()}
            style={{width:88,height:88,borderRadius:14,background:C.cream,
                   border:`2px dashed ${C.slateLight}60`,margin:'0 auto 8px',
                   cursor:'pointer',display:'flex',alignItems:'center',
                   justifyContent:'center',overflow:'hidden'}}>
            {form.photo_url
              ? <ProductPhoto url={form.photo_url} size={88} radius={12}/>
              : <div style={{textAlign:'center',color:C.slate}}>
                  <div style={{fontSize:26}}>{uploading?'⏳':'📷'}</div>
                  <div style={{fontSize:10}}>{uploading?'上传中…':'上传照片'}</div>
                </div>
            }
          </div>
          <input ref={photoRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePhoto}/>
          <button onClick={() => photoRef.current?.click()}
            style={{background:'none',border:`1px solid ${C.orange}`,color:C.orange,
                   borderRadius:6,padding:'4px 12px',fontSize:12,cursor:'pointer'}}>
            {form.photo_url ? '更换照片' : '选择照片'}
          </button>
          <div style={{fontSize:10,color:C.slateLight,marginTop:4}}>
            上传到 Supabase Storage（永久保存）<br/>或直接填入图片网址
          </div>
          {/* Manual URL input */}
          <input style={{...S.inp,marginTop:8,fontSize:11}} placeholder="或直接贴上图片网址 (http://...)"
            value={form.photo_url||''} onChange={e=>setForm(f=>({...f,photo_url:e.target.value}))}/>
        </div>

        {/* Basic fields */}
        {[
          ['产品名称 *',          'name',         'text'],
          ['变体名称（颜色/尺寸）', 'variant_name', 'text'],
          ['内部 SKU *',          'sku',          'text'],
          ['货架位置（如 A-01）',  'default_location', 'text'],
          ['售价 RM',             'price',        'number'],
          ['进货成本 RM',         'cost',         'number'],
          ['Shopee SKU',          'shopee_sku',   'text'],
          ['Lazada SKU',          'lazada_sku',   'text'],
        ].map(([l,k,t]) => (
          <div key={k} style={{marginBottom:10}}>
            <label style={S.lbl}>{l}</label>
            <input type={t} style={S.inp} value={form[k]||''}
              onChange={e => setForm(f => ({...f,[k]:e.target.value}))}/>
          </div>
        ))}

        {/* Barcode */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>条形码</label>
          <div style={{display:'flex',gap:8,marginBottom:8}}>
            <input style={{...S.inp,flex:1,fontFamily:'monospace'}} placeholder="扫描或手动输入"
              value={form.barcode||''} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))}/>
            <button onClick={()=>{if(!form.sku){shout('先填SKU',true);return};setForm(f=>({...f,barcode:genBarcode(f.sku)}))}}
              style={{...S.btn('#3498DB',false,true),flexShrink:0}}>自动生成</button>
          </div>
          {form.barcode && <BarcodeDisplay value={form.barcode}/>}
        </div>

        {/* Reorder */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div><label style={S.lbl}>🔒 安全库存</label>
               <input type="number" style={S.inp} value={form.min_stock}
                 onChange={e=>setForm(f=>({...f,min_stock:e.target.value}))}/></div>
          <div><label style={S.lbl}>📈 补货天数</label>
               <input type="number" style={S.inp} value={form.reorder_days}
                 onChange={e=>setForm(f=>({...f,reorder_days:e.target.value}))}/></div>
        </div>

        {/* Supplier */}
        <div style={{marginBottom:12}}>
          <label style={S.lbl}>供应商</label>
          <select style={S.inp} value={form.supplier_id||''}
            onChange={e=>setForm(f=>({...f,supplier_id:e.target.value}))}>
            <option value="">— 选择供应商 —</option>
            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Expiry toggle */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                     background:C.purple+'10',borderRadius:8,padding:'10px 12px',marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:700}}>⏰ 效期管理</div>
            <div style={{fontSize:11,color:C.slate}}>食品、保养品、药品</div>
          </div>
          <div onClick={()=>setForm(f=>({...f,has_expiry:!f.has_expiry}))}
            style={{width:44,height:24,borderRadius:12,
                   background:form.has_expiry?C.purple:C.slateLight,
                   cursor:'pointer',position:'relative',transition:'all .2s'}}>
            <div style={{position:'absolute',top:2,left:form.has_expiry?22:2,
                         width:20,height:20,borderRadius:10,background:'#fff',transition:'all .2s'}}/>
          </div>
        </div>

        {/* Platform */}
        <div style={{marginBottom:16}}>
          <label style={S.lbl}>主要平台</label>
          <select style={S.inp} value={form.platform}
            onChange={e=>setForm(f=>({...f,platform:e.target.value}))}>
            {['Shopee MY','Shopee SG','Lazada MY','Lazada SG','多平台'].map(p=><option key={p}>{p}</option>)}
          </select>
        </div>

        <button onClick={handleSave} style={S.btn()}>
          💾 {editId ? '保存更改' : '新增产品'}
        </button>
      </div>
    </div>
  )

  // ── List view ─────────────────────────────────────────────
  return (
    <div>
      <button onClick={()=>{setForm(EMPTY);setEditId(null);setShowForm(true)}}
        style={{...S.btn(),marginBottom:12}}>+ 新增产品 / 变体</button>

      <div style={{marginBottom:12}}>
        <input style={S.inp} placeholder="搜索产品名或 SKU…"
          value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
      </div>

      {(() => {
        const missing = products.filter(v => !v.default_location).length
        return missing>0 && (
          <div onClick={()=>setOnlyNoLocation(v=>!v)}
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                   background: onlyNoLocation ? C.orange+'20' : C.navy+'08',
                   border:`1px solid ${onlyNoLocation?C.orange:C.navy}30`,
                   borderRadius:10,padding:'9px 12px',marginBottom:12,cursor:'pointer'}}>
            <span style={{fontSize:12,fontWeight:600,color:C.navy}}>
              📍 还有 <b style={{color:C.orange}}>{missing}</b> 个产品/变体没设货架位置
            </span>
            <span style={{fontSize:11,color:C.slate,fontWeight:700}}>
              {onlyNoLocation ? '✓ 只看这些' : '点击只看这些 →'}
            </span>
          </div>
        )
      })()}

      {/* Shopee image notice */}
      <div style={{background:C.yellow+'18',border:`1px solid ${C.yellow}40`,borderRadius:10,
                   padding:'10px 12px',marginBottom:12,fontSize:11,color:C.navy,lineHeight:1.6}}>
        ⚠️ <strong>Shopee 图片提示：</strong>图片来自 Shopee CDN，如产品下架图片会失效显示 ⚠️。
        建议重要产品另存图片到 Supabase Storage（编辑产品时上传）。
      </div>

      {filtered.length === 0 && (
        <div style={{...S.card,textAlign:'center',padding:'32px',color:C.slate}}>
          <div style={{fontSize:32,marginBottom:8}}>📦</div>
          <div>{searchQ ? '找不到相关产品' : '暂无产品，点上方新增'}</div>
        </div>
      )}

      {filtered.map(p => {
        const variants = variantMap[p.id] || []
        const allProds = [p, ...variants]
        return (
          <div key={p.id} style={{...S.card,borderLeft:`3px solid ${C.orange}`}}>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:10}}>
              <ProductPhoto url={p.photo_url} size={54} radius={10}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                <div style={{fontSize:11,color:C.slate,marginTop:2}}>
                  {variants.length>0 ? `${variants.length+1} 个变体` : p.variant_name||'无变体'}
                </div>
              </div>
              <button onClick={()=>openEdit(p)} style={S.btn(C.navyMid,false,true)}>✏</button>
            </div>

            {allProds.map(v => {
              const stock = totalStock(v.id)
              return (
                <div key={v.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                                        padding:'7px 10px',background:C.cream,borderRadius:8,marginBottom:6}}>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <ProductPhoto url={v.photo_url} size={28} radius={5}/>
                    <div>
                      <span style={{fontSize:12,fontWeight:600,color:C.orange}}>{v.variant_name||'默认'}</span>
                      <span style={{fontSize:10,color:C.slate,marginLeft:6,fontFamily:'monospace'}}>{v.sku}</span>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <StatusBadge stock={stock} min={v.min_stock}/>
                    <LocationBadge product={v} upsertProduct={upsertProduct} shout={shout}/>
                    <span style={{fontSize:15,fontWeight:900,
                                 color:stock<v.min_stock?C.red:C.navy}}>{stock}</span>
                    <button onClick={()=>openEdit(v)}
                      style={{background:'none',border:`1px solid ${C.slate}30`,
                             borderRadius:5,padding:'2px 6px',fontSize:10,cursor:'pointer',color:C.slate}}>
                      编辑
                    </button>
                  </div>
                </div>
              )
            })}

            <button onClick={()=>{
              setForm({...EMPTY,name:p.name,parent_id:p.id,
                      photo_url:p.photo_url,supplier_id:p.supplier_id||'',
                      default_location:p.default_location||''})
              setEditId(null); setShowForm(true)
            }} style={{...S.btn('#3498DB',true,true),marginTop:4}}>
              + 新增变体
            </button>
          </div>
        )
      })}
    </div>
  )
}
