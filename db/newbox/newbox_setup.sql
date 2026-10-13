-- ====================================================================
-- 新しい本番用データベースのセットアップSQL（テーブル + データの守り(RLS)）
-- 空の新しいSupabaseプロジェクトで、1回だけ実行する。
-- 方針: ログインしていない人は、何も読めない・書けない。管理者だけが、すべて読み書きできる。
-- ====================================================================

-- デモ環境用: 本番のテーブル定義を復元したSQL（自動生成）。Supabase の SQL Editor で実行する。
-- 何も入っていない新しいプロジェクトで、1回だけ実行する。
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table if not exists public."visit_requests" (
  "id" uuid default gen_random_uuid(),
  "customer_id" uuid not null,
  "work_date" date not null,
  "duration_min" integer,
  "window_start" time,
  "window_end" time,
  "preferred_team_id" uuid,
  "created_at" timestamptz default now() not null,
  "actual_arrival" time,
  "actual_departure" time,
  "recorded_by" uuid,
  "recorded_at" timestamptz,
  primary key ("id")
);

create table if not exists public."email_logs" (
  "id" uuid default gen_random_uuid(),
  "sent_at" timestamptz default now(),
  "to_email" text not null,
  "subject" text not null,
  "body" text,
  "related_type" text,
  "related_id" uuid,
  "status" text default 'sent',
  "error_message" text,
  "created_by" text,
  primary key ("id")
);

create table if not exists public."purchase_order_items" (
  "id" uuid default gen_random_uuid(),
  "purchase_order_id" uuid not null,
  "product_id" uuid,
  "product_name" text,
  "quantity" numeric default 1 not null,
  "unit_price" numeric default 0 not null,
  "received_quantity" numeric default 0,
  "source_order_item_id" uuid,
  "note" text,
  primary key ("id")
);

create table if not exists public."visit_route_stops" (
  "id" uuid default gen_random_uuid(),
  "route_id" uuid not null,
  "request_id" uuid not null,
  "seq" integer not null,
  "planned_arrival" time,
  "planned_departure" time,
  "travel_min_from_prev" integer,
  primary key ("id")
);

create table if not exists public."clinics" (
  "id" uuid default gen_random_uuid(),
  "name" text,
  "created_at" timestamp default now(),
  "address" text,
  "phone" text,
  "corporate_name" text,
  "contact" text,
  "email" text,
  "sales_rep" text,
  "closing_day" text default '月末',
  "clinic_type" text,
  "payment_terms" text default '翌月末',
  "bank_account" text,
  "active" boolean default true,
  "merged_into" uuid,
  "note" text,
  "credit_limit" numeric,
  "payment_method" text default '振込',
  "clinic_code" text,
  primary key ("id")
);

create table if not exists public."stocktake_items" (
  "id" uuid default gen_random_uuid(),
  "stocktake_id" uuid not null,
  "product_id" uuid not null,
  "system_stock" numeric not null,
  "counted_stock" numeric,
  "diff" numeric,
  "reason" text,
  "note" text,
  primary key ("id")
);

create table if not exists public."inventory_categories" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid not null,
  "name" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."tooth_chart_template_items" (
  "id" uuid default gen_random_uuid(),
  "template_id" uuid not null,
  "position" text not null,
  "product_id" uuid,
  "product_name" text,
  primary key ("id")
);

