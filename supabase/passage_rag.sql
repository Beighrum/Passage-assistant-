-- Passage Theatre Drive RAG schema
-- Requires: pgvector extension (Supabase: extensions schema)

create extension if not exists vector;

-- Raw document record (one per Drive file)
create table if not exists public.passage_documents (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  drive_web_view_link text,
  name text not null,
  mime_type text not null,
  modified_time timestamptz,
  checksum text,
  size_bytes bigint,
  text_content text,
  fts tsvector generated always as (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(text_content,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists passage_documents_fts_idx
  on public.passage_documents using gin (fts);

-- Chunk-level embeddings for retrieval
-- NOTE: This assumes Voyage `voyage-4` at 1024 dims (default).
create table if not exists public.passage_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.passage_documents(id) on delete cascade,
  drive_file_id text not null,
  chunk_index int not null,
  content text not null,
  content_hash text not null,
  embedding vector(1024) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists passage_chunks_doc_idx
  on public.passage_chunks (document_id, chunk_index);

create index if not exists passage_chunks_hash_idx
  on public.passage_chunks (drive_file_id, content_hash);

-- Use cosine distance by default (safe for unnormalized embeddings)
create index if not exists passage_chunks_embedding_hnsw
  on public.passage_chunks
  using hnsw (embedding vector_cosine_ops);

-- Track incremental indexing progress
create table if not exists public.passage_index_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running', -- running|complete|failed
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  root_folder_id text,
  modified_since timestamptz,
  page_token text,
  files_indexed int not null default 0,
  last_error text
);

-- Similarity search RPC (vector)
create or replace function public.match_passage_chunks (
  query_embedding vector(1024),
  match_count int default 8,
  match_threshold float default 0.72
)
returns table (
  chunk_id uuid,
  document_id uuid,
  drive_file_id text,
  name text,
  drive_web_view_link text,
  chunk_index int,
  content text,
  similarity float,
  metadata jsonb
)
language sql stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.drive_file_id,
    d.name,
    d.drive_web_view_link,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.metadata
  from public.passage_chunks c
  join public.passage_documents d on d.id = c.document_id
  where 1 - (c.embedding <=> query_embedding) >= match_threshold
  order by (c.embedding <=> query_embedding) asc
  limit least(match_count, 50);
$$;

