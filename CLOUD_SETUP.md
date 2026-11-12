# Configurar a sincronização na nuvem

O Mapa de Estudo reutiliza o projeto Supabase e a mesma conta do Livro Caixa. Os dados de estudo ficam numa tabela própria, `estudo_dados`, separada dos dados financeiros.

1. No Supabase usado pelo Livro Caixa, abra **SQL Editor**, cole o conteúdo de `supabase-setup.sql` e execute.
2. Em **Authentication → URL Configuration**, adicione `https://paulinrik.github.io/estudo/` às URLs de redirecionamento permitidas.
3. Ative o GitHub Pages do repositório `paulinrik/estudo`, usando a branch `main` e a pasta raiz.
4. Abra o site e entre com a conta existente do Livro Caixa. O app combina os lançamentos locais com os da nuvem na primeira entrada e sincroniza alterações posteriores.

O app mantém os dados no aparelho para uso offline. O cliente usa somente a chave pública do Supabase; nunca coloque uma chave `service_role` no navegador.