create table if not exists public."supplier_invoice_items" (
  "id" uuid default gen_random_uuid(),
  "supplier_invoice_id" uuid not null,
  "line_no" integer,
  "delivery_date" date,
  "delivery_number" text,
  "supplier_product_code" text,
  "jan_code" text,
  "product_name" text,
  "manufacturer" text,
  "pack_size" text,
  "quantity" numeric,
  "unit_price" numeric,
  "amount" numeric,
  "tax_rate" numeric default 10,
  "matched_stock_receipt_id" uuid,
  "matched_product_id" uuid,
  "match_status" text default 'unmatched',
  "match_score" numeric,
  "match_note" text,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."inventory_logs" (
  "id" uuid default gen_random_uuid(),
  "product_id" uuid,
  "change_type" text not null,
  "quantity" integer not null,
  "memo" text,
  "created_at" timestamp default now(),
  primary key ("id")
);

create table if not exists public."product_suppliers" (
  "id" uuid default gen_random_uuid(),
  "product_id" uuid not null,
  "supplier_id" uuid not null,
  "supplier_product_code" text,
  "supplier_price" numeric,
  "is_default" boolean default false,
  "lead_time_days" integer,
  "min_order_quantity" integer,
  primary key ("id")
);

create table if not exists public."notification_settings" (
  "id" smallint default 1,
  "smtp_host" text,
  "smtp_port" integer default 587,
  "smtp_user" text,
  "smtp_pass_encrypted" text,
  "from_email" text,
  "from_name" text default '株式会社 清新',
  "notify_new_order" boolean default true,
  "notify_payment_overdue" boolean default false,
  "notify_low_stock" boolean default false,
  primary key ("id")
);

create table if not exists public."supplier_invoices" (
  "id" uuid default gen_random_uuid(),
  "supplier_id" uuid not null,
  "invoice_number" text,
  "invoice_date" date,
  "period_start" date,
  "period_end" date,
  "total_amount" numeric,
  "computed_total" numeric,
  "tax_amount" numeric,
  "pdf_filename" text,
  "pdf_data" jsonb,
  "status" text default '未照合',
  "matched_at" timestamptz,
  "confirmed_at" timestamptz,
  "confirmed_by" text,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."orders" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid,
  "status" text,
  "created_at" timestamp default now(),
  "total_price" integer,
  "delivery_number" text,
  "invoice_id" uuid,
  "confirmed_at" timestamptz,
  "prepared_at" timestamptz,
  "delivered_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "sales_rep" text,
  "note" text,
  "source" text default 'admin',
  "delivery_slip_id" uuid,
  "orderer_name" text,
  primary key ("id")
);

create table if not exists public."tooth_chart_templates" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."bank_imports" (
  "id" uuid default gen_random_uuid(),
  "imported_at" timestamptz default now(),
  "filename" text,
  "bank_name" text,
  "total_lines" integer,
  "matched_lines" integer default 0,
  "total_amount" numeric default 0,
  "matched_amount" numeric default 0,
  "imported_by" text,
  primary key ("id")
);

create table if not exists public."profiles" (
  "id" uuid,
  "clinic_id" uuid,
  "role" text default 'clinic',
  "created_at" timestamp default now(),
  "login_code" text,
  "visit_team_id" uuid,
  primary key ("id")
);

create table if not exists public."visit_customers" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "address" text not null,
  "lat" double precision,
  "lng" double precision,
  "phone" text,
  "default_duration_min" integer default 30 not null,
  "note" text,
  "created_at" timestamptz default now() not null,
  primary key ("id")
);

create table if not exists public."visit_shifts" (
  "id" uuid default gen_random_uuid(),
  "team_id" uuid not null,
  "work_date" date not null,
  "start_time" time not null,
  "end_time" time not null,
  "break_start" time,
  "break_end" time,
  "created_at" timestamptz default now() not null,
  primary key ("id")
);

create table if not exists public."favorites" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid not null,
  "product_id" uuid not null,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."supplier_prices" (
  "id" uuid default gen_random_uuid(),
  "supplier_id" uuid not null,
  "product_id" uuid not null,
  "unit_price" numeric not null,
  "pack_size" text,
  "note" text,
  "last_received_at" timestamptz,
  "updated_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."visit_shift_members" (
  "id" uuid default gen_random_uuid(),
  "shift_id" uuid not null,
  "staff_id" uuid not null,
  primary key ("id")
);

