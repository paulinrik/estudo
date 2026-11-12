-- Execute este script no SQL Editor do projeto Supabase usado pelo Livro Caixa.
-- Cada conta só pode ler e alterar a própria linha.
create table if not exists public.estudo_dados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dados jsonb not null default '{"days":{},"settings":null}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.estudo_dados enable row level security;

drop policy if exists "Usuário lê os próprios estudos" on public.estudo_dados;
create policy "Usuário lê os próprios estudos"
  on public.estudo_dados for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuário cria os próprios estudos" on public.estudo_dados;
create policy "Usuário cria os próprios estudos"
  on public.estudo_dados for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Usuário atualiza os próprios estudos" on public.estudo_dados;
create policy "Usuário atualiza os próprios estudos"
  on public.estudo_dados for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.estudo_dados to authenticated;

