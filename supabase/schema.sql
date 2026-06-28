-- ============================================================
-- StockEasy PWA — Supabase Database Schema
-- 在 Supabase Dashboard → SQL Editor 里运行这份文件
-- ============================================================

-- 1. 供应商 Suppliers
create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  whatsapp    text,
  email       text,
  notes       text,
  created_at  timestamptz default now()
);

-- 2. 产品 Products (含变体)
create table products (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references products(id) on delete cascade,
  name         text not null,
  variant_name text,
  sku          text not null unique,
  barcode      text,
  cost         numeric(10,2) default 0,
  price        numeric(10,2) default 0,
  shopee_sku   text,
  lazada_sku   text,
  min_stock    int default 30,
  reorder_days int default 30,
  has_expiry   boolean default false,
  platform     text default 'Shopee MY',
  supplier_id  uuid references suppliers(id),
  photo_url    text,
  created_at   timestamptz default now()
);

-- 3. 库存批次 Batches
create table batches (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products(id) on delete cascade,
  batch_no      text not null,
  qty           int not null default 0,
  received_date date not null default current_date,
  expiry_date   date,
  cost          numeric(10,2),
  po_id         uuid,
  created_at    timestamptz default now()
);

-- 4. 入货单 Purchase Orders
create table purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  po_number    text not null,
  supplier_id  uuid references suppliers(id),
  order_date   date not null default current_date,
  status       text default 'received',
  note         text,
  created_at   timestamptz default now()
);

-- 5. 入货单明细 PO Items
create table po_items (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid references purchase_orders(id) on delete cascade,
  product_id  uuid references products(id),
  qty         int not null,
  cost        numeric(10,2),
  expiry_date date,
  created_at  timestamptz default now()
);

-- 6. 平台订单 (导入的Shopee/Lazada订单)
create table platform_orders (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,
  order_id     text not null,
  product_id   uuid references products(id),
  qty          int not null,
  unit_price   numeric(10,2),
  platform_fee numeric(10,2),
  shipping     numeric(10,2),
  order_date   date,
  imported_at  timestamptz default now()
);

-- 7. 盘点记录 Stocktake
create table stocktakes (
  id           uuid primary key default gen_random_uuid(),
  taken_at     timestamptz default now(),
  note         text,
  items        jsonb
);

-- ── Storage bucket (在 Supabase Dashboard → Storage 手动创建) ──
-- Bucket name: product-photos
-- Public bucket: YES
-- 这个不能用SQL创建，需要在界面操作

-- ── Row Level Security (基本设置，之后加用户权限用) ──
alter table suppliers enable row level security;
alter table products enable row level security;
alter table batches enable row level security;
alter table purchase_orders enable row level security;
alter table po_items enable row level security;
alter table platform_orders enable row level security;
alter table stocktakes enable row level security;

-- 暂时允许所有操作（之后加用户登录再限制）
create policy "allow all" on suppliers for all using (true) with check (true);
create policy "allow all" on products for all using (true) with check (true);
create policy "allow all" on batches for all using (true) with check (true);
create policy "allow all" on purchase_orders for all using (true) with check (true);
create policy "allow all" on po_items for all using (true) with check (true);
create policy "allow all" on platform_orders for all using (true) with check (true);
create policy "allow all" on stocktakes for all using (true) with check (true);