create table if not exists public."notices" (
  "id" uuid default gen_random_uuid(),
  "title" text not null,
  "body" text,
  "is_active" boolean default true,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."bank_payment_lines" (
  "id" uuid default gen_random_uuid(),
  "bank_import_id" uuid,
  "paid_on" date not null,
  "amount" numeric not null,
  "payer_name" text,
  "memo" text,
  "matched_invoice_id" uuid,
  "matched_payment_id" uuid,
  "status" text default '未消込',
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."history_lines" (
  "id" bigint,
  "batch" text not null,
  "slip_date" date not null,
  "slip_no" text,
  "kind" text not null,
  "partner_code" text,
  "partner_name" text,
  "clinic_id" uuid,
  "supplier_id" uuid,
  "maker_name" text,
  "item_code" text,
  "item_name" text,
  "product_id" uuid,
  "unit_price" numeric,
  "quantity" numeric,
  "amount" numeric,
  "profit" numeric,
  "memo" text,
  primary key ("id")
);

create table if not exists public."products" (
  "id" uuid default gen_random_uuid(),
  "name" text,
  "product_code" text,
  "manufacturer" text,
  "price" integer,
  "cost" integer,
  "stock" integer default 0,
  "reorder_level" integer default 10,
  "unit" text,
  "category" text,
  "is_active" boolean default true,
  "created_at" timestamp default now(),
  "barcode" text,
  "image_url" text,
  "active" boolean default true,
  "tax_rate" numeric default 0.1,
  "location" text,
  "lot_managed" boolean default false,
  "expiry_managed" boolean default false,
  "default_supplier_id" uuid,
  "lead_time_days" integer default 7,
  "stock_quantity" integer default 0,
  "min_stock" integer default 0,
  "is_stock_managed" boolean default false,
  "shelf_no" text,
  "supplier" text,
  "purchase_maker" text,
  "stocktake_exclude" boolean default false,
  "search_key" text,
  "master_product_id" uuid,
  primary key ("id")
);

create table if not exists public."suppliers" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "maker_name" text,
  "contact" text,
  "phone" text,
  "email" text,
  "address" text,
  "notes" text,
  "created_at" timestamptz default now() not null,
  "active" boolean default true,
  "fax" text,
  "lead_time_days" integer default 7,
  "min_order_amount" numeric default 0,
  "note" text,
  "short_name" text,
  "postal_code" text,
  "supplier_code" text,
  primary key ("id")
);

create table if not exists public."feedback_notes" (
  "id" uuid default gen_random_uuid(),
  "page" text,
  "content" text not null,
  "priority" text default '中' not null,
  "status" text default '未対応' not null,
  "created_at" timestamptz default now() not null,
  primary key ("id")
);

create table if not exists public."quotes" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid,
  "quote_number" text not null,
  "issue_date" date default CURRENT_DATE not null,
  "expiry_date" date,
  "subtotal" integer default 0 not null,
  "tax" integer default 0 not null,
  "total" integer default 0 not null,
  "status" text default 'draft' not null,
  "notes" text,
  "invoice_id" uuid,
  "created_at" timestamptz default now() not null,
  "title" text,
  primary key ("id")
);

create table if not exists public."palladium_prices" (
  "id" uuid default gen_random_uuid(),
  "date" date not null,
  "cast_well_price" integer,
  "cast_well_toka" boolean default false,
  "para_z_price" integer,
  "para_z_toka" boolean default false,
  "cast_master_price" integer,
  "cast_master_toka" boolean default false,
  "ishifuku_price" integer,
  "ishifuku_toka" boolean default false,
  "memo" text,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."visit_routes" (
  "id" uuid default gen_random_uuid(),
  "work_date" date not null,
  "team_id" uuid not null,
  "generated_at" timestamptz default now() not null,
  "total_distance_km" double precision,
  "total_duration_min" integer,
  primary key ("id")
);

create table if not exists public."stocktakes" (
  "id" uuid default gen_random_uuid(),
  "taken_on" date not null,
  "status" text default '進行中',
  "note" text,
  "created_at" timestamptz default now(),
  "finalized_at" timestamptz,
  "created_by" text,
  primary key ("id")
);

create table if not exists public."invoices" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid,
  "invoice_number" text not null,
  "issue_date" date default CURRENT_DATE not null,
  "due_date" date,
  "subtotal" integer default 0 not null,
  "tax" integer default 0 not null,
  "total" integer default 0 not null,
  "status" text default 'issued' not null,
  "paid_at" timestamptz,
  "paid_amount" integer,
  "notes" text,
  "created_at" timestamptz default now() not null,
  "billing_period_start" date,
  "billing_period_end" date,
  "sent_at" timestamptz,
  "sent_to" text,
  "note" text,
  primary key ("id")
);

create table if not exists public."quote_items" (
  "id" uuid default gen_random_uuid(),
  "quote_id" uuid,
  "product_id" uuid,
  "product_name" text,
  "quantity" integer default 1 not null,
  "price" integer default 0 not null,
  "sort_order" integer default 0,
  "list_price" integer,
  "cost" integer,
  primary key ("id")
);

create table if not exists public."order_items" (
  "id" uuid default gen_random_uuid(),
  "order_id" uuid,
  "product_id" uuid,
  "quantity" integer,
  "price" integer,
  "product_name" text,
  "purchase_status" text default '未発注',
  "purchased_at" timestamp,
  "delivered_quantity" integer default 0,
  "backorder_quantity" integer default 0,
  "delivery_status" text default '未処理',
  "shipped_quantity" numeric default 0,
  "purchase_order_item_id" uuid,
  "lot_number" text,
  primary key ("id")
);

create table if not exists public."clinic_product_prices" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid not null,
  "product_id" uuid not null,
  "unit_price" numeric not null,
  "effective_from" date,
  "note" text,
  primary key ("id")
);

create table if not exists public."visit_staff" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  primary key ("id")
);

create table if not exists public."stock_receipts" (
  "id" uuid default gen_random_uuid(),
  "product_id" uuid,
  "quantity" integer default 0,
  "memo" text,
  "created_at" timestamp default now(),
  "supplier_id" uuid,
  "unit_price" integer,
  "product_name" text,
  "lot_number" text,
  "expiry_date" date,
  "received_by" text,
  "damaged_quantity" numeric default 0,
  "supplier_invoice_item_id" uuid,
  primary key ("id")
);

create table if not exists public."stock_movements" (
  "id" uuid default gen_random_uuid(),
  "product_id" uuid not null,
  "movement_type" text not null,
  "quantity" numeric not null,
  "before_stock" numeric,
  "after_stock" numeric,
  "ref_type" text,
  "ref_id" uuid,
  "reason" text,
  "occurred_at" timestamptz default now(),
  "created_by" text,
  primary key ("id")
);

create table if not exists public."supplier_product_mappings" (
  "id" uuid default gen_random_uuid(),
  "supplier_id" uuid,
  "supplier_product_code" text,
  "supplier_jan" text,
  "supplier_product_name" text,
  "product_id" uuid,
  "unit_quantity_per_pack" integer default 1,
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."manufacturers" (
  "id" uuid default gen_random_uuid(),
  "name" text,
  primary key ("id")
);

create table if not exists public."repair_orders" (
  "id" uuid default gen_random_uuid(),
  "receipt_number" text,
  "clinic_id" uuid,
  "contact_person" text,
  "equipment_name" text not null,
  "model_number" text,
  "fault_description" text,
  "desired_delivery_date" date,
  "repair_destination" text default '自社対応',
  "status" text default '受付中',
  "notes" text,
  "created_at" timestamptz default now(),
  "updated_at" timestamptz default now(),
  "manufacturer" text,
  primary key ("id")
);

create table if not exists public."company_settings" (
  "id" smallint default 1,
  "company_name" text default '株式会社 清新' not null,
  "postal_code" text,
  "address" text,
  "phone" text,
  "fax" text,
  "email" text,
  "representative" text,
  "invoice_registration_number" text,
  "bank_account" text,
  "bank_name" text,
  "bank_branch" text,
  "bank_type" text,
  "bank_number" text,
  "bank_holder" text,
  "seal_image_url" text,
  "logo_image_url" text,
  "invoice_footer" text,
  "updated_at" timestamptz default now(),
  "updated_by" text,
  "lat" double precision,
  "lng" double precision,
  primary key ("id")
);

create table if not exists public."visit_teams" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "vehicle" text,
  "active" boolean default true not null,
  "created_at" timestamptz default now() not null,
  primary key ("id")
);

create table if not exists public."sales_reps" (
  "id" uuid default gen_random_uuid(),
  "name" text not null,
  "email" text,
  "phone" text,
  "active" boolean default true,
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."supplier_product_aliases" (
  "id" uuid default gen_random_uuid(),
  "supplier_id" uuid not null,
  "supplier_product_code" text,
  "supplier_product_name" text,
  "product_id" uuid not null,
  "confidence" text default 'manual',
  "last_used_at" timestamptz default now(),
  "created_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."invoice_payments" (
  "id" uuid default gen_random_uuid(),
  "invoice_id" uuid not null,
  "paid_at" timestamptz not null,
  "amount" numeric not null,
  "method" text default '振込',
  "note" text,
  "created_at" timestamptz default now(),
  "created_by" text,
  primary key ("id")
);

create table if not exists public."clinic_inventory_items" (
  "id" uuid default gen_random_uuid(),
  "image_no" text,
  "image_row_no" integer,
  "product_code" text,
  "barcode" text,
  "maker" text,
  "product_name" text,
  "spec" text,
  "capacity" text,
  "color" text,
  "stock_quantity" integer default 0,
  "min_stock" integer default 1,
  "category" text,
  "supplier" text,
  "is_stock_managed" boolean default true,
  "shelf_no" text,
  "note" text,
  "created_at" timestamp default now(),
  "location" text,
  "units_per_package" integer,
  "product_id" uuid,
  "unit" text,
  "clinic_id" uuid,
  "sealed_boxes" integer,
  "item_image_url" text,
  "stock_unit" text,
  primary key ("id")
);

create table if not exists public."clinic_prices" (
  "id" uuid default gen_random_uuid(),
  "clinic_id" uuid not null,
  "product_id" uuid not null,
  "unit_price" numeric not null,
  "note" text,
  "last_sold_at" timestamptz,
  "updated_at" timestamptz default now(),
  primary key ("id")
);

create table if not exists public."delivery_slips" (
  "id" uuid default gen_random_uuid(),
  "slip_number" text,
  "clinic_id" uuid,
  "delivered_on" date not null,
  "delivered_by" text,
  "carrier" text,
  "tracking_number" text,
  "total_amount" numeric default 0,
  "note" text,
  "status" text default '出荷準備',
  "created_at" timestamptz default now(),
  "shipped_at" timestamptz,
  "delivered_at" timestamptz,
  primary key ("id")
);

create table if not exists public."purchase_orders" (
  "id" uuid default gen_random_uuid(),
  "manufacturer" text,
  "status" text default '未発注',
  "created_at" timestamp default now(),
  "po_number" text,
  "supplier_id" uuid,
  "ordered_at" timestamptz,
  "expected_at" date,
  "total_amount" numeric default 0,
  "note" text,
  "created_by" text,
  "sent_method" text,
  "sent_at" timestamptz,
  primary key ("id")
);

create table if not exists public."categories" (
  "id" uuid default gen_random_uuid(),
  "name" text,
  primary key ("id")
);

create table if not exists public."order_drafts" (
  "id" uuid default gen_random_uuid(),
  "client_id" text,
  "clinic_id" uuid,
  "payload" jsonb not null,
  "status" text default 'pending',
  "created_at" timestamptz default now(),
  "committed_at" timestamptz,
  "committed_order_id" uuid,
  primary key ("id")
);

create table if not exists public."audit_logs" (
  "id" uuid default gen_random_uuid(),
  "occurred_at" timestamptz default now(),
  "actor" text,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" uuid,
  "before_data" jsonb,
  "after_data" jsonb,
  "note" text,
  primary key ("id")
);

alter table public."visit_requests" add constraint "visit_requests_customer_id_fkey" foreign key ("customer_id") references public."visit_customers"("id");
alter table public."visit_requests" add constraint "visit_requests_preferred_team_id_fkey" foreign key ("preferred_team_id") references public."visit_teams"("id");
alter table public."purchase_order_items" add constraint "purchase_order_items_purchase_order_id_fkey" foreign key ("purchase_order_id") references public."purchase_orders"("id");
alter table public."purchase_order_items" add constraint "purchase_order_items_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."visit_route_stops" add constraint "visit_route_stops_route_id_fkey" foreign key ("route_id") references public."visit_routes"("id");
alter table public."visit_route_stops" add constraint "visit_route_stops_request_id_fkey" foreign key ("request_id") references public."visit_requests"("id");
alter table public."clinics" add constraint "clinics_merged_into_fkey" foreign key ("merged_into") references public."clinics"("id");
alter table public."stocktake_items" add constraint "stocktake_items_stocktake_id_fkey" foreign key ("stocktake_id") references public."stocktakes"("id");
alter table public."stocktake_items" add constraint "stocktake_items_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."tooth_chart_template_items" add constraint "tooth_chart_template_items_template_id_fkey" foreign key ("template_id") references public."tooth_chart_templates"("id");
alter table public."tooth_chart_template_items" add constraint "tooth_chart_template_items_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."supplier_invoice_items" add constraint "supplier_invoice_items_supplier_invoice_id_fkey" foreign key ("supplier_invoice_id") references public."supplier_invoices"("id");
alter table public."supplier_invoice_items" add constraint "supplier_invoice_items_matched_stock_receipt_id_fkey" foreign key ("matched_stock_receipt_id") references public."stock_receipts"("id");
alter table public."supplier_invoice_items" add constraint "supplier_invoice_items_matched_product_id_fkey" foreign key ("matched_product_id") references public."products"("id");
alter table public."inventory_logs" add constraint "inventory_logs_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."product_suppliers" add constraint "product_suppliers_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."product_suppliers" add constraint "product_suppliers_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."supplier_invoices" add constraint "supplier_invoices_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."orders" add constraint "orders_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."orders" add constraint "orders_invoice_id_fkey" foreign key ("invoice_id") references public."invoices"("id");
alter table public."orders" add constraint "orders_delivery_slip_id_fkey" foreign key ("delivery_slip_id") references public."delivery_slips"("id");
alter table public."profiles" add constraint "profiles_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."profiles" add constraint "profiles_visit_team_id_fkey" foreign key ("visit_team_id") references public."visit_teams"("id");
alter table public."visit_shifts" add constraint "visit_shifts_team_id_fkey" foreign key ("team_id") references public."visit_teams"("id");
alter table public."favorites" add constraint "favorites_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."favorites" add constraint "favorites_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."supplier_prices" add constraint "supplier_prices_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."supplier_prices" add constraint "supplier_prices_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."visit_shift_members" add constraint "visit_shift_members_shift_id_fkey" foreign key ("shift_id") references public."visit_shifts"("id");
alter table public."visit_shift_members" add constraint "visit_shift_members_staff_id_fkey" foreign key ("staff_id") references public."visit_staff"("id");
alter table public."bank_payment_lines" add constraint "bank_payment_lines_bank_import_id_fkey" foreign key ("bank_import_id") references public."bank_imports"("id");
alter table public."bank_payment_lines" add constraint "bank_payment_lines_matched_invoice_id_fkey" foreign key ("matched_invoice_id") references public."invoices"("id");
alter table public."bank_payment_lines" add constraint "bank_payment_lines_matched_payment_id_fkey" foreign key ("matched_payment_id") references public."invoice_payments"("id");
alter table public."history_lines" add constraint "history_lines_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."history_lines" add constraint "history_lines_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."history_lines" add constraint "history_lines_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."products" add constraint "products_default_supplier_id_fkey" foreign key ("default_supplier_id") references public."suppliers"("id");
alter table public."quotes" add constraint "quotes_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."quotes" add constraint "quotes_invoice_id_fkey" foreign key ("invoice_id") references public."invoices"("id");
alter table public."visit_routes" add constraint "visit_routes_team_id_fkey" foreign key ("team_id") references public."visit_teams"("id");
alter table public."invoices" add constraint "invoices_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."quote_items" add constraint "quote_items_quote_id_fkey" foreign key ("quote_id") references public."quotes"("id");
alter table public."quote_items" add constraint "quote_items_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."order_items" add constraint "order_items_order_id_fkey" foreign key ("order_id") references public."orders"("id");
alter table public."clinic_product_prices" add constraint "clinic_product_prices_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."clinic_product_prices" add constraint "clinic_product_prices_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."stock_receipts" add constraint "stock_receipts_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."stock_receipts" add constraint "stock_receipts_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."stock_receipts" add constraint "stock_receipts_supplier_invoice_item_id_fkey" foreign key ("supplier_invoice_item_id") references public."supplier_invoice_items"("id");
alter table public."stock_movements" add constraint "stock_movements_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."supplier_product_mappings" add constraint "supplier_product_mappings_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."supplier_product_mappings" add constraint "supplier_product_mappings_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."repair_orders" add constraint "repair_orders_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."supplier_product_aliases" add constraint "supplier_product_aliases_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."supplier_product_aliases" add constraint "supplier_product_aliases_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."invoice_payments" add constraint "invoice_payments_invoice_id_fkey" foreign key ("invoice_id") references public."invoices"("id");
alter table public."clinic_inventory_items" add constraint "clinic_inventory_items_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."clinic_inventory_items" add constraint "clinic_inventory_items_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."clinic_prices" add constraint "clinic_prices_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."clinic_prices" add constraint "clinic_prices_product_id_fkey" foreign key ("product_id") references public."products"("id");
alter table public."delivery_slips" add constraint "delivery_slips_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."purchase_orders" add constraint "purchase_orders_supplier_id_fkey" foreign key ("supplier_id") references public."suppliers"("id");
alter table public."order_drafts" add constraint "order_drafts_clinic_id_fkey" foreign key ("clinic_id") references public."clinics"("id");
alter table public."order_drafts" add constraint "order_drafts_committed_order_id_fkey" foreign key ("committed_order_id") references public."orders"("id");

-- ===== 商品マスター・検索用の列 =====
-- 商品マスター（データランド等の外部マスタ）を「辞書」として保持し、
-- 実際に使う商品（products）へは、必要になった品目だけを移行する構成にする。
-- 既存データは変更しない（テーブル追加 + products に紐づけ列を1つ追加するだけ）。

create extension if not exists pg_trgm;

create table if not exists public.master_products (
  id          uuid primary key default gen_random_uuid(),
  item_code   text not null unique,        -- 品目コード（例: 0202X5001）
  jan         text,
  maker_kana  text,
  name_kana   text,
  name        text not null,
  list_price  numeric,
  source      text not null default 'dataland',
  search_key  text,                        -- 検索用（全角半角・ひらがな/カタカナ・空白の違いを無視）。自動で入る
  created_at  timestamptz not null default now()
);

create or replace function public.master_products_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := lower(
    regexp_replace(
      translate(
        normalize(
          coalesce(new.name, '') || ' ' || coalesce(new.name_kana, '') || ' ' ||
          coalesce(new.item_code, '') || ' ' || coalesce(new.jan, '') || ' ' || coalesce(new.maker_kana, ''),
          NFKC),
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ',
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ'),
      '\s+', '', 'g'));
  return new;
end;
$$;

drop trigger if exists master_products_set_search_key_trg on public.master_products;
create trigger master_products_set_search_key_trg
  before insert or update of name, name_kana, item_code, jan, maker_kana on public.master_products
  for each row execute function public.master_products_set_search_key();

create index if not exists master_products_jan_idx        on public.master_products (jan);
create index if not exists master_products_search_trgm_idx on public.master_products using gin (search_key gin_trgm_ops);


-- 使う商品 → マスター品目への紐づけ
alter table public.products
  add column if not exists master_product_id uuid references public.master_products(id) on delete set null;
create index if not exists products_master_product_id_idx on public.products (master_product_id);

-- 商品検索を速くするための検索用の列（products.search_key）。
-- 商品名・コード・メーカー・カテゴリを、「全角半角・大文字小文字・ひらがな/カタカナ・空白」の違いを無視できる形にして持つ。
-- アプリは、この列を使って、必要な商品だけをサーバーで検索する（全商品を読み込まずに済む）。
-- 既存のデータは変更しない（列の追加と、自動で値を入れる仕組みの追加のみ）。

create extension if not exists pg_trgm;

alter table public.products add column if not exists search_key text;

create or replace function public.products_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := lower(
    regexp_replace(
      translate(
        normalize(
          coalesce(new.name, '') || ' ' || coalesce(new.product_code, '') || ' ' ||
          coalesce(new.manufacturer, '') || ' ' || coalesce(new.category, ''),
          NFKC),
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ',
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ'),
      '\s+', '', 'g'));
  return new;
end;
$$;

drop trigger if exists products_set_search_key_trg on public.products;
create trigger products_set_search_key_trg
  before insert or update of name, product_code, manufacturer, category on public.products
  for each row execute function public.products_set_search_key();

-- 既存の全商品に値を入れる（名前を同じ値で更新して、上のトリガーを動かす）
update public.products set name = name;

create index if not exists products_search_key_trgm_idx on public.products using gin (search_key gin_trgm_ops);

-- 医院マスターに「バッジの文字」を追加する。
-- 注文管理の医院名の隣に、紫色のバッジとして表示される（例: 個人分、要注意、至急対応）。
-- 既存のデータは変更しない（列を1つ足すだけ）。
alter table public.clinics add column if not exists badge_label text;

-- ===== 関数 =====
-- 管理者かどうか（RLSの判定に使う。security definer で profiles の制限に引っかからない）
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- 医院ログイン用の関数（医院ログインは未使用。ログイン画面がエラーにならないよう、常に「該当なし」を返す）
create or replace function public.get_email_by_login_code(p_code text) returns text
language sql stable as $$ select null::text $$;

-- 在庫を増減し、在庫の動きに記録する（管理画面の「使用」ボタンで使用）。呼び出した人の権限(RLS)で動く
create or replace function public.change_product_stock(
  target_product_id uuid, change_amount integer, change_type_text text, memo_text text
) returns void
language plpgsql security invoker as $$
declare
  before_qty integer;
begin
  select coalesce(stock, 0) into before_qty from public.products where id = target_product_id for update;
  if not found then raise exception '商品が見つかりません'; end if;
  update public.products set stock = before_qty + change_amount where id = target_product_id;
  insert into public.stock_movements (product_id, movement_type, quantity, before_stock, after_stock, ref_type, reason, occurred_at)
  values (target_product_id, coalesce(nullif(change_type_text, ''), '調整'), change_amount, before_qty, before_qty + change_amount, 'manual', memo_text, now());
end;
$$;

-- ===== データの守り(RLS) =====
-- すべてのテーブルで RLS を有効にし、管理者だけが、読み書きできるようにする。
-- 未ログイン（anon）は、権限そのものを外す（二重の守り）。
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('drop policy if exists admin_all on public.%I', t.tablename);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t.tablename);
  end loop;
end $$;

-- ログインした本人は、自分の行だけ読める（ログイン後の「自分の権限の確認」に必要）
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ===== 新着注文のリアルタイム通知 =====
alter publication supabase_realtime add table public.orders;
